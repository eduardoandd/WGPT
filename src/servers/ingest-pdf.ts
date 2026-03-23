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
import "dotenv/config";
import { getDb } from "../utils/database.js";

const server = new Server(
    { name: "ingest-pdf", version: "2.0.0" },
    {
        capabilities: {
            tools: {}
        }
    }
)

const ensureCollectionIndexes = async () => {

    try {

        await qdrantClient.createPayloadIndex('pdfs', {
            field_name: "metadata.userPhoneNumber",
            field_schema: "keyword",
            wait: true
        })

        await qdrantClient.createPayloadIndex('pdfs', {
            field_name: "metadata.fileName",
            field_schema: "keyword",
            wait: true
        });



    } catch (error) {
        console.warn("⚠️ Erro na criação de índices (pode já existir):", error);
    }


}

server.setRequestHandler(ListToolsRequestSchema, async () => {

    return {

        tools: [
            {
                name: "ingest-pdf",
                description: "Transforma os dados de um documento PDF em embeddings",
                inputSchema: {

                    type: "object",
                    properties: {

                        filePath: {
                            type: "string",
                            description: "Caminho do arquivo PDF"
                        },
                        userPhoneNumber: {
                            type: "string",
                            description: "Número do contato que mandou essa mensagem"
                        },
                        fileName: {
                            type: "string",
                            description: "Nome que daremos ao arquivo (ex: contrato_aluguel.pdf)"
                        }

                    },
                    required: ['filePath', 'userPhoneNumber', 'fileName']

                }
            }
        ]

    }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {

    switch (request.params.name) {

        case "ingest-pdf": {

            const { filePath, userPhoneNumber, fileName } = request.params.arguments as { filePath: string, userPhoneNumber: string, fileName: string };

            try {

                // validação de segurança
                if (!fs.existsSync(filePath)) {
                    throw new Error("Arquivo não encontrado.");
                }

                // leitura
                const dataBuffer = fs.readFileSync(filePath)



                const loader = new GoogleDocAILoader(dataBuffer, {
                    filteType: "pdf"
                });

                // analise ocr
                const docs = await loader.load();

                if (docs.length === 0) {
                    console.warn("⚠️ O OCR processou o arquivo mas não retornou texto.");
                    throw new Error("OCR retornou vazio (PDF escaneado ou imagem sem texto?).");
                }

                // instancia splitter
                const textSplitter = new RecursiveCharacterTextSplitter({
                    chunkSize: 1000,
                    chunkOverlap: 200,
                    separators: ["\n\n", "\n", " ", ""]
                });

                // splits
                const allSplits = await textSplitter.splitDocuments(docs);

                const textForSummary = allSplits.slice(0, 3).map(split => split.pageContent).join("\n\n")

                const summaryPrompt = ChatPromptTemplate.fromTemplate(`
                    
                    Você é lê o contexto e elabora um resumo curto dele.

                    contexto:
                    ------
                    {context}
                    ------
                
                `)

                const response = await summaryPrompt.pipe(fastModel).invoke({ context: textForSummary })


                // injeção de Metadados
                const splitsWithMetadata = allSplits.map((split) => {
                    split.metadata = {
                        ...split.metadata,
                        userPhoneNumber: userPhoneNumber,
                        fileName: fileName
                    };
                    return split;
                });

                // instanciando
                const vectorStore = await qdrantVectorStore("pdfs", smallOpenAiEmbedding);


                //inserindo dados
                await vectorStore.addDocuments(splitsWithMetadata).catch((err: any) => {
                    throw new Error(`Falha ao inserir vetores: ${err.message}`);
                });


                await ensureCollectionIndexes();

                const db = await getDb()
                const today = new Date().toISOString()
                await db.run(
                    'INSERT INTO librarian (userPhoneNumber, fileName, uploadDate, shortSummary,extension) VALUES (?, ?, ?, ?,?)',
                    [userPhoneNumber,fileName,today, response.content,'pdf']
                )

                return {
                    content: [
                        {
                            type: "text",
                            text: `Sucesso! O arquivo ${fileName} foi processado. Aqui está o resumo gerado: ${response.content}`
                        }
                    ]
                }


            } catch (error: any) {

                console.error("Erro na ferramenta ingest-pdf:", error);
                return {
                    content: [{ type: "text", text: `Ocorreu um erro ao processar o PDF: ${error.message}` }],
                    isError: true
                };

            }
            finally {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log(`🧹 Arquivo temporário removido: ${filePath}`);
                    }
                } catch (cleanupError) {
                    console.error(`Falha ao limpar arquivo temporário ${filePath}:`, cleanupError);
                }
            }

        

        }

        default: {
            return {
                content: [{ type: "text", text: `Ferramenta desconhecida: ${request.params.name}` }],
                isError: true
            };
        }
        

    }
})

async function main() {
    const transport = new StdioServerTransport()

    server.connect(transport).catch(console.error)

}

main()