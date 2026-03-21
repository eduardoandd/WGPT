import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { qdrantClient, qdrantVectorStore } from "../utils/store.js";
import { smallOpenAiEmbedding } from "../utils/embeddings.js";


const server = new Server(
    { name: "retriever-pdf", version: "2.0.0" },
    {
        capabilities: {
            tools: {}
        }
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "retriever-pdf",
                description: "Busca informações semânticas nos arquivos PDF salvos previamente. Use esta ferramenta para responder a perguntas do usuário sobre o conteúdo dos seus documentos.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "A pergunta ou termo de busca (ex: 'Qual o valor total?' ou 'Resumo do contrato')."
                        },
                        userPhoneNumber: {
                            type: "string",
                            description: "Número do contato atrelado ao PDF. Usado para filtrar a busca no banco de dados."
                        }
                    },
                    required: ["query", "userPhoneNumber"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {

        case "retriever-pdf": {
            const { query, userPhoneNumber } = request.params.arguments as { query: string, userPhoneNumber: string };

            try {
                // 1. Instancia a conexão com a sua collection do Qdrant
                const vectorStore = await qdrantVectorStore("pdfs", smallOpenAiEmbedding);

                // 2. Faz a busca semântica! 
                // O LangChain permite passar um filtro no 3º argumento. Vamos pedir os 4 trechos mais relevantes.
                const searchResults = await vectorStore.similaritySearch(query, 4, {
                    must: [
                        {
                            key: "metadata.userPhoneNumber",
                            match: {
                                value: userPhoneNumber
                            }
                        }
                    ]
                });
                // Se o usuário não tiver PDFs ou não achar nada parecido:
                if (searchResults.length === 0) {
                    return {
                        content: [{ type: "text", text: "Nenhuma informação relevante foi encontrada no banco de dados para este usuário." }]
                    };
                }

                // 3. Monta a resposta formatando os "pedaços" (chunks) recuperados para a IA ler
                let contextText = `Encontrei ${searchResults.length} trechos relevantes nos documentos:\n\n`;

                searchResults.forEach((doc, index) => {
                    // Tentamos pegar a página do metadata, se você salvou isso no loader
                    const page = doc.metadata.pageNumber ? `(Página ${doc.metadata.pageNumber})` : '';
                    contextText += `--- TRECHO ${index + 1} ${page} ---\n${doc.pageContent}\n\n`;
                });

                // 4. Retorna todo esse texto rico para a IA. Ela vai ler e compor a resposta final pro WhatsApp.
                return {
                    content: [{ type: "text", text: contextText }]
                };

            } catch (error: any) {
                console.error("Erro na ferramenta retriever-pdf:", error);
                return {
                    content: [{ type: "text", text: `Erro interno ao buscar no banco de dados: ${error.message}` }],
                    isError: true
                };
            }
        }

        default: {
            return {
                content: [{ type: "text", text: `Ferramenta desconhecida: ${request.params.name}` }],
                isError: true
            };
        }
    }
});

// Inicializa a comunicação Stdio (Igual fizemos no ingest-pdf)
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Servidor MCP 'retriever-pdf' conectado e rodando via stdio!");
}

runServer().catch((error) => {
    console.error("❌ Erro fatal no servidor MCP retriever:", error);
    process.exit(1);
});