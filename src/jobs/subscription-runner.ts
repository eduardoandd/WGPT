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
 * É deterministico e NÃO usa IA. Pode rodar quantas vezes quiser no dia — a
 * trava de "já cobrado neste mês" (ultima_cobranca) evita lançamento duplicado.
 */
async function run(): Promise<void> {
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

    const subs = await pool.query(
        `SELECT s.id, s.descricao, s.valor_centavos, s.categoria_id, s.dia_cobranca, s.metodo,
                c.nome AS categoria,
                to_char(s.ultima_cobranca, 'YYYY-MM-DD') AS ultima
         FROM subscriptions s LEFT JOIN categories c ON s.categoria_id = c.id
         WHERE s.user_id = $1 AND s.ativo = TRUE`,
        [FINANCE_USER_ID]
    );

    let lancadas = 0;

    for (const s of subs.rows) {
        // Dia de cobrança "gruda" no último dia em meses curtos (ex: 31 em fev).
        const dueDay = Math.min(s.dia_cobranca, daysInMonth);
        const dueDate = `${year}-${pad2(month)}-${pad2(dueDay)}`;

        const venceu = today >= dueDate;
        const jaCobradaEsteMes = s.ultima && s.ultima >= firstOfMonth;
        if (!venceu || jaCobradaEsteMes) continue;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                `INSERT INTO expenses (user_id, valor_centavos, descricao, categoria_id, data, metodo, origem, subscription_id)
                 VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7)`,
                [FINANCE_USER_ID, s.valor_centavos, s.descricao, s.categoria_id, dueDate, s.metodo ?? null, s.id]
            );
            await client.query(`UPDATE subscriptions SET ultima_cobranca = $1 WHERE id = $2`, [dueDate, s.id]);

            if (OWNER_CHAT_ID) {
                const met = s.metodo ? ` · ${s.metodo}` : "";
                const msg = `📺 *Assinatura lançada automaticamente*\n${s.descricao} — ${formatBRL(s.valor_centavos)}${met} (${s.categoria ?? "Outros"})`;
                await client.query(
                    `INSERT INTO notification_outbox (chat_id, message) VALUES ($1, $2)`,
                    [OWNER_CHAT_ID, msg]
                );
            }
            await client.query("COMMIT");
            lancadas++;
            console.log(`✅ Assinatura lançada: ${s.descricao} (${formatBRL(s.valor_centavos)}) em ${dueDate}`);
        } catch (e) {
            await client.query("ROLLBACK");
            console.error(`❌ Falha ao lançar assinatura ${s.id} (${s.descricao}):`, e);
        } finally {
            client.release();
        }
    }

    console.log(`🏁 subscription-runner: ${lancadas} assinatura(s) lançada(s) em ${today}.`);
    await pool.end();
}

run()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("[subscription-runner] Erro fatal:", err);
        process.exit(1);
    });
