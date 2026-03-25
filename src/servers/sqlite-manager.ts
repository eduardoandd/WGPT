import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const server = new Server({ name: "sqlite-manager", version: "1.0.0" }, { capabilities: { tools: {} } });

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
                name: "execute_sql",
                description: "Executa QUALQUER query SQL (SELECT, INSERT, UPDATE, DELETE) no banco de dados CORPORATIVO do sistema (não use para arquivos ou PDFs). Use para consultar histórico, dados de negócios ou tabelas criadas pelo usuário. IMPORTANTE: Sempre execute primeiro 'SELECT name, sql FROM sqlite_master WHERE type=\"table\";' para descobrir quais tabelas existem.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "A query SQL pura para ser executada." }
                    },
                    required: ["query"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "execute_sql") {
        const { query } = request.params.arguments as any;
        console.log(`🗄️ Executando SQL via IA: ${query}`);
        
        try {
            const db = await getDbConnection();
            
            // Verifica o tipo de instrução para usar o método correto do SQLite
            const sqlLower = query.trim().toLowerCase();
            const isSelect = sqlLower.startsWith("select") || sqlLower.startsWith("pragma") || sqlLower.startsWith("explain");

            let resultText = "";

            if (isSelect) {
                // Para consultas que retornam dados
                const rows = await db.all(query);
                
                // Trunca o resultado se for muito grande para não estourar os tokens da IA
                let jsonResult = JSON.stringify(rows, null, 2);
                if (jsonResult.length > 8000) {
                    jsonResult = jsonResult.substring(0, 8000) + "\n... [RESULTADO TRUNCADO DEVIDO AO TAMANHO. TENTE USAR 'LIMIT' NA QUERY]";
                }
                
                resultText = `Sucesso! A query retornou ${rows.length} linha(s):\n${jsonResult}`;
            } else {
                // Para modificações (INSERT, UPDATE, DELETE)
                const result = await db.run(query);
                resultText = `Sucesso! Query executada. Linhas afetadas: ${result.changes}. Último ID inserido (se aplicável): ${result.lastID}`;
            }

            await db.close(); // Fecha a conexão para evitar travamentos
            return { content: [{ type: "text", text: resultText }] };

        } catch (error: any) {
            console.error(`❌ Erro no SQL: ${error.message}`);
            return { content: [{ type: "text", text: `Erro de Sintaxe ou Execução SQL: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);