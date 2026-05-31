import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { fastModel } from "../utils/models.js";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { AsyncTaskManager } from "../utils/async-task.js";
import "dotenv/config";

const taskManager = new AsyncTaskManager();

const server = new Server({ name: "sqlite-agent", version: "2.0.0" }, { capabilities: { tools: {} } });

const DB_PATH = process.env.SQLITE_DB_PATH
    ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
    : path.resolve(process.cwd(), 'database.sqlite');

async function getDb() {
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });
    await db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 20000;');
    return db;
}

// Ferramenta: inspecionar schema do banco
const getDatabaseSchema = tool(
    async () => {
        console.error("🗄️ [SQL Agent] Inspecionando schema do banco...");
        const db = await getDb();
        try {
            const tables = await db.all(
                `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
            );
            if (tables.length === 0) return "O banco de dados está vazio (sem tabelas).";

            let schema = "Tabelas disponíveis no banco:\n\n";
            for (const table of tables) {
                const columns = await db.all(`PRAGMA table_info(${table.name})`);
                schema += `📋 Tabela: ${table.name}\n`;
                columns.forEach((col: any) => {
                    schema += `  - ${col.name} (${col.type})${col.pk ? " [PK]" : ""}${col.notnull ? " NOT NULL" : ""}\n`;
                });
                schema += "\n";
            }
            return schema;
        } finally {
            await db.close();
        }
    },
    {
        name: "get_database_schema",
        description: "Retorna o schema completo do banco SQLite: tabelas e colunas disponíveis. Use SEMPRE antes de escrever qualquer query.",
        schema: z.object({})
    }
);

// Ferramenta: executar SELECT
const executeQuery = tool(
    async ({ query }) => {
        console.error(`🗄️ [SQL Agent] Executando SELECT: ${query}`);
        const db = await getDb();
        try {
            const rows = await db.all(query);
            if (rows.length === 0) return "A query não retornou resultados.";

            let result = JSON.stringify(rows, null, 2);
            if (result.length > 8000) {
                result = result.substring(0, 8000) + "\n... [RESULTADO TRUNCADO — muitos dados retornados]";
            }
            return `${rows.length} linha(s) encontrada(s):\n${result}`;
        } finally {
            await db.close();
        }
    },
    {
        name: "execute_query",
        description: "Executa queries de leitura (SELECT, PRAGMA, EXPLAIN). Use para buscar e analisar dados.",
        schema: z.object({
            query: z.string().describe("Query SQL de leitura (somente SELECT, PRAGMA ou EXPLAIN)")
        })
    }
);

// Ferramenta: executar mutação (INSERT/UPDATE/DELETE)
const executeMutation = tool(
    async ({ query }) => {
        console.error(`🗄️ [SQL Agent] Executando mutação: ${query}`);
        const sqlLower = query.trim().toLowerCase();

        // Proteção: bloqueia UPDATE/DELETE sem WHERE
        if ((sqlLower.startsWith("update") || sqlLower.startsWith("delete")) && !sqlLower.includes("where")) {
            return "⛔ OPERAÇÃO BLOQUEADA: UPDATE ou DELETE sem cláusula WHERE pode corromper toda a tabela. Adicione um WHERE e tente novamente.";
        }

        const db = await getDb();
        try {
            const result = await db.run(query);
            return `✅ Operação executada com sucesso. Linhas afetadas: ${result.changes ?? 0}`;
        } finally {
            await db.close();
        }
    },
    {
        name: "execute_mutation",
        description: "Executa operações de escrita (INSERT, UPDATE, DELETE, CREATE). Automaticamente bloqueia UPDATE/DELETE sem WHERE para proteger o banco.",
        schema: z.object({
            query: z.string().describe("Query SQL de escrita (INSERT, UPDATE, DELETE, CREATE)")
        })
    }
);

const sqlTools = [getDatabaseSchema, executeQuery, executeMutation];

const SYSTEM_PROMPT = `Você é um especialista em banco de dados SQLite e análise de dados.
Você tem acesso direto ao banco de dados do sistema. Use as ferramentas para responder perguntas e executar operações.

Diretrizes:
- SEMPRE use get_database_schema antes de escrever qualquer query para conhecer as tabelas disponíveis
- Use execute_query para buscas e leituras (SELECT)
- Use execute_mutation para alterações (INSERT, UPDATE, DELETE)
- Nunca execute UPDATE ou DELETE sem WHERE — a ferramenta já bloqueia, mas evite tentar
- Interprete os resultados e responda de forma clara, não despeje JSON puro
- Se não houver dados, informe o usuário de forma amigável

FORMATAÇÃO (WhatsApp):
- Use *negrito* para destacar valores importantes
- Use emojis para tornar a resposta mais expressiva (📊 dados, ✅ sucesso, ⚠️ aviso)
- NUNCA crie tabelas Markdown — use listas com hífen`;

const sqlAgent = createReactAgent({
    llm: fastModel,
    tools: sqlTools,
    stateModifier: SYSTEM_PROMPT
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ask_sql_specialist_async",
                description: "Triggers the SQL specialist agent in the background. It inspects the schema, writes and executes the needed queries, and returns an interpreted analysis. ASYNC: returns a Task ID. You MUST use [MONITOR_TASK: check_sql_task | ID] tag in your response.",
                inputSchema: {
                    type: "object",
                    properties: {
                        question: {
                            type: "string",
                            description: "The user's request in natural language (e.g. 'How many customers do we have?', 'Show top 5 products by revenue', 'What is the total sales this month?')"
                        }
                    },
                    required: ["question"]
                }
            },
            {
                name: "check_sql_task",
                description: "Checks the result of a previously submitted SQL analysis task.",
                inputSchema: {
                    type: "object",
                    properties: { taskId: { type: "string" } },
                    required: ["taskId"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "ask_sql_specialist_async") {
        const { question } = request.params.arguments as { question: string };

        const analysisPromise = async () => {
            console.error(`\n🧠 [SQL Agent] Iniciando análise para: "${question}"`);
            const result = await sqlAgent.invoke({
                messages: [new HumanMessage(question)]
            });

            const lastMessage = result.messages[result.messages.length - 1];
            const answer = typeof lastMessage.content === "string"
                ? lastMessage.content
                : JSON.stringify(lastMessage.content);

            console.error("✅ [SQL Agent] Análise concluída.");
            return answer;
        };

        const taskId = taskManager.execute(analysisPromise());

        return {
            content: [{
                type: "text",
                text: `Analysis started in background.\n\nMANDATORY INSTRUCTION:\nCopy the exact ID below and place it in your monitoring tag.\nID: ${taskId}\nTool: check_sql_task\nExpected format in your response: [MONITOR_TASK: check_sql_task | ${taskId}]`
            }]
        };
    }

    if (request.params.name === "check_sql_task") {
        const { taskId } = request.params.arguments as any;
        return taskManager.check(taskId);
    }

    return { content: [{ type: "text", text: "Unknown tool" }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Servidor MCP 'sqlite-agent v2' conectado via stdio!");
}

runServer().catch(console.error);
