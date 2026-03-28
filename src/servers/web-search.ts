import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({ name: "web-search", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [{
            name: "web_search",
            description: "Faz uma pesquisa em tempo real na internet para procurar notícias, dados atualizados, concorrentes, cotações ou tendências de mercado. Use sempre que o usuário perguntar sobre eventos recentes ou informações que você não tem no seu conhecimento base.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "O termo exato de busca (ex: 'cotação do dólar hoje', 'notícias sobre IA no varejo no Brasil')." }
                },
                required: ["query"]
            }
        }]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "web_search") {
        const { query } = request.params.arguments as any;
        const apiKey = process.env.TAVILY_API_KEY;

        if (!apiKey) {
            return { content: [{ type: "text", text: "Erro: A TAVILY_API_KEY não está configurada no ficheiro .env" }], isError: true };
        }

        try {
            console.log(`🔍 Pesquisando na Web por: "${query}"`);

            // Fazendo a requisição nativa usando fetch para a API da Tavily
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    query: query,
                    search_depth: "basic", // Retorna resultados mais rápidos
                    include_answer: true,  // Pede à Tavily para tentar gerar uma resposta direta
                    max_results: 5         // Limita a 5 fontes para não estourar os tokens da sua IA
                })
            });

            if (!response.ok) {
                throw new Error(`Erro na API de busca: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();

            // Monta uma resposta estruturada e limpa para a sua IA (LangChain) processar
            let resultText = `Resultados da pesquisa na web para "${query}":\n\n`;

            if (data.answer) {
                resultText += `Resumo Direto da Web: ${data.answer}\n\n`;
            }

            resultText += `Principais Fontes Encontradas:\n`;
            data.results.forEach((item: any, index: number) => {
                resultText += `${index + 1}. Título: ${item.title}\n   URL: ${item.url}\n   Conteúdo: ${item.content}\n\n`;
            });

            return { content: [{ type: "text", text: resultText }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Falha ao pesquisar na web: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);