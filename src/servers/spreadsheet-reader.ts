import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { fastModel } from "../utils/models.js";
import * as xlsx from 'xlsx';
import fs from 'fs';
import "dotenv/config";

const server = new Server({ name: "spreadsheet-agent", version: "2.0.0" }, { capabilities: { tools: {} } });

// Ferramenta: ler planilha
const readSpreadsheet = tool(
    async ({ filePath, maxRows = 500 }) => {
        console.error(`📊 [Spreadsheet Agent] Lendo planilha: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Arquivo não encontrado: ${filePath}`);
        }

        const fileBuffer = fs.readFileSync(filePath);
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

        let result = `Planilha carregada. Abas disponíveis: ${workbook.SheetNames.join(", ")}\n\n`;

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(sheet) as any[];

            if (data.length === 0) {
                result += `Aba "${sheetName}": vazia.\n`;
                continue;
            }

            const isLarge = data.length > maxRows;
            const sample = isLarge ? data.slice(0, maxRows) : data;

            result += `Aba: "${sheetName}" — ${data.length} linha(s) no total`;
            if (isLarge) result += ` (mostrando primeiras ${maxRows})`;
            result += `\nColunas: ${Object.keys(sample[0]).join(", ")}\n`;
            result += JSON.stringify(sample, null, 2);
            result += "\n\n";

            // Trunca se muito grande
            if (result.length > 12000) {
                result = result.substring(0, 12000) + "\n... [DADOS TRUNCADOS]";
                break;
            }
        }

        return result;
    },
    {
        name: "read_spreadsheet",
        description: "Lê um arquivo de planilha (Excel .xlsx, .xls ou CSV) e retorna os dados para análise.",
        schema: z.object({
            filePath: z.string().describe("Caminho completo do arquivo de planilha"),
            maxRows: z.number().optional().default(500).describe("Máximo de linhas por aba (padrão: 500)")
        })
    }
);

const spreadsheetTools = [readSpreadsheet];

const SYSTEM_PROMPT = `Você é um especialista em análise de dados e planilhas.
Você recebe o caminho de um arquivo e uma pergunta do usuário. Use a ferramenta read_spreadsheet para carregar os dados e responda com insights relevantes.

Diretrizes de análise:
- Calcule totais, médias, máximos e mínimos quando relevante
- Identifique padrões, tendências e anomalias nos dados
- Destaque os TOP itens (top 5 vendas, maiores gastos, etc.)
- Se a planilha tiver múltiplas abas, analise todas que forem relevantes
- Responda o que o usuário perguntou de forma direta e clara

FORMATAÇÃO (WhatsApp):
- Use *negrito* para valores e destaques importantes
- Use emojis expressivos (📊 análise, 📈 crescimento, 📉 queda, 🏆 top, ⚠️ anomalia)
- NUNCA crie tabelas Markdown — use listas com hífen
- Separe seções com linha em branco`;

const spreadsheetAgent = createReactAgent({
    llm: fastModel,
    tools: spreadsheetTools,
    stateModifier: SYSTEM_PROMPT
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ask_spreadsheet_specialist",
                description: "Aciona o agente especialista em planilhas. Ele lê o arquivo, analisa os dados e retorna insights interpretados em linguagem natural. Use quando o usuário enviar uma planilha ou pedir análise de dados.",
                inputSchema: {
                    type: "object",
                    properties: {
                        question: {
                            type: "string",
                            description: "O pedido do usuário (ex: 'Faça uma análise completa', 'Qual o produto mais vendido?', 'Mostre os totais por categoria')"
                        },
                        filePath: {
                            type: "string",
                            description: "Caminho completo do arquivo de planilha salvo localmente"
                        }
                    },
                    required: ["question", "filePath"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "ask_spreadsheet_specialist") {
        const { question, filePath } = request.params.arguments as { question: string; filePath: string };

        try {
            console.error(`\n🧠 [Spreadsheet Agent] Iniciando análise: "${question}" | Arquivo: ${filePath}`);

            const fullQuestion = `Arquivo da planilha: ${filePath}\n\nPergunta do usuário: ${question}`;

            const result = await spreadsheetAgent.invoke({
                messages: [new HumanMessage(fullQuestion)]
            });

            const lastMessage = result.messages[result.messages.length - 1];
            const answer = typeof lastMessage.content === "string"
                ? lastMessage.content
                : JSON.stringify(lastMessage.content);

            console.error("✅ [Spreadsheet Agent] Análise concluída.");
            return { content: [{ type: "text", text: answer }] };

        } catch (error: any) {
            console.error("❌ [Spreadsheet Agent] Erro:", error.message);
            return { content: [{ type: "text", text: `Erro ao analisar planilha: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: "Ferramenta desconhecida" }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Servidor MCP 'spreadsheet-agent v2' conectado via stdio!");
}

runServer().catch(console.error);
