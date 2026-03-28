import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import crypto from 'crypto';

const server = new Server({ name: "sqlite-manager", version: "1.0.0" }, { capabilities: { tools: {} } });

// Mapa em memória para rastrear as tarefas (Jobs)
// Em um sistema multi-instância, você guardaria isso no próprio SQLite ou Redis
const tasks = new Map<string, { status: string, result?: any, error?: string }>();

async function getDbConnection() {
    return open({
        filename: path.resolve(process.cwd(), 'database.sqlite'), 
        driver: sqlite3.Database
    });
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "submit_sql_task",
                description: "Submete uma query SQL pesada para ser executada em background. Retorna um Task ID que deve ser usado na ferramenta check_sql_task para obter o resultado posteriormente.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "A query SQL pura para ser executada." }
                    },
                    required: ["query"]
                }
            },
            {
                name: "check_sql_task",
                description: "Verifica o status e o resultado de uma query SQL submetida anteriormente usando o Task ID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        taskId: { type: "string", description: "O ID da tarefa retornado pelo submit_sql_task" }
                    },
                    required: ["taskId"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    
    // ---------------------------------------------------------
    // 1. INICIAR TAREFA
    // ---------------------------------------------------------
    if (request.params.name === "submit_sql_task") {
        const { query } = request.params.arguments as any;
        const taskId = crypto.randomUUID();
        
        console.log(`🗄️ Iniciando Task Assíncrona [${taskId}] para a query: ${query}`);
        
        // Regista a tarefa como "pendente"
        tasks.set(taskId, { status: "pending" });

        // Executa em background sem usar "await" na thread principal do return
        getDbConnection().then(async (db) => {
            try {
                const sqlLower = query.trim().toLowerCase();
                const isSelect = sqlLower.startsWith("select") || sqlLower.startsWith("pragma") || sqlLower.startsWith("explain");

                let result;
                if (isSelect) {
                    result = await db.all(query);
                } else {
                    result = await db.run(query);
                }

                // Atualiza o status para concluído e salva o resultado
                tasks.set(taskId, { status: "completed", result });
                console.log(`✅ Task [${taskId}] concluída com sucesso!`);

            } catch (error: any) {
                console.error(`❌ Erro na Task [${taskId}]: ${error.message}`);
                tasks.set(taskId, { status: "error", error: error.message });
            } finally {
                await db.close();
            }
        }).catch(err => {
            tasks.set(taskId, { status: "error", error: err.message });
        });

        // Retorna imediatamente para a IA não ficar travada (Timeout)
        return { 
            content: [{ 
                type: "text", 
                text: `Query recebida e em processamento. O ID da sua tarefa é: ${taskId}. Use a ferramenta 'check_sql_task' passando este ID para verificar o status e obter os dados.` 
            }] 
        };
    }

    // ---------------------------------------------------------
    // 2. CHECAR TAREFA
    // ---------------------------------------------------------
    if (request.params.name === "check_sql_task") {
        const { taskId } = request.params.arguments as any;
        const task = tasks.get(taskId);

        if (!task) {
            return { content: [{ type: "text", text: `Task ID não encontrado: ${taskId}` }], isError: true };
        }

        if (task.status === "pending") {
            return { 
                content: [{ type: "text", text: `A tarefa ${taskId} ainda está em processamento (pending). Por favor, aguarde mais um pouco e consulte novamente.` }] 
            };
        }

        if (task.status === "error") {
            return { 
                content: [{ type: "text", text: `A tarefa falhou com o erro: ${task.error}` }], 
                isError: true 
            };
        }

        // Se estiver "completed", formata e retorna
        let jsonResult = JSON.stringify(task.result, null, 2);
        
        // Proteção contra estouro de tokens da IA
        if (jsonResult.length > 8000) {
            jsonResult = jsonResult.substring(0, 8000) + "\n... [RESULTADO TRUNCADO DEVIDO AO TAMANHO. O BANCO RETORNOU MUITOS DADOS]";
        }

        // (Opcional) Limpa a tarefa da memória após ser lida com sucesso
        tasks.delete(taskId);

        return { 
            content: [{ type: "text", text: `Tarefa concluída com sucesso! Resultado:\n${jsonResult}` }] 
        };
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);