import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "dotenv/config";
import {
    createFinancePool,
    ensureFinanceSchema,
    FINANCE_USER_ID,
    hojeISO,
    monthStartISO,
    formatBRL,
} from "../utils/finance-db.js";

const USER_ID = FINANCE_USER_ID;
const pool = createFinancePool();

const METODOS = ["Crédito", "Débito", "VR", "Pix", "Dinheiro"];

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
    return outros!; // "Outros" é semeada no schema, sempre existe.
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
                                metodo: {
                                    type: "string",
                                    enum: METODOS,
                                    description: "Forma de pagamento, se o usuário mencionar. 'VR' = vale-refeição/vale-alimentação. Omita se ele não disser.",
                                },
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
                    metodo: { type: "string", enum: METODOS, description: "Nova forma de pagamento. Omita para manter." },
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
            description: "Resumo de gastos por período: total geral e quebra por categoria (padrão) ou por forma de pagamento. Use para 'quanto gastei esse mês?', 'gastos da semana', 'quanto foi no crédito?', etc. Padrão de período: do início do mês atual até hoje.",
            inputSchema: {
                type: "object",
                properties: {
                    startDateISO: { type: "string", description: "Início YYYY-MM-DD. Omita para o 1º dia do mês atual." },
                    endDateISO: { type: "string", description: "Fim YYYY-MM-DD. Omita para hoje." },
                    groupBy: { type: "string", enum: ["categoria", "metodo"], description: "Como agrupar. Padrão 'categoria'. Use 'metodo' quando o usuário perguntar por forma de pagamento (crédito, débito, VR...)." },
                },
                required: [],
            },
        },
        {
            name: "create_subscription",
            description: "Cria uma assinatura/gasto recorrente mensal (ex: 'Disney+ 69 reais todo mês'). Depois de criada, o sistema lança o gasto sozinho todo mês no dia da cobrança, sem o usuário precisar mandar mensagem.",
            inputSchema: {
                type: "object",
                properties: {
                    descricao: { type: "string", description: "Nome da assinatura (ex: 'Disney+', 'Spotify')." },
                    valor: { type: "number", description: "Valor mensal em REAIS." },
                    categoria: { type: "string", description: "Categoria (geralmente 'Assinaturas'). Segue a mesma regra dos gastos." },
                    diaCobranca: { type: "number", description: "Dia do mês da cobrança (1 a 31). Se o usuário não disser, OMITA — o padrão é o dia de hoje." },
                    metodo: { type: "string", enum: METODOS, description: "Forma de pagamento. Opcional." },
                },
                required: ["descricao", "valor", "categoria"],
            },
        },
        {
            name: "list_subscriptions",
            description: "Lista as assinaturas recorrentes ativas, com id, valor e dia de cobrança.",
            inputSchema: { type: "object", properties: {}, required: [] },
        },
        {
            name: "update_subscription",
            description: "Edita uma assinatura existente (valor, dia de cobrança, categoria, descrição ou método). Só os campos que mudam. Requer o id (via list_subscriptions).",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "number", description: "ID da assinatura." },
                    descricao: { type: "string", description: "Nova descrição. Omita para manter." },
                    valor: { type: "number", description: "Novo valor em reais. Omita para manter." },
                    categoria: { type: "string", description: "Nova categoria. Omita para manter." },
                    diaCobranca: { type: "number", description: "Novo dia de cobrança (1 a 31). Omita para manter." },
                    metodo: { type: "string", enum: METODOS, description: "Nova forma de pagamento. Omita para manter." },
                },
                required: ["id"],
            },
        },
        {
            name: "cancel_subscription",
            description: "Cancela (desativa) uma assinatura recorrente. Ela para de ser cobrada automaticamente. Requer o id (via list_subscriptions).",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "number", description: "ID da assinatura a cancelar." },
                },
                required: ["id"],
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
                    const met = it.metodo ? ` · ${it.metodo}` : "";
                    totalCentavos += centavos;
                    linhas.push(`[${ins.rows[0].id}] ${c.emoji} ${formatBRL(centavos)} — ${it.descricao} (${c.nome})${met}`);
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
                const met = e.metodo ? ` · ${e.metodo}` : "";
                const dataStr = e.data instanceof Date ? e.data.toISOString().slice(0, 10) : e.data;
                return `[${e.id}] ${dataStr} ${e.emoji ?? ""} ${formatBRL(e.valor_centavos)} — ${e.descricao} (${e.categoria ?? "Outros"})${met}${auto}`;
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
            const porMetodo = a.groupBy === "metodo";

            const sql = porMetodo
                ? `SELECT COALESCE(e.metodo, 'Não informado') AS rotulo, '' AS emoji,
                          SUM(e.valor_centavos)::int AS total, COUNT(*)::int AS qtd
                   FROM expenses e
                   WHERE e.user_id = $1 AND e.data BETWEEN $2 AND $3
                   GROUP BY COALESCE(e.metodo, 'Não informado')
                   ORDER BY total DESC`
                : `SELECT COALESCE(c.nome, 'Outros') AS rotulo, COALESCE(c.emoji, '') AS emoji,
                          SUM(e.valor_centavos)::int AS total, COUNT(*)::int AS qtd
                   FROM expenses e LEFT JOIN categories c ON e.categoria_id = c.id
                   WHERE e.user_id = $1 AND e.data BETWEEN $2 AND $3
                   GROUP BY c.nome, c.emoji
                   ORDER BY total DESC`;

            const r = await pool.query(sql, [USER_ID, start, end]);
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: `Nenhum gasto entre ${start} e ${end}.` }] };
            }
            const grand = r.rows.reduce((s, x) => s + x.total, 0);
            const titulo = porMetodo ? "por forma de pagamento" : "por categoria";
            const linhas = r.rows.map((x) => `${x.emoji ? x.emoji + " " : ""}${x.rotulo}: ${formatBRL(x.total)} (${x.qtd}x)`);
            return {
                content: [{ type: "text", text: `Período ${start} a ${end} (${titulo})\n\n${linhas.join("\n")}\n\nTotal geral: ${formatBRL(grand)}` }],
            };
        }

        if (name === "create_subscription") {
            const centavos = Math.round(Number(a.valor) * 100);
            const catId = await categoriaIdOrOutros(a.categoria);
            // Dia padrão = dia de hoje (Brasília) quando o usuário não informa.
            let dia = a.diaCobranca != null ? Math.trunc(Number(a.diaCobranca)) : Number(hojeISO().slice(8, 10));
            if (dia < 1) dia = 1;
            if (dia > 31) dia = 31;
            const r = await pool.query(
                `INSERT INTO subscriptions (user_id, descricao, valor_centavos, categoria_id, dia_cobranca, metodo)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [USER_ID, a.descricao, centavos, catId, dia, a.metodo ?? null]
            );
            const met = a.metodo ? ` · ${a.metodo}` : "";
            return {
                content: [{ type: "text", text: `Assinatura "${a.descricao}" criada (id ${r.rows[0].id}): ${formatBRL(centavos)}/mês, todo dia ${dia}${met}. Será lançada automaticamente.` }],
            };
        }

        if (name === "list_subscriptions") {
            const r = await pool.query(
                `SELECT s.id, s.descricao, s.valor_centavos, s.dia_cobranca, s.metodo,
                        c.nome AS categoria, c.emoji,
                        to_char(s.ultima_cobranca, 'YYYY-MM-DD') AS ultima
                 FROM subscriptions s LEFT JOIN categories c ON s.categoria_id = c.id
                 WHERE s.user_id = $1 AND s.ativo = TRUE
                 ORDER BY s.dia_cobranca`,
                [USER_ID]
            );
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: "Nenhuma assinatura ativa." }] };
            }
            const linhas = r.rows.map((s) => {
                const met = s.metodo ? ` · ${s.metodo}` : "";
                const ult = s.ultima ? ` (última: ${s.ultima})` : "";
                return `[${s.id}] ${s.emoji ?? ""} ${s.descricao} — ${formatBRL(s.valor_centavos)}/mês, dia ${s.dia_cobranca} (${s.categoria ?? "Outros"})${met}${ult}`;
            });
            return { content: [{ type: "text", text: linhas.join("\n") }] };
        }

        if (name === "update_subscription") {
            const id = Number(a.id);
            const sets: string[] = [];
            const vals: any[] = [];
            let i = 1;
            if (a.descricao !== undefined) { sets.push(`descricao = $${i++}`); vals.push(a.descricao); }
            if (a.valor !== undefined) { sets.push(`valor_centavos = $${i++}`); vals.push(Math.round(Number(a.valor) * 100)); }
            if (a.metodo !== undefined) { sets.push(`metodo = $${i++}`); vals.push(a.metodo); }
            if (a.diaCobranca !== undefined) {
                let dia = Math.trunc(Number(a.diaCobranca));
                if (dia < 1) dia = 1;
                if (dia > 31) dia = 31;
                sets.push(`dia_cobranca = $${i++}`); vals.push(dia);
            }
            if (a.categoria !== undefined) { sets.push(`categoria_id = $${i++}`); vals.push(await categoriaIdOrOutros(a.categoria)); }

            if (sets.length === 0) {
                return { content: [{ type: "text", text: "Nada para atualizar." }], isError: true };
            }
            vals.push(id, USER_ID);
            const r = await pool.query(
                `UPDATE subscriptions SET ${sets.join(", ")} WHERE id = $${i++} AND user_id = $${i} AND ativo = TRUE RETURNING id`,
                vals
            );
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: `Assinatura ${id} não encontrada.` }], isError: true };
            }
            return { content: [{ type: "text", text: `Assinatura ${id} atualizada.` }] };
        }

        if (name === "cancel_subscription") {
            const id = Number(a.id);
            const r = await pool.query(
                `UPDATE subscriptions SET ativo = FALSE WHERE id = $1 AND user_id = $2 AND ativo = TRUE RETURNING descricao`,
                [id, USER_ID]
            );
            if (r.rows.length === 0) {
                return { content: [{ type: "text", text: `Assinatura ${id} não encontrada.` }], isError: true };
            }
            return { content: [{ type: "text", text: `Assinatura "${r.rows[0].descricao}" cancelada — não será mais cobrada.` }] };
        }

        return { content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }], isError: true };
    } catch (error: any) {
        console.error(`[finance-manager] ERRO em ${name}:`, error);
        return { content: [{ type: "text", text: `Erro ao executar ${name}: ${error.message}` }], isError: true };
    }
});

async function runServer() {
    await ensureFinanceSchema(pool);
    console.error("✅ finance-manager: tabelas e categorias verificadas.");
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((err) => {
    console.error("[finance-manager] Falha ao iniciar:", err);
    process.exit(1);
});
