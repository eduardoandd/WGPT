import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Pool } from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error("❌ DATABASE_URL não definida no .env (necessária para o finance-manager)");
    process.exit(1);
}

// Único usuário por enquanto; mantém a coluna para multiusuário no futuro.
const USER_ID = process.env.FINANCE_USER_ID || process.env.TASK_USER_ID || "eduardo";

// SSL relaxado para conexões remotas (Supabase); desligado em localhost.
const useSSL = !/localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({
    connectionString,
    ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

const DEFAULT_CATEGORIES: Array<[string, string]> = [
    ["Alimentação", "🍽️"],
    ["Transporte", "🚗"],
    ["Moradia", "🏠"],
    ["Lazer", "🎉"],
    ["Saúde", "🩺"],
    ["Assinaturas", "📺"],
    ["Compras", "🛍️"],
    ["Outros", "📦"],
];

// ── Helpers ───────────────────────────────────────────────────────────────
const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const monthStartISO = () => `${hojeISO().slice(0, 7)}-01`;
const formatBRL = (centavos: number) =>
    (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Resolve o nome da categoria (case-insensitive) para o seu id. null se não existir. */
async function resolveCategoriaId(nome: string): Promise<number | null> {
    const r = await pool.query(
        `SELECT id FROM categories WHERE user_id = $1 AND lower(nome) = lower($2) AND ativo = TRUE LIMIT 1`,
        [USER_ID, nome]
    );
    return r.rows[0]?.id ?? null;
}

/** Garante a categoria informada; cai em "Outros" quando não existe. */
async function categoriaIdOrOutros(nome: string): Promise<number> {
    const id = nome ? await resolveCategoriaId(nome) : null;
    if (id != null) return id;
    const outros = await resolveCategoriaId("Outros");
    return outros!; // "Outros" é semeada no setup, sempre existe.
}

async function setup(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            nome TEXT NOT NULL,
            emoji TEXT DEFAULT '',
            ativo BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS categories_user_nome_unique
        ON categories (user_id, lower(nome));
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            valor_centavos INTEGER NOT NULL,
            descricao TEXT NOT NULL,
            categoria_id INTEGER REFERENCES categories(id),
            data DATE NOT NULL,
            metodo TEXT,
            origem TEXT NOT NULL DEFAULT 'manual',
            subscription_id INTEGER,
            created_at TIMESTAMPTZ DEFAULT now()
        );
    `);

    // Semeia as categorias padrão (idempotente).
    for (const [nome, emoji] of DEFAULT_CATEGORIES) {
        await pool.query(
            `INSERT INTO categories (user_id, nome, emoji)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, lower(nome)) DO NOTHING`,
            [USER_ID, nome, emoji]
        );
    }
    console.error("✅ finance-manager: tabelas e categorias verificadas.");
}

const server = new Server(
    { name: "finance-manager", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "list_categories",
            description: "Lista as categorias de gasto disponíveis. SEMPRE consulte esta lista ANTES de registrar gastos, para escolher a categoria certa e não criar nomes diferentes para a mesma coisa.",
            inputSchema: { type: "object", properties: {}, required: [] },
        },
        {
            name: "create_category",
            description: "Cria uma nova categoria de gasto. Use APENAS quando nenhuma categoria existente servir E o gasto for relevante/recorrente o bastante para merecer uma categoria própria. Para gastos muito específicos ou raros, prefira usar 'Outros' em vez de criar categoria nova. Se a categoria já existir (ignorando maiúsculas), ela é reaproveitada.",
            inputSchema: {
                type: "object",
                properties: {
                    nome: { type: "string", description: "Nome da categoria (ex: 'Pets', 'Educação')." },
                    emoji: { type: "string", description: "Um emoji que represente a categoria. Opcional." },
                },
                required: ["nome"],
            },
        },
        {
            name: "add_expenses",
            description: "Registra um ou MAIS gastos de uma vez. Use sempre que o usuário relatar despesas (ex: '400 no mercado, 20 na pipoca, 69 Disney+' = 3 gastos). ANTES de chamar, consulte 'list_categories' e escolha a categoria de cada gasto; crie nova com 'create_category' só se valer a pena.",
            inputSchema: {
                type: "object",
                properties: {
                    expenses: {
                        type: "array",
                        description: "Lista de gastos a registrar.",
                        items: {
                            type: "object",
                            properties: {
                                valor: { type: "number", description: "Valor em REAIS (ex: 400 ou 19.90)." },
                                descricao: { type: "string", description: "Descrição curta (ex: 'mercado', 'Disney+')." },
                                categoria: { type: "string", description: "Nome da categoria (deve existir em list_categories; se não existir, cai em 'Outros')." },
                                dataISO: { type: "string", description: "Data do gasto YYYY-MM-DD. Omita para hoje." },
                                metodo: { type: "string", description: "Forma de pagamento (pix, crédito, débito, dinheiro). Opcional." },
                            },
                            required: ["valor", "descricao", "categoria"],
                        },
                    },
                },
                required: ["expenses"],
            },
        },
        {
            name: "list_expenses",
            description: "Lista os gastos de um período, com o id de cada um (necessário para editar ou apagar). Padrão: hoje.",
            inputSchema: {
                type: "object",
                properties: {
                    startDateISO: { type: "string", description: "Início do período YYYY-MM-DD. Omita para hoje." },
                    endDateISO: { type: "string", description: "Fim do período YYYY-MM-DD. Omita para hoje." },
                },
                required: [],
            },
        },
        {
            name: "update_expense",
            description: "Edita um gasto existente. Forneça só os campos que mudam. Requer o id (obtido via list_expenses).",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "number", description: "ID do gasto." },
                    valor: { type: "number", description: "Novo valor em reais. Omita para manter." },
                    descricao: { type: "string", description: "Nova descrição. Omita para manter." },
                    categoria: { type: "string", description: "Nova categoria (nome). Omita para manter." },
                    dataISO: { type: "string", description: "Nova data YYYY-MM-DD. Omita para manter." },
                    metodo: { type: "string", description: "Nova forma de pagamento. Omita para manter." },
                },
                required: ["id"],
            },
        },
        {
            name: "delete_expense",
            description: "Apaga um gasto. Requer o id (obtido via list_expenses).",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "number", description: "ID do gasto a apagar." },
                },
                required: ["id"],
            },
        },
        {
            name: "expense_summary",
            description: "Resumo de gastos por período: total geral e quebra por categoria. Use para 'quanto gastei esse mês?', 'gastos da semana', etc. Padrão: do início do mês atual até hoje.",
            inputSchema: {
                type: "object",
                properties: {
                    startDateISO: { type: "string", description: "Início YYYY-MM-DD. Omita para o 1º dia do mês atual." },
                    endDateISO: { type: "string", description: "Fim YYYY-MM-DD. Omita para hoje." },
                },
                required: [],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as any;

    try {
        console.error(`[finance-manager] Ferramenta chamada: ${name}`, JSON.stringify(args));

        if (name === "list_categories") {
            const r = await pool.query(
                `SELECT id, nome, emoji FROM categories WHERE user_id = $1 AND ativo = TRUE ORDER BY nome`,
                [USER_ID]
            );
            const text = r.rows.map((c) => `[${c.id}] ${c.emoji} ${c.nome}`).join("\n");
            return { content: [{ type: "text", text: text || "Nenhuma categoria cadastrada." }] };
        }

        if (name === "create_category") {
            const nome = String(a.nome).trim();
            const emoji = a.emoji ?? "";
            const r = await pool.query(
                `INSERT INTO categories (user_id, nome, emoji)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, lower(nome)) DO NOTHING
                 RETURNING id`,
                [USER_ID, nome, emoji]
            );
            if (r.rows.length > 0) {
                return { content: [{ type: "text", text: `Categoria "${nome}" criada (id ${r.rows[0].id}).` }] };
            }
            const existing = await resolveCategoriaId(nome);
            return { content: [{ type: "text", text: `Categoria "${nome}" já existia (id ${existing}); reaproveitada.` }] };
        }

        if (name === "add_expenses") {
            const items: any[] = Array.isArray(a.expenses) ? a.expenses : [];
            if (items.length === 0) {
                return { content: [{ type: "text", text: "Nenhum gasto informado." }], isError: true };
            }

            const client = await pool.connect();
            const linhas: string[] = [];
            let totalCentavos = 0;
            try {
                await client.query("BEGIN");
                for (const it of items) {
                    const centavos = Math.round(Number(it.valor) * 100);
                    const data = it.dataISO || hojeISO();
                    const catId = await categoriaIdOrOutros(it.categoria);
                    const ins = await client.query(
                        `INSERT INTO expenses (user_id, valor_centavos, descricao, categoria_id, data, metodo, origem)
                         VALUES ($1, $2, $3, $4, $5, $6, 'manual') RETURNING id`,
                        [USER_ID, centavos, it.descricao, catId, data, it.metodo ?? null]
                    );
                    const cat = await client.query(`SELECT nome, emoji FROM categories WHERE id = $1`, [catId]);
                    const c = cat.rows[0] ?? { nome: "Outros", emoji: "📦" };
                    totalCentavos += centavos;
                    linhas.push(`[${ins.rows[0].id}] ${c.emoji} ${formatBRL(centavos)} — ${it.descricao} (${c.nome})`);
                }
                await client.query("COMMIT");
            } catch (e) {
                await client.query("ROLLBACK");
                throw e;
            } finally {
                client.release();
            }

            const resumo = `${linhas.join("\n")}\n\nTotal registrado: ${formatBRL(totalCentavos)}`;
            return { content: [{ type: "text", text: resumo }] };
        }

        if (name === "list_expenses") {
            const start = a.startDateISO || hojeISO();
            const end = a.endDateISO || a.startDateISO || hojeISO();
            const r = await pool.query(
                `SELECT e.id, e.valor_centavos, e.descricao, e.data, e.metodo, e.origem,
                        c.nome AS categoria, c.emoji
                 FROM expenses e LEFT JOIN categories c ON e.categoria_id = c.id
                 WHERE e.user_id = $1 AND e.data BETWEEN $2 AND $3
                 ORDER BY e.data, e.id`,
                [USER_ID, start, end]
            );
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: `Nenhum gasto entre ${start} e ${end}.` }] };
            }
            const linhas = r.rows.map((e) => {
                const auto = e.origem === "auto" ? " (auto)" : "";
                return `[${e.id}] ${e.data} ${e.emoji ?? ""} ${formatBRL(e.valor_centavos)} — ${e.descricao} (${e.categoria ?? "Outros"})${auto}`;
            });
            const total = r.rows.reduce((s, e) => s + e.valor_centavos, 0);
            return { content: [{ type: "text", text: `${linhas.join("\n")}\n\nTotal: ${formatBRL(total)}` }] };
        }

        if (name === "update_expense") {
            const id = Number(a.id);
            const sets: string[] = [];
            const vals: any[] = [];
            let i = 1;
            if (a.valor !== undefined) { sets.push(`valor_centavos = $${i++}`); vals.push(Math.round(Number(a.valor) * 100)); }
            if (a.descricao !== undefined) { sets.push(`descricao = $${i++}`); vals.push(a.descricao); }
            if (a.dataISO !== undefined) { sets.push(`data = $${i++}`); vals.push(a.dataISO); }
            if (a.metodo !== undefined) { sets.push(`metodo = $${i++}`); vals.push(a.metodo); }
            if (a.categoria !== undefined) { sets.push(`categoria_id = $${i++}`); vals.push(await categoriaIdOrOutros(a.categoria)); }

            if (sets.length === 0) {
                return { content: [{ type: "text", text: "Nada para atualizar (nenhum campo informado)." }], isError: true };
            }
            vals.push(id, USER_ID);
            const r = await pool.query(
                `UPDATE expenses SET ${sets.join(", ")} WHERE id = $${i++} AND user_id = $${i} RETURNING id`,
                vals
            );
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: `Gasto ${id} não encontrado.` }], isError: true };
            }
            return { content: [{ type: "text", text: `Gasto ${id} atualizado.` }] };
        }

        if (name === "delete_expense") {
            const id = Number(a.id);
            const r = await pool.query(`DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id`, [id, USER_ID]);
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: `Gasto ${id} não encontrado.` }], isError: true };
            }
            return { content: [{ type: "text", text: `Gasto ${id} apagado.` }] };
        }

        if (name === "expense_summary") {
            const start = a.startDateISO || monthStartISO();
            const end = a.endDateISO || hojeISO();
            const r = await pool.query(
                `SELECT c.nome AS categoria, c.emoji, SUM(e.valor_centavos)::int AS total, COUNT(*)::int AS qtd
                 FROM expenses e LEFT JOIN categories c ON e.categoria_id = c.id
                 WHERE e.user_id = $1 AND e.data BETWEEN $2 AND $3
                 GROUP BY c.nome, c.emoji
                 ORDER BY total DESC`,
                [USER_ID, start, end]
            );
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: `Nenhum gasto entre ${start} e ${end}.` }] };
            }
            const grand = r.rows.reduce((s, x) => s + x.total, 0);
            const linhas = r.rows.map((x) => `${x.emoji ?? ""} ${x.categoria ?? "Outros"}: ${formatBRL(x.total)} (${x.qtd}x)`);
            return {
                content: [{ type: "text", text: `Período ${start} a ${end}\n\n${linhas.join("\n")}\n\nTotal geral: ${formatBRL(grand)}` }],
            };
        }

        return { content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }], isError: true };
    } catch (error: any) {
        console.error(`[finance-manager] ERRO em ${name}:`, error);
        return { content: [{ type: "text", text: `Erro ao executar ${name}: ${error.message}` }], isError: true };
    }
});

async function runServer() {
    await setup();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((err) => {
    console.error("[finance-manager] Falha ao iniciar:", err);
    process.exit(1);
});
