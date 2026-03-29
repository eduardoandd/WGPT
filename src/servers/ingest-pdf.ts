import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs';
import { GoogleDocAILoader } from "../loaders/pdfOCRLoader.js";
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

// 1. Instanciamos o gestor de tarefas para os PDFs
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

        // Colocamos o processamento lento dentro de uma Promise
        const processPromise = async () => {
            try {
                if (!fs.existsSync(filePath)) {
                    throw new Error("Arquivo não encontrado.");
                }

                const dataBuffer = fs.readFileSync(filePath);

                const loader = new GoogleDocAILoader(dataBuffer, {
                    filteType: "pdf" 
                });

                const docs = await loader.load();

                if (docs.length === 0) {
                    console.warn("⚠️ O OCR processou o arquivo mas não retornou texto.");
                    throw new Error("OCR retornou vazio (PDF escaneado ou imagem sem texto?).");
                }

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
                // A limpeza do arquivo temporário agora fica dentro do finally da Promise assíncrona!
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

        // 2. O TaskManager toma conta de tudo e devolve apenas o ID!
        const taskId = taskManager.execute(processPromise());

        // 3. Força a IA a usar a tag [MONITOR_TASK...]
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