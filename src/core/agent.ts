import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createAgent } from "langchain";
import { HumanMessage, SystemMessage, trimMessages } from "@langchain/core/messages";
import { fastModel } from "../utils/models.js";

const MAX_MESSAGES = 20;
import path from "path";
import os from "os";
import fs from "fs";
import { IncomingMessage, ClientAdapter, AgentConfig } from "./types.js";

export class AgentCore {
    private mcpClient!: MultiServerMCPClient;
    private mcpTools: any[] = [];
    private agent: any = null;
    private config: AgentConfig;
    private threadPrefix: string;

    /**
     * @param config  Perfil do agente (prompt + servidores MCP + modelo)
     * @param threadPrefix  Prefixo para isolar memórias: "{perfil}:{canal}"
     */
    constructor(config: AgentConfig, threadPrefix: string) {
        this.config = config;
        this.threadPrefix = threadPrefix;
    }

    async initialize(): Promise<void> {
        console.log("🚀 A iniciar o núcleo do agente...");

        this.mcpClient = new MultiServerMCPClient({
            mcpServers: this.config.servers,
            useStandardContentBlocks: true
        });
        this.mcpTools = await this.mcpClient.getTools();
        console.log(`🔧 Ferramentas disponíveis: ${this.mcpTools.length}`);

        if (!process.env.DATABASE_URL) {
            throw new Error("❌ DATABASE_URL não definida no .env (necessária para persistência no Supabase)");
        }

        const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);
        await checkpointer.setup();

        const systemPromptText = typeof this.config.systemPrompt === 'function'
            ? this.config.systemPrompt()
            : this.config.systemPrompt;

        const systemMessage = new SystemMessage(systemPromptText);

        this.agent = createAgent({
            model: this.config.model ?? fastModel,
            tools: this.mcpTools,
            checkpointer,
            messageModifier: (messages: any[]) => {
                const nonSystem = messages.filter((m: any) => !(m instanceof SystemMessage));
                const trimmed = trimMessages(nonSystem, {
                    maxTokens: MAX_MESSAGES,
                    strategy: "last",
                    tokenCounter: (msgs: any[]) => msgs.length,
                    includeSystem: false,
                    startOn: "human",
                });
                return [systemMessage, ...trimmed];
            }
        });

        console.log("✅ Núcleo do agente pronto.");
    }

    async processMessage(msg: IncomingMessage, adapter: ClientAdapter): Promise<void> {
        const threadId = `${this.threadPrefix}:${msg.sessionId}`;
        let messageToAgent: string;

        if (msg.attachment) {
            const { type, buffer, fileName } = msg.attachment;

            const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const filePath = path.join(os.tmpdir(), safeFileName);
            fs.writeFileSync(filePath, buffer);
            console.log(`✅ Ficheiro guardado temporariamente em: ${filePath}`);

            if (type === 'pdf') {
                messageToAgent = `[SISTEMA]: O usuário enviou um arquivo PDF. O arquivo já foi baixado e salvo localmente no caminho: ${filePath}. O número do usuário é ${msg.sessionId}. Por favor, utilize a ferramenta 'ingest_pdf_async' para processar os embeddings deste arquivo. Use exatamente o nome "${fileName}" no parâmetro 'fileName' da ferramenta.`;
            } else {
                messageToAgent = `[SISTEMA]: O usuário enviou uma planilha salva em: ${filePath}.
Siga EXATAMENTE estes passos:
1. Use a ferramenta 'read_spreadsheet_async' para ler os dados brutos.
2. Analise os resultados e monte um relatório em Markdown focado em INSIGHTS (totais, médias, padrões).
3. ⚠️ IMPORTANTE: NÃO tente colocar a planilha inteira no Markdown. Se for criar tabelas, mostre NO MÁXIMO as 5 a 10 linhas mais relevantes (ex: Top 5 itens). Escrever textos muito grandes causará falha no sistema.
4. Chame a ferramenta 'generate_pdf_report' passando o título, um 'fileName' (terminado em .pdf) e o Markdown gerado no parâmetro 'markdownContent'.
O que o usuário disse: "${msg.text || 'Faça uma análise resumida desta planilha e gere o PDF'}"`;
            }
        } else {
            messageToAgent = `[Mensagem de: ${msg.sessionId}] ${msg.text}`;
        }

        if (adapter.setTyping) {
            await adapter.setTyping(msg.chatId);
        }

        try {
            const result = await this.agent.invoke(
                { messages: [new HumanMessage(messageToAgent)] },
                { configurable: { thread_id: threadId } }
            );

            let aiResponse = result.messages[result.messages.length - 1].content;

            if (Array.isArray(aiResponse)) {
                aiResponse = aiResponse.map((block: any) => block.text || '').join('\n');
            }

            await this.handleAgentResponse(aiResponse, msg.chatId, threadId, adapter);

        } catch (error) {
            console.error("❌ Erro ao processar mensagem:", error);
            await adapter.sendText(msg.chatId, "Desculpe, os meus sensores estão offline no momento. 🌧️");
        }
    }

    private async handleAgentResponse(
        aiResponse: string,
        chatId: string,
        threadId: string,
        adapter: ClientAdapter
    ): Promise<void> {
        const pdfTagRegex = /\[SEND_PDF:\s*(.+?)\]/;
        const pdfMatch = aiResponse.match(pdfTagRegex);

        if (pdfMatch) {
            const filePath = pdfMatch[1].trim();
            console.log(`📤 A enviar PDF: ${filePath}`);
            try {
                await adapter.sendFile(chatId, filePath, path.basename(filePath) || 'Relatorio.pdf');
                console.log('✅ PDF enviado com sucesso!');
            } catch (err) {
                console.error('❌ Erro ao enviar o PDF:', err);
            }
            aiResponse = aiResponse.replace(pdfTagRegex, '').trim();
        }

        const taskTagRegex = /\[MONITOR_TASK:\s*(.+?)\s*\|\s*(.+?)\]/;
        const taskMatch = aiResponse.match(taskTagRegex);

        if (taskMatch) {
            const checkToolName = taskMatch[1].trim();
            const taskId = taskMatch[2].trim();
            aiResponse = aiResponse.replace(taskTagRegex, '').trim();
            this.monitorTaskInBackground(checkToolName, taskId, chatId, threadId, adapter);
        }

        if (aiResponse.length > 0) {
            await adapter.sendText(chatId, aiResponse);
            console.log(`Resposta enviada para o chat (${chatId})`);
        }
    }

    private monitorTaskInBackground(
        checkToolName: string,
        taskId: string,
        chatId: string,
        threadId: string,
        adapter: ClientAdapter
    ): void {
        console.log(`👀 Monitorando tarefa: ${taskId} | Ferramenta: ${checkToolName}`);

        const interval = setInterval(async () => {
            try {
                const checkTool = this.mcpTools.find(t => t.name === checkToolName);

                if (!checkTool) {
                    console.error(`❌ Ferramenta '${checkToolName}' não encontrada. Cancelando monitorização.`);
                    clearInterval(interval);
                    return;
                }

                const result = await checkTool.invoke({ taskId });
                const responseText = typeof result === 'string' ? result : JSON.stringify(result);

                if (responseText.includes("ainda está em processamento")) {
                    return;
                }

                clearInterval(interval);
                console.log(`✅ Tarefa ${taskId} concluída. A notificar o agente...`);

                if (adapter.setTyping) {
                    await adapter.setTyping(chatId);
                }

                let notificationPrompt = `[SISTEMA]: A tarefa assíncrona que você submeteu (ID: ${taskId}) foi concluída. Aqui está o resultado bruto:\n\n${responseText}\n\nPor favor, analise esses dados e envie uma mensagem direta ao utilizador informando o resultado final. Regras: NO CHAT, NÃO use tabelas Markdown. Use formatação nativa do WhatsApp (*negrito* e _itálico_). Se for um erro, avise o utilizador de forma amigável.`;

                if (checkToolName === "check_spreadsheet_task" && !responseText.includes("Erro") && !responseText.includes("falhou")) {
                    notificationPrompt += `\n\n⚠️ INSTRUÇÃO OBRIGATÓRIA: Como você acabou de ler uma planilha, você DEVE OBRIGATORIAMENTE fazer duas coisas agora:
1. Escrever o resumo rápido para enviar no chat.
2. Chamar a ferramenta 'generate_pdf_report_async' para gerar o relatório completo. IMPORTANTE: No parâmetro 'markdownContent' desta ferramenta, VOCÊ PODE E DEVE usar tabelas Markdown e formatação rica baseada nos dados lidos.`;
                }

                const agentResult = await this.agent.invoke(
                    { messages: [{ role: "user", content: notificationPrompt }] },
                    { configurable: { thread_id: threadId } }
                );

                let finalMessage = agentResult.messages[agentResult.messages.length - 1].content;

                if (Array.isArray(finalMessage)) {
                    finalMessage = finalMessage.map((block: any) => block.text || '').join('\n');
                }

                await this.handleAgentResponse(finalMessage, chatId, threadId, adapter);

            } catch (error) {
                console.error(`❌ Erro ao monitorizar a tarefa ${taskId}:`, error);
                clearInterval(interval);
            }
        }, 10000);
    }

    async close(): Promise<void> {
        if (this.mcpClient) {
            await this.mcpClient.close();
            console.log("🔌 Conexões MCP encerradas.");
        }
    }
}
