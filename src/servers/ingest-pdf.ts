import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs';
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = require("pdf-parse");
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { fastModel } from "../utils/models.js";
import { qdrantClient, qdrantVectorStore } from "../utils/store.js";
import { smallOpenAiEmbedding } from "../utils/embeddings.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AsyncTaskManager } from "../utils/async-task.js";
import "dotenv/config";
import { getDb } from "../utils/database.js";

const server = new Server(
    { name: "ingest-pdf", version: "2.0.0" },
    { capabilities: { tools: {} } }
);

const taskManager = new AsyncTaskManager();

const ensureCollectionIndexes = async () => {
    try {
        await qdrantClient.createPayloadIndex('pdfs', {
            field_name: "metadata.userPhoneNumber",
            field_schema: "keyword",
            wait: true
        });
        await qdrantClient.createPayloadIndex('pdfs', {
            field_name: "metadata.fileName",
            field_schema: "keyword",
            wait: true
        });
    } catch (error) {
        console.warn("⚠️ Erro na criação de índices (pode já existir):", error);
    }
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ingest_pdf_async", // <-- Nome atualizado
                description: "Transforma os dados de um documento PDF em embeddings. ATENÇÃO: Esta é uma ferramenta assíncrona. Ela devolverá um Task ID. Você DEVE usar a tag [MONITOR_TASK: check_pdf_task | ID] na sua resposta.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filePath: { type: "string", description: "Caminho do arquivo PDF" },
                        userPhoneNumber: { type: "string", description: "Número do contato que mandou essa mensagem" },
                        fileName: { type: "string", description: "Nome que daremos ao arquivo (ex: contrato_aluguel.pdf)" }
                    },
                    required: ['filePath', 'userPhoneNumber', 'fileName']
                }
            },
            {
                name: "check_pdf_task", // <-- Nova ferramenta de verificação
                description: "Verifica o resultado do processamento e ingestão de um PDF submetido anteriormente.",
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

    if (request.params.name === "ingest_pdf_async") {
        const { filePath, userPhoneNumber, fileName } = request.params.arguments as { filePath: string, userPhoneNumber: string, fileName: string };

        const processPromise = async () => {
            try {
                if (!fs.existsSync(filePath)) {
                    throw new Error("Arquivo não encontrado.");
                }

                const dataBuffer = fs.readFileSync(filePath);
                const parsed = await pdfParse(dataBuffer);

                if (!parsed.text?.trim()) {
                    throw new Error("Nenhum texto encontrado no PDF. O arquivo pode estar vazio ou ser baseado em imagens.");
                }

                const docs = [{ pageContent: parsed.text, metadata: {} }];

                const textSplitter = new RecursiveCharacterTextSplitter({
                    chunkSize: 1000,
                    chunkOverlap: 200,
                    separators: ["\n\n", "\n", " ", ""]
                });

                const allSplits = await textSplitter.splitDocuments(docs);
                const textForSummary = allSplits.slice(0, 3).map(split => split.pageContent).join("\n\n");

                const summaryPrompt = ChatPromptTemplate.fromTemplate(`
                    Você lê o contexto e elabora um resumo curto dele.
                    contexto:
                    ------
                    {context}
                    ------
                `);

                const response = await summaryPrompt.pipe(fastModel).invoke({ context: textForSummary });

                const splitsWithMetadata = allSplits.map((split) => {
                    split.metadata = {
                        ...split.metadata,
                        userPhoneNumber: userPhoneNumber,
                        fileName: fileName
                    };
                    return split;
                });

                const vectorStore = await qdrantVectorStore("pdfs", smallOpenAiEmbedding);

                await vectorStore.addDocuments(splitsWithMetadata).catch((err: any) => {
                    throw new Error(`Falha ao inserir vetores no Qdrant: ${err.message}`);
                });

                await ensureCollectionIndexes();

                const db = await getDb();
                const today = new Date().toISOString();
                await db.run(
                    'INSERT INTO librarian (userPhoneNumber, fileName, uploadDate, shortSummary, extension) VALUES (?, ?, ?, ?, ?)',
                    [userPhoneNumber, fileName, today, response.content, 'pdf']
                );

                return `Sucesso! O arquivo ${fileName} foi lido, processado e salvo na base de dados. Resumo gerado: ${response.content}`;

            } finally {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log(`🧹 Arquivo temporário removido: ${filePath}`);
                    }
                } catch (cleanupError) {
                    console.error(`Falha ao limpar arquivo temporário ${filePath}:`, cleanupError);
                }
            }
        };

        const taskId = taskManager.execute(processPromise());

        return {
            content: [{ 
                type: "text", 
                text: `SUCESSO! A leitura do PDF foi iniciada em background.\n\nINSTRUÇÃO OBRIGATÓRIA PARA A IA:\nCopie o ID exato abaixo e coloque na sua tag de monitorização.\nID: ${taskId}\nFerramenta: check_pdf_task\nFormato esperado na sua resposta: [MONITOR_TASK: check_pdf_task | ${taskId}]` 
            }]
        };
    }

    if (request.params.name === "check_pdf_task") {
        const { taskId } = request.params.arguments as any;
        return taskManager.check(taskId);
    }

    return {
        content: [{ type: "text", text: `Ferramenta desconhecida: ${request.params.name}` }],
        isError: true
    };
});

async function main() {
    const transport = new StdioServerTransport();
    server.connect(transport).catch(console.error);
}

main();