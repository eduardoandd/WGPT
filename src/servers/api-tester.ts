import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({ name: "api-tester", version: "1.0.0" }, { capabilities: { tools: {} } });

// =========================================================================
// FUNÇÃO AUXILIAR: Obtém o token automaticamente da Credify
// =========================================================================
async function getCredifyToken(): Promise<string> {
    const authUrl = "https://api.credify.com.br/auth";
    
    console.log("🔐 Solicitando novo token à Credify...");
    
    // NOTA: O fetch nativo não aceita 'body' no método 'GET'. 
    // Usamos 'POST' aqui assumindo que a API aceita este método para receber o JSON no corpo da requisição.
    const response = await fetch(authUrl, {
        method: "POST", 
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "ClientID": "37518",
            "ClientSecret": "28551090"
        })
    });

    if (!response.ok) {
        throw new Error(`Erro na API de autenticação (${response.status}): ${response.statusText}`);
    }

    const data = await response.json();
    
    // Valida se o retorno foi sucesso e possui a chave 'Dados' (onde está o token)
    if (data.Sucess && data.Dados) {
        console.log("✅ Token gerado com sucesso!");
        return data.Dados;
    } else {
        throw new Error("Token não encontrado na resposta de autenticação.");
    }
}

// =========================================================================
// DEFINIÇÃO DA FERRAMENTA PARA A IA (Sem pedir headers)
// =========================================================================
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [{
            name: "make_http_request",
            description: "Faz uma requisição HTTP para a API (ex: Credify). O Token Bearer de autenticação é gerado e injetado automaticamente nos headers, não te preocupes com isso.",
            inputSchema: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL completa do Endpoint da API." },
                    method: { type: "string", description: "Método HTTP (GET, POST, PUT, DELETE, PATCH). O padrão é GET." },
                    body: { type: "string", description: "Corpo da requisição (Body) no formato string JSON. Usado nas requisições POST e PUT. Opcional." }
                },
                required: ["url"]
            }
        }]
    };
});

// =========================================================================
// EXECUÇÃO DA FERRAMENTA
// =========================================================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "make_http_request") {
        const { url, method = "GET", body } = request.params.arguments as any;

        try {
            // 1. Pega o Token atualizado de forma invisível para o usuário
            const token = await getCredifyToken();

            // 2. Prepara os Headers padrões forçando o Bearer Token
            const fetchOptions: RequestInit = {
                method: method.toUpperCase(),
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
            };

            // 3. Injeta o body se a requisição o exigir
            if (body && ["POST", "PUT", "PATCH"].includes(fetchOptions.method as string)) {
                fetchOptions.body = body;
            }

            console.log(`🌐 Disparando requisição principal: ${fetchOptions.method} ${url}`);
            const response = await fetch(url, fetchOptions);
            
            // Identifica o tipo de resposta para fazer o parse correto
            let responseData;
            const contentType = response.headers.get("content-type") || "";
            
            if (contentType.includes("application/json")) {
                responseData = await response.json();
            } else {
                responseData = await response.text();
            }

            // Estrutura a resposta de forma clara para a IA ler
            const responseToAgent = {
                status: response.status,
                statusText: response.statusText,
                data: responseData
            };

            let resultText = JSON.stringify(responseToAgent, null, 2);
            
            // Trunca a resposta caso a API devolva listas imensas
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