import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import puppeteer from 'puppeteer';
import path from 'path';
import os from 'os';
import { marked } from 'marked'; // Adicione a importação


const server = new Server({ name: "report-generator", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [{
            name: "generate_pdf_report",
            description: "Gera um relatório em PDF baseado em um conteúdo HTML formatado. Use esta ferramenta quando o usuário pedir um relatório gerado.",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Título do relatório" },
                    markdownContent: { type: "string", description: "Conteúdo do relatório escrito em Markdown (tabelas, listas, negrito, etc)." },
                    fileName: { type: "string", description: "Nome do arquivo (ex: relatorio_financeiro.pdf)" }
                },
                required: ["title", "markdownContent", "fileName"]
            }
        }]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "generate_pdf_report") {
        const { title, markdownContent, fileName } = request.params.arguments as any;

        // Converte o Markdown que a IA gerou para HTML de verdade
        const htmlConverted = await marked.parse(markdownContent);

        const fullHtml = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica', Arial, sans-serif; padding: 40px; color: #333; }
            /* Estilos básicos para tabelas ficarem bonitas no PDF */
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #005c4b; color: white; }
            .header { text-align: center; border-bottom: 2px solid #005c4b; padding-bottom: 20px; margin-bottom: 30px; }
            /* ... resto do seu CSS ... */
        </style>
    </head>
    <body>
        <div class="header">
            <h1>${title}</h1>
        </div>
        <div class="content">
            ${htmlConverted} </div>
    </body>
    </html>
`;

        const filePath = path.join(os.tmpdir(), fileName);

        try {
            // Inicializa o Puppeteer e gera o PDF
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
            await page.pdf({ path: filePath, format: 'A4', printBackground: true });
            await browser.close();

            // Retorna uma instrução específica para a IA repassar ao cliente
            return {
                content: [{
                    type: "text",
                    text: `O PDF foi gerado com sucesso em ${filePath}.\n\nINSTRUÇÃO OBRIGATÓRIA: A sua resposta final para o usuário DEVE conter a tag do arquivo. Copie e cole EXATAMENTE o texto abaixo como sua resposta final, sem adicionar mais nenhuma palavra:\n\nO documento está pronto! [SEND_PDF:${filePath}]`
                }]
            };
        } catch (error: any) {
            console.error("❌ ERRO FATAL AO GERAR PDF:", error);
            return { content: [{ type: "text", text: `Erro ao gerar PDF: ${error.message}` }], isError: true };
        }
    }

    return {
        content: [{ type: "text", text: `Ferramenta desconhecida: ${request.params.name}` }],
        isError: true
    };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Servidor MCP 'retriever-pdf' conectado e rodando via stdio!");
}

runServer().catch((error) => {
    console.error("❌ Erro fatal no servidor MCP retriever:", error);
    process.exit(1);
});