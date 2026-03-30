import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import puppeteer from 'puppeteer';
import path from 'path';
import os from 'os';
import { marked } from 'marked';
import { AsyncTaskManager } from "../utils/async-task.js"; // Adicionado

const server = new Server({ name: "report-generator", version: "1.0.0" }, { capabilities: { tools: {} } });

// 1. Instanciamos o gestor de tarefas
const taskManager = new AsyncTaskManager();

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "generate_pdf_report_async",
                description: "Gera um relatório em PDF baseado em um conteúdo HTML formatado. ATENÇÃO: Esta é uma ferramenta assíncrona. Ela devolverá um Task ID. Você DEVE usar a tag [MONITOR_TASK: check_report_task | ID] na sua resposta.",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Título do relatório" },
                        markdownContent: { type: "string", description: "Conteúdo do relatório escrito em Markdown (tabelas, listas, negrito, etc)." },
                        fileName: { type: "string", description: "Nome do arquivo (ex: relatorio_financeiro.pdf)" }
                    },
                    required: ["title", "markdownContent", "fileName"]
                }
            },
            {
                name: "check_report_task",
                description: "Verifica o resultado da geração de um PDF submetida anteriormente.",
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
    
    // 2. Inicia a tarefa de geração de PDF assincronamente
    if (request.params.name === "generate_pdf_report_async") {
        const { title, markdownContent, fileName } = request.params.arguments as any;

        const reportPromise = async () => {
            const htmlConverted = await marked.parse(markdownContent);

            const fullHtml = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Helvetica', Arial, sans-serif; padding: 40px; color: #333; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #005c4b; color: white; }
                    .header { text-align: center; border-bottom: 2px solid #005c4b; padding-bottom: 20px; margin-bottom: 30px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>${title}</h1>
                </div>
                <div class="content">
                    ${htmlConverted} 
                </div>
            </body>
            </html>
            `;

            const filePath = path.join(os.tmpdir(), fileName);

            // Inicializa o Puppeteer e gera o PDF
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
            await page.pdf({ path: filePath, format: 'A4', printBackground: true });
            await browser.close();

            // Retorna a instrução para que a IA mande a TAG de envio no momento em que a task finalizar
            return `O PDF foi gerado com sucesso em ${filePath}.\n\nINSTRUÇÃO OBRIGATÓRIA: A sua resposta final para o usuário DEVE conter a tag do arquivo. Copie e cole EXATAMENTE o texto abaixo como sua resposta final, sem adicionar mais nenhuma palavra:\n\nO documento está pronto! [SEND_PDF:${filePath}]`;
        };

        // Adiciona a Promise ao gerenciador e pega o ID da tarefa
        const taskId = taskManager.execute(reportPromise());

        return {
            content: [{
                type: "text",
                text: `SUCESSO! A geração do relatório foi iniciada em background.\n\nINSTRUÇÃO OBRIGATÓRIA PARA A IA:\nCopie o ID exato abaixo e coloque na sua tag de monitorização.\nID: ${taskId}\nFerramenta: check_report_task\nFormato esperado na sua resposta: [MONITOR_TASK: check_report_task | ${taskId}]`
            }]
        };
    }

    // 3. Ferramenta de verificação de status
    if (request.params.name === "check_report_task") {
        const { taskId } = request.params.arguments as any;
        return taskManager.check(taskId);
    }

    return {
        content: [{ type: "text", text: `Ferramenta desconhecida: ${request.params.name}` }],
        isError: true
    };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Servidor MCP 'report-generator' conectado e rodando via stdio!");
}

runServer().catch((error) => {
    console.error("❌ Erro fatal no servidor MCP report-generator:", error);
    process.exit(1);
});