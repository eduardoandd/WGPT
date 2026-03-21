import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../utils/database.js";


const server = new Server(
    { name: "librarian-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
)


server.setRequestHandler(ListToolsRequestSchema, async () => {

    return {

        tools: [
            {
                name: "list_my_files",
                description: "Consulta o catálogo de files salvos do usuário.",
                inputSchema: {
                    type: "object",
                    properties: {
                        userPhoneNumber: {
                            type: "string",
                            description: "Número do contato do usuário para filtrar os arquivos dele."
                        },
                        
                    },
                    required: ["userPhoneNumber"]
                }
            }
        ]
    }

})

server.setRequestHandler(CallToolRequestSchema, async(request) => {

    switch(request.params.name){

        case "list_my_files": {

            const {userPhoneNumber} = request.params.arguments as { userPhoneNumber: string };

            try {

                const db = await getDb()

                const files = await db.all(
                    `SELECT fileName, uploadDate, shortSummary, extension FROM librarian WHERE userPhoneNumber = ?`,
                    [userPhoneNumber]
                );

                if (files.length === 0) {
                    return {
                        content: [{ type: "text", text: "Você ainda não possui nenhum arquivo salvo no sistema." }]
                    };
                }

                let respostaIA = `Encontrei ${files.length} arquivo(s) para este usuário:\n\n`;
                
                files.forEach((arq:any, index:any) => {
                    respostaIA += `${index + 1}. Arquivo: ${arq.fileName}\n`;
                    respostaIA += `   Data de Envio: ${arq.uploadDate}\n`;
                    respostaIA += `   Tipo: ${arq.extension}\n`;
                    respostaIA += `   Resumo: ${arq.shortSummary}\n\n`;
                });

                return {
                    content: [{ type: "text", text: respostaIA }]
                };
                


            } catch (error:any) {
                console.error("Erro na ferramenta listar_meus_arquivos:", error);
                return {
                    content: [{ type: "text", text: `Erro ao acessar o catálogo: ${error.message}` }],
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
})

async function main() {
    const transport = new StdioServerTransport()

    server.connect(transport).catch(console.error)

}

main()
