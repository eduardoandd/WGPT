import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as xlsx from 'xlsx';
import fs from 'fs';
import { AsyncTaskManager } from "../utils/async-task.js";

const server = new Server({ name: "spreadsheet-reader", version: "1.0.0" }, { capabilities: { tools: {} } });

// 1. Instanciamos o gestor de tarefas
const taskManager = new AsyncTaskManager();

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "read_spreadsheet_async",
                description: "Lê um ficheiro de planilha (Excel/CSV) e devolve os dados em formato JSON. ATENÇÃO: Esta é uma ferramenta assíncrona. Ela devolverá um Task ID. Você DEVE usar a tag [MONITOR_TASK: check_spreadsheet_task | ID] na sua resposta.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filePath: { type: "string", description: "O caminho local do ficheiro da planilha." }
                    },
                    required: ["filePath"]
                }
            },
            {
                name: "check_spreadsheet_task",
                description: "Verifica o resultado da leitura de uma planilha submetida anteriormente.",
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
    
    // 2. Inicia a tarefa de leitura assincronamente
    if (request.params.name === "read_spreadsheet_async") {
        const { filePath } = request.params.arguments as any;

        const readPromise = async () => {
            if (!fs.existsSync(filePath)) {
                throw new Error(`Ficheiro não encontrado em ${filePath}`);
            }

            // Lê o ficheiro Excel ou CSV
            const fileBuffer = fs.readFileSync(filePath);
            const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0]; // Pega na primeira aba
            const sheet = workbook.Sheets[sheetName];

            // Converte os dados da planilha para um Array de Objetos JSON
            const data = xlsx.utils.sheet_to_json(sheet);

            if (data.length === 0) {
                return "A planilha está vazia.";
            }

            // Pega um limite de linhas para não sobrecarregar a memória da IA (proteção)
            const maxRows = 1000;
            const isLarge = data.length > maxRows;
            const sampleData = isLarge ? data.slice(0, maxRows) : data;

            let resultText = `Planilha lida com sucesso! Aba: "${sheetName}". Total de linhas: ${data.length}.\n\n`;
            if (isLarge) {
                resultText += `Aviso: A planilha é muito grande. Mostrar apenas as primeiras ${maxRows} linhas para análise:\n`;
            }

            // Entrega os dados formatados
            resultText += JSON.stringify(sampleData, null, 2);

            return resultText;
        };

        // Adiciona a Promise ao gerenciador e pega o ID da tarefa
        const taskId = taskManager.execute(readPromise());

        return { 
            content: [{ 
                type: "text", 
                text: `SUCESSO! A leitura da planilha foi iniciada em background.\n\nINSTRUÇÃO OBRIGATÓRIA PARA A IA:\nCopie o ID exato abaixo e coloque na sua tag de monitorização.\nID: ${taskId}\nFerramenta: check_spreadsheet_task\nFormato esperado na sua resposta: [MONITOR_TASK: check_spreadsheet_task | ${taskId}]` 
            }] 
        };
    }

    // 3. Ferramenta de verificação de status
    if (request.params.name === "check_spreadsheet_task") {
        const { taskId } = request.params.arguments as any;
        return taskManager.check(taskId);
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);