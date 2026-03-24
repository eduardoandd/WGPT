import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as xlsx from 'xlsx';
import fs from 'fs';

const server = new Server({ name: "spreadsheet-reader", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [{
            name: "read_spreadsheet",
            description: "Lê um ficheiro de planilha (Excel/CSV) e devolve os dados em formato JSON. Use esta ferramenta IMEDIATAMENTE após o utilizador enviar uma planilha para analisar os dados, somar valores, encontrar padrões ou responder a perguntas.",
            inputSchema: {
                type: "object",
                properties: {
                    filePath: { type: "string", description: "O caminho local do ficheiro da planilha." }
                },
                required: ["filePath"]
            }
        }]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "read_spreadsheet") {
        const { filePath } = request.params.arguments as any;

        if (!fs.existsSync(filePath)) {
            return { content: [{ type: "text", text: `Erro: Ficheiro não encontrado em ${filePath}` }], isError: true };
        }

        try {
            // Lê o ficheiro Excel ou CSV
            const fileBuffer = fs.readFileSync(filePath);
            const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0]; // Pega na primeira aba
            const sheet = workbook.Sheets[sheetName];

            // Converte os dados da planilha para um Array de Objetos JSON
            const data = xlsx.utils.sheet_to_json(sheet);

            if (data.length === 0) {
                return { content: [{ type: "text", text: "A planilha está vazia." }] };
            }

            // Pega um limite de linhas para não sobrecarregar a memória da IA (proteção)
            const maxRows = 1000;
            const isLarge = data.length > maxRows;
            const sampleData = isLarge ? data.slice(0, maxRows) : data;

            let resultText = `Planilha lida com sucesso! Aba: "${sheetName}". Total de linhas: ${data.length}.\n\n`;
            if (isLarge) {
                resultText += `Aviso: A planilha é muito grande. Mostrar apenas as primeiras ${maxRows} linhas para análise:\n`;
            }

            // Entrega os dados formatados para a IA analisar
            resultText += JSON.stringify(sampleData, null, 2);

            return { content: [{ type: "text", text: resultText }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Erro ao ler a planilha: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);