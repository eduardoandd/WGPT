import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { getValidAccessToken } from "../utils/strava-auth.js";
import { fastModel } from "../utils/models.js";
import "dotenv/config";

const server = new Server({ name: "strava-agent", version: "2.0.0" }, { capabilities: { tools: {} } });

const STRAVA_BASE = "https://www.strava.com/api/v3";

async function stravaFetch(path: string): Promise<any> {
    const token = await getValidAccessToken();

    const response = await fetch(`${STRAVA_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
        if (response.status === 401) throw new Error("Token Strava inválido ou expirado.");
        throw new Error(`Erro na API Strava (${response.status}): ${response.statusText}`);
    }

    return response.json();
}

// Ferramentas internas do especialista
const fetchActivities = tool(
    async ({ page, per_page }) => {
        console.error(`🏃 [Strava Specialist] Buscando lista de atividades (pág ${page})...`);
        const data = await stravaFetch(`/athlete/activities?page=${page}&per_page=${per_page}`);
        return JSON.stringify(data);
    },
    {
        name: "fetch_activities",
        description: "Busca a lista de atividades recentes do atleta no Strava. Use quando precisar saber quais atividades existem, comparar várias ou encontrar o ID de uma atividade específica.",
        schema: z.object({
            page: z.number().optional().default(1).describe("Página de resultados"),
            per_page: z.number().optional().default(10).describe("Quantidade de atividades (máx 30)")
        })
    }
);

const fetchActivityDetail = tool(
    async ({ activityId }) => {
        console.error(`🏃 [Strava Specialist] Buscando detalhes da atividade ${activityId}...`);
        const data = await stravaFetch(`/activities/${activityId}`);
        return JSON.stringify(data);
    },
    {
        name: "fetch_activity_detail",
        description: "Busca os detalhes completos de uma atividade específica (calorias, splits, laps, mapa, ritmo por km). Requer o ID numérico da atividade — use fetch_activities antes se não tiver o ID.",
        schema: z.object({
            activityId: z.string().describe("ID numérico da atividade no Strava")
        })
    }
);

const stravaTools = [fetchActivities, fetchActivityDetail];

const SYSTEM_PROMPT = `Você é um especialista em análise de performance esportiva e dados do Strava.
Você tem acesso a ferramentas para buscar dados reais do atleta. Use-as conforme necessário para responder à pergunta.

Diretrizes de análise:
- Use fetch_activities para listar atividades ou encontrar IDs
- Use fetch_activity_detail quando precisar de calorias, splits, laps ou detalhes completos
- Se o usuário pedir "mais detalhes" de algo, busque o ID na lista primeiro e depois os detalhes
- Responda sempre em português brasileiro, de forma clara e com insights úteis
- Use unidades legíveis: km, min/km para ritmo, km/h para velocidade
- Não repita dados brutos — interprete e explique o que significam

EMOJIS: Use emojis livremente para tornar a resposta mais expressiva e agradável. Exemplos: 🏃 para corrida, 🚶 para caminhada, 🔥 para calorias, ⏱️ para tempo, 📍 para distância, 💪 para performance, 📈 para evolução. Seja natural, não exagere.

FORMATAÇÃO OBRIGATÓRIA (WhatsApp):
- Use *texto* para negrito (asteriscos simples)
- Use _texto_ para itálico (underline simples)
- NUNCA use ## ou ### para títulos — use *TÍTULO* em negrito no lugar
- NUNCA crie tabelas Markdown
- NUNCA use ** (duplo asterisco) nem __ (duplo underline)
- Separe seções com uma linha em branco
- Use listas com hífen simples: - item
- Exemplo correto de resposta:

*🏃 Caminhada ao ar livre — 4 mai 2026*

- *Distância:* 310 metros
- *Tempo:* 4 min 28 seg
- *Calorias:* 32 kcal

*Análise*
A caminhada foi leve e tranquila. A cadência de 60 passos/min indica um ritmo relaxado.`;

// Agente especialista usando createReactAgent (padrão LangGraph 2026)
const specialistAgent = createReactAgent({
    llm: fastModel,
    tools: stravaTools,
    stateModifier: SYSTEM_PROMPT
});

async function runSpecialist(question: string): Promise<string> {
    const result = await specialistAgent.invoke({
        messages: [new HumanMessage(question)]
    });

    const lastMessage = result.messages[result.messages.length - 1];

    return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
}

// MCP: única ferramenta exposta ao orquestrador
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ask_strava_specialist",
                description: "Aciona o agente especialista em Strava. Ele busca os dados necessários autonomamente e retorna uma análise completa. Use sempre que o usuário perguntar sobre treinos, exercícios, corridas, caminhadas, calorias, performance ou histórico esportivo.",
                inputSchema: {
                    type: "object",
                    properties: {
                        question: {
                            type: "string",
                            description: "O pedido do usuário com contexto suficiente para o especialista entender o que analisar (ex: 'Quais exercícios o atleta fez? Me dê um resumo de cada um.' ou 'Quero os detalhes completos da última atividade registrada: calorias, ritmo e cadência.')."
                        }
                    },
                    required: ["question"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "ask_strava_specialist") {
        const { question } = request.params.arguments as { question: string };

        try {
            console.error(`\n🧠 [Strava Specialist] Iniciando análise para: "${question}"`);
            const answer = await runSpecialist(question);
            console.error(`✅ [Strava Specialist] Análise concluída.`);

            return { content: [{ type: "text", text: answer }] };

        } catch (error: any) {
            console.error(`❌ [Strava Specialist] Erro:`, error.message);
            return { content: [{ type: "text", text: `Erro ao consultar o Strava: ${error.message}` }], isError: true };
        }
    }

    return { content: [{ type: "text", text: `Ferramenta desconhecida` }], isError: true };
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Servidor MCP 'strava-agent v2' conectado e rodando via stdio!");
}

runServer().catch(console.error);
