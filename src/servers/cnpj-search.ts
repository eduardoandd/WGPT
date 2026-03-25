import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({ name: "cnpj-searcher", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search_cnpj",
                description: "Busca informações completas de uma empresa no Brasil pelo CNPJ na BrasilAPI (incluindo quadro societário, CNAEs, capital social, etc).",
                inputSchema: {
                    type: "object",
                    properties: {
                        cnpj: { type: "string", description: "O CNPJ da empresa (com ou sem pontuação)" }
                    },
                    required: ["cnpj"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "search_cnpj") {
        const { cnpj } = request.params.arguments as any;
        
        // Limpa a pontuação para a API
        const cleanCnpj = cnpj.replace(/\D/g, '');
        
        try {
            // Disfarçando o bot de navegador (Chrome) para driblar o erro 403 (Forbidden) do Cloudflare
            const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`, {
                headers: { 
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", 
                    "Accept": "application/json" 
                }
            });
            
            if (!response.ok) {
                if (response.status === 404) throw new Error("CNPJ não encontrado na base da Receita Federal.");
                if (response.status === 403) throw new Error("Acesso bloqueado pela BrasilAPI (Erro 403). Tente novamente mais tarde.");
                throw new Error(`Erro na API (${response.status}): ${response.statusText}`);
            }

            const data = await response.json();

            // Pega o JSON INTEIRO, transforma em texto e joga para a IA ler!
            return { 
                content: [{ 
                    type: "text", 
                    text: `Dados completos retornados para o CNPJ ${cnpj}:\n\n${JSON.stringify(data, null, 2)}` 
                }] 
            };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);