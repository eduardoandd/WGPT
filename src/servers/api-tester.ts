import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AsyncTaskManager } from "../utils/async-task.js";

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

const taskManager = new AsyncTaskManager();

// =========================================================================
// DEFINIÇÃO DA FERRAMENTA PARA A IA (Sem pedir headers)
// =========================================================================
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [{
            name: "make_http_request_async", // <-- Nome alterado para refletir que é assíncrono
            description: "Faz uma requisição HTTP pesada. ATENÇÃO: Esta é uma ferramenta assíncrona. Ela devolverá um Task ID. Você DEVE usar a tag [MONITOR_TASK: check_api_task | ID] na sua resposta.",
            inputSchema: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL completa do Endpoint da API." },
                    method: { type: "string", description: "Método HTTP (GET, POST, PUT, DELETE, PATCH). O padrão é GET." },
                    body: { type: "string", description: "Corpo da requisição (Body) no formato string JSON. Usado nas requisições POST e PUT. Opcional." }
                },
                required: ["url"]
            },

        },
        {
            name: "check_api_task",
            description: "Verifica o resultado de uma requisição de API submetida anteriormente.",
            inputSchema: {
                type: "object",
                properties: { taskId: { type: "string" } },
                required: ["taskId"]
            }
        }

        ]
    };
});

// =========================================================================
// EXECUÇÃO DA FERRAMENTA
// =========================================================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    
    if (request.params.name === "make_http_request_async") {
        const { url, method = "GET", body } = request.params.arguments as any;

        const apiPromise = async () => {
            const token = await getCredifyToken();
            const fetchOptions: RequestInit = {
                method: method.toUpperCase(),
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            };
            if (body && ["POST", "PUT", "PATCH"].includes(fetchOptions.method as string)) {
                fetchOptions.body = body;
            }
            const response = await fetch(url, fetchOptions);
            const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
            return { status: response.status, data };
        };

        const taskId = taskManager.execute(apiPromise());

        return { 
            content: [{ 
                type: "text", 
                text: `SUCESSO! A requisição foi para background.\n\nINSTRUÇÃO OBRIGATÓRIA PARA A IA:\nCopie o ID exato abaixo e coloque na sua tag de monitorização.\nID: ${taskId}\nFerramenta: check_api_task\nFormato esperado na sua resposta: [MONITOR_TASK: check_api_task | ${taskId}]` 
            }] 
        };
    }

    // 3. A ferramenta de verificação usa 1 única linha!
    if (request.params.name === "check_api_task") {
        const { taskId } = request.params.arguments as any;
        return taskManager.check(taskId);
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);