import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({ name: "api-tester", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [{
            name: "make_http_request",
            description: "Faz uma requisição HTTP para uma API externa (como um Postman). Suporta métodos como GET, POST, PUT, DELETE. Retorna o status e a resposta (JSON ou texto).",
            inputSchema: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL completa da API (ex: https://api.exemplo.com/users)" },
                    method: { type: "string", description: "Método HTTP (GET, POST, PUT, DELETE, PATCH). O padrão é GET." },
                    headers: { type: "string", description: "Cabeçalhos (Headers) no formato de string JSON (ex: '{\"Authorization\": \"Bearer token\"}'). Opcional." },
                    body: { type: "string", description: "Corpo da requisição (Body) no formato string JSON. Usado em requisições POST e PUT. Opcional." }
                },
                required: ["url"]
            }
        }]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "make_http_request") {
        const { url, method = "GET", headers = "{}", body } = request.params.arguments as any;

        try {
            // Analisa os headers enviados pela IA
            let parsedHeaders = {};
            try {
                parsedHeaders = JSON.parse(headers);
            } catch (e) {
                return { content: [{ type: "text", text: "Erro: O campo headers deve ser um JSON válido." }], isError: true };
            }

            const fetchOptions: RequestInit = {
                method: method.toUpperCase(),
                headers: parsedHeaders,
            };

            // Adiciona o body se for um método compatível e injeta Content-Type padrão se não existir
            if (body && ["POST", "PUT", "PATCH"].includes(fetchOptions.method as string)) {
                fetchOptions.body = body;
                
                const hasContentType = Object.keys(parsedHeaders).some(k => k.toLowerCase() === 'content-type');
                if (!hasContentType) {
                    fetchOptions.headers = { ...parsedHeaders, 'Content-Type': 'application/json' };
                }
            }

            console.log(`🌐 Disparando requisição: ${fetchOptions.method} ${url}`);
            const response = await fetch(url, fetchOptions);
            
            // Identifica o tipo de resposta para fazer o parse correto
            let responseData;
            const contentType = response.headers.get("content-type") || "";
            
            if (contentType.includes("application/json")) {
                responseData = await response.json();
            } else {
                responseData = await response.text();
            }

            const responseToAgent = {
                status: response.status,
                statusText: response.statusText,
                data: responseData
            };

            let resultText = JSON.stringify(responseToAgent, null, 2);
            const MAX_LENGTH = 6000;
            if (resultText.length > MAX_LENGTH) {
                resultText = resultText.substring(0, MAX_LENGTH) + "\n\n... [RESPOSTA TRUNCADA DEVIDO AO TAMANHO. A API RETORNOU MUITOS DADOS]";
            }

            return { content: [{ type: "text", text: `Requisição concluída:\n${resultText}` }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Falha ao fazer a requisição HTTP: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);