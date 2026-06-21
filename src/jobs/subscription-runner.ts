import "dotenv/config";
import {
    createFinancePool,
    ensureFinanceSchema,
    FINANCE_USER_ID,
    hojeISO,
    pad2,
    formatBRL,
} from "../utils/finance-db.js";

/**
 * Job diário (rodado pelo PM2 via cron). Para cada assinatura ativa que "vence
 * hoje" e ainda não foi cobrada neste mês, lança o gasto automaticamente e
 * enfileira um aviso na outbox (o bot manda o toque no WhatsApp).
 *
 * É determinístico e NÃO usa IA. Pode rodar quantas vezes quiser no dia — a
 * trava de "já cobrado neste mês" (ultima_cobranca) evita lançamento duplicado.
 *
 * MODO TESTE:
 *   npx tsx src/jobs/subscription-runner.ts --force       (lança TODAS agora)
 *   npx tsx src/jobs/subscription-runner.ts --force 3     (lança só a id 3 agora)
 * Ignora a data de cobrança e NÃO altera a agenda real (ultima_cobranca),
 * só para você ver o toque funcionando na hora.
 */
async function run(): Promise<void> {
    const argv = process.argv.slice(2);
    const force = argv.includes("--force");
    const idArg = argv.find((x) => /^\d+$/.test(x));
    const forceId = idArg ? Number(idArg) : null;

    const pool = createFinancePool();
    await ensureFinanceSchema(pool);

    const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
    if (!OWNER_CHAT_ID) {
        console.warn("⚠️ OWNER_CHAT_ID não definido — vou lançar os gastos, mas sem enviar o toque.");
    }

    const today = hojeISO(); // YYYY-MM-DD (Brasília)
    const [year, month] = today.split("-").map(Number);
    const firstOfMonth = `${year}-${pad2(month)}-01`;
    const daysInMonth = new Date(year, month, 0).getDate(); // último dia do mês atual

    if (force) {
        console.log(`🧪 MODO TESTE (--force${forceId ? " id=" + forceId : " todas"}): ignora a data de cobrança e não mexe na agenda real.`);
    }

    const params: any[] = [FINANCE_USER_ID];
    let where = `s.user_id = $1 AND s.ativo = TRUE`;
    if (forceId) {
        params.push(forceId);
        where += ` AND s.id = $2`;
    }

    const subs = await pool.query(
        `SELECT s.id, s.descricao, s.valor_centavos, s.categoria_id, s.dia_cobranca, s.metodo,
                c.nome AS categoria,
                to_char(s.ultima_cobranca, 'YYYY-MM-DD') AS ultima
         FROM subscriptions s LEFT JOIN categories c ON s.categoria_id = c.id
         WHERE ${where}`,
        params
    );

    let lancadas = 0;

    for (const s of subs.rows) {
        let dataLancamento: string;

        if (force) {
            dataLancamento = today; // teste: lança agora
        } else {
            // Dia de cobrança "gruda" no último dia em meses curtos (ex: 31 em fev).
            const dueDay = Math.min(s.dia_cobranca, daysInMonth);
            const dueDate = `${year}-${pad2(month)}-${pad2(dueDay)}`;
            const venceu = today >= dueDate;
            const jaCobradaEsteMes = s.ultima && s.ultima >= firstOfMonth;
            if (!venceu || jaCobradaEsteMes) continue;
            dataLancamento = dueDate;
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                `INSERT INTO expenses (user_id, valor_centavos, descricao, categoria_id, data, metodo, origem, subscription_id)
                 VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7)`,
                [FINANCE_USER_ID, s.valor_centavos, s.descricao, s.categoria_id, dataLancamento, s.metodo ?? null, s.id]
            );
            // No modo teste NÃO mexe na agenda real (ultima_cobranca).
            if (!force) {
                await client.query(`UPDATE subscriptions SET ultima_cobranca = $1 WHERE id = $2`, [dataLancamento, s.id]);
            }

            if (OWNER_CHAT_ID) {
                const met = s.metodo ? ` · ${s.metodo}` : "";
                const tag = force ? " (teste)" : "";
                const msg = `📺 *Assinatura lançada automaticamente*${tag}\n${s.descricao} — ${formatBRL(s.valor_centavos)}${met} (${s.categoria ?? "Outros"})`;
                await client.query(
                    `INSERT INTO notification_outbox (chat_id, message) VALUES ($1, $2)`,
                    [OWNER_CHAT_ID, msg]
                );
            }
            await client.query("COMMIT");
            lancadas++;
            console.log(`✅ Lançada: ${s.descricao} (${formatBRL(s.valor_centavos)}) em ${dataLancamento}${force ? " [teste]" : ""}`);
        } catch (e) {
            await client.query("ROLLBACK");
            console.error(`❌ Falha ao lançar assinatura ${s.id} (${s.descricao}):`, e);
        } finally {
            client.release();
        }
    }

    console.log(`🏁 subscription-runner: ${lancadas} assinatura(s) lançada(s) em ${today}${force ? " (teste)" : ""}.`);
    // Fecha o pool sem bloquear a saída (se a conexão demorar a fechar, não
    // queremos segurar o processo vivo — é um job one-shot).
    void pool.end().catch(() => {});
}

// Rede de segurança: garante que o processo encerra mesmo se algum handle
// (ex: socket do Postgres) ficar pendurado. unref() evita que o próprio
// timer mantenha o processo vivo.
setTimeout(() => process.exit(0), 10000).unref();

run()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("[subscription-runner] Erro fatal:", err);
        process.exit(1);
    });
