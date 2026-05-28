import { ClientConfig, MultiServerMCPClient } from "@langchain/mcp-adapters";
import "dotenv/config";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import { fastModel } from "../utils/models.js";
import path from "path";
import os from "os";
import fs from "fs";
import { IncomingMessage, ClientAdapter } from "./types.js";

// ─── Configuração dos servidores MCP ─────────────────────────────────────────

const serversConfig: ClientConfig = {
    mcpServers: {
        ingestPdf: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/ingest-pdf.ts"],
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                QDRANT_URL: process.env.QDRANT_URL || "",
                QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
            }
        },
        retrieverPdf: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/retriever-pdf.ts"],
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                QDRANT_URL: process.env.QDRANT_URL || "",
                QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
            }
        },
        librarian: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/librarian.ts"],
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                QDRANT_URL: process.env.QDRANT_URL || "",
                QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
            }
        },
        reportGenerator: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/generate-report.ts"],
            env: process.env as any
        },
        emailSender: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/send-email.ts"],
            env: process.env as any
        },
        cnpjSearcher: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/cnpj-search.ts"],
            env: process.env as any
        },
        spreadsheetReader: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/spreadsheet-reader.ts"],
            env: process.env as any
        },
        apiTester: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/api-tester.ts"],
            env: process.env as any
        },
        webSearch: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/web-search.ts"],
            env: {
                ...process.env,
                TAVILY_API_KEY: process.env.TAVILY_API_KEY || "",
            }
        },
        sqliteManager: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/sqlite-manager.ts"],
            env: process.env as any
        },
        stravaAgent: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/strava-agent.ts"],
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                STRAVA_ACCESS_TOKEN: process.env.STRAVA_ACCESS_TOKEN || "",
            }
        },
    },
    useStandardContentBlocks: true
};

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
Você é um assistente executivo virtual prestativo e de alto nível. Responda SEMPRE em português brasileiro.

### 1. FORMATAÇÃO E RESPOSTAS
- Use APENAS a formatação nativa do WhatsApp: coloque palavras entre asteriscos para *negrito* e underlines para _itálico_.
- NUNCA envie tabelas em Markdown no chat.
- O uso de Markdown avançado (com tabelas e formatações complexas) é ESTRITAMENTE OBRIGATÓRIO E EXCLUSIVO para preencher o parâmetro 'markdownContent' da ferramenta 'generate_pdf_report'. No chat com o usuário, mantenha texto simples e limpo.
- Use emojis sempre que enriquecer a mensagem — no início de seções, ao lado de dados importantes ou para dar personalidade à resposta. Seja expressivo e natural, como um assistente humano faria.

### 2. ⚠️ REGRA DE OURO: TAREFAS ASSÍNCRONAS (SQL, APIs Pesadas)
Ferramentas assíncronas NÃO devolvem o resultado final na hora. Elas retornam um texto informando o 'ID da Tarefa' e o 'Nome da ferramenta de verificação'. Quando acionar uma destas ferramentas, siga EXATAMENTE estes passos:
1. Escreva uma resposta natural e curta avisando o usuário que está a processar o pedido (ex: "⏳ Estou analisando os dados, aviso em instantes!").
2. OBRIGATORIAMENTE inclua a tag oculta no FINAL da sua resposta. Use EXATAMENTE o texto que a ferramenta pedir.
3. Substitua a palavra 'ID' pelo código real e único (UUID) que a ferramenta lhe devolveu. NUNCA escreva literalmente a palavra "ID".
4. NUNCA, em hipótese alguma, mencione a palavra "Task ID", mostre o código do ID, ou fale o nome da ferramenta no texto da conversa visível ao usuário. O ID vive apenas dentro da tag.

### 3. DIRETRIZES DE USO DAS FERRAMENTAS

* 📊 **Planilhas e Relatórios:**
    - Se o usuário enviar uma planilha: Use 'ask_spreadsheet_specialist' passando o caminho do arquivo e a pergunta do usuário. O especialista faz a análise completa e retorna os insights prontos.
    - Após receber a análise, ofereça ao usuário gerar um relatório PDF com 'generate_pdf_report_async'.
    - Se o usuário pedir um relatório sem planilha: Use 'generate_pdf_report_async' diretamente.

* ✉️ **Envio de E-mails:**
    - Se o usuário pedir para enviar um documento ou relatório por e-mail:
      1. Se o documento ainda não existir, use PRIMEIRO 'generate_pdf_report' para criá-lo.
      2. Com o caminho do arquivo em mãos, use 'send_email' passando-o no parâmetro 'attachmentPath'.
      3. Avise o usuário amigavelmente após o envio bem-sucedido.

* 🌐 **Pesquisas e Atualidades:**
    - Se o usuário perguntar sobre notícias, cotações, dados atuais, mercado ou eventos recentes: Utilize a ferramenta 'web_search' para buscar informações reais na internet antes de responder.

* 📂 **Gestão de Arquivos (Librarian/Retriever):**
    - Se você não tiver certeza de qual fonte de dados ou documento o usuário está falando, acione primeiro a ferramenta 'list_my_files'. Se ainda houver dúvidas, pergunte ao usuário.
    - Pode ingerir ou buscar embeddings de documentos para responder a perguntas baseadas neles.

* 🔌 **Teste de APIs e Redes:**
    - Se pedirem para agir como Postman, testar endpoint ou fazer requisição: Use as ferramentas de HTTP Request. Forneça os resultados de forma limpa (Status Code e dados). Se o retorno for massivo, destaque apenas as partes principais.
    - ⚠️ **DADOS SENSÍVEIS:** Quando o usuário fornecer um Token (JWT, Bearer), Chave de API, Hash ou URL, você DEVE copiá-lo EXATAMENTE caractere por caractere para dentro das ferramentas. NUNCA altere, resuma ou modifique esses dados.

* 🏃 **Strava e Atividades Físicas:**
    - Se o usuário perguntar sobre treinos, corridas, caminhadas, performance, calorias, ritmo ou histórico esportivo: use a ferramenta 'ask_strava_specialist'.
    - Passe no parâmetro 'question' o pedido do usuário com contexto suficiente. O especialista cuida de tudo sozinho — não tente buscar IDs ou decidir qual endpoint usar.

* 🗄️ **Banco de Dados SQLite:**
    - Use 'ask_sql_specialist' sempre que o usuário pedir dados do banco, relatórios, contagens ou alterações. Passe o pedido em linguagem natural — o especialista cuida do schema, das queries e da interpretação dos resultados.
`;

// ─── AgentCore ────────────────────────────────────────────────────────────────

export class AgentCore {
    private mcpClient!: MultiServerMCPClient;
    private mcpTools: any[] = [];
    private agent: any = null;

    async initialize(): Promise<void> {
        console.log("🚀 A iniciar o núcleo do agente...");

        this.mcpClient = new MultiServerMCPClient(serversConfig);
        this.mcpTools = await this.mcpClient.getTools();

        console.log(`🔧 Ferramentas disponíveis: ${this.mcpTools.length}`);

        const checkpointer = new MemorySaver();

        this.agent = createAgent({
            model: fastModel,
            tools: this.mcpTools,
            checkpointer,
            systemPrompt: SYSTEM_PROMPT
        });

        console.log("✅ Núcleo do agente pronto.");
    }

    async processMessage(msg: IncomingMessage, adapter: ClientAdapter): Promise<void> {
        let messageToAgent: string;

        // Montar prompt de acordo com o tipo de mensagem recebida
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
                { configurable: { thread_id: msg.sessionId } }
            );

            let aiResponse = result.messages[result.messages.length - 1].content;

            if (Array.isArray(aiResponse)) {
                aiResponse = aiResponse.map((block: any) => block.text || '').join('\n');
            }

            await this.handleAgentResponse(aiResponse, msg.chatId, msg.sessionId, adapter);

        } catch (error) {
            console.error("❌ Erro ao processar mensagem:", error);
            await adapter.sendText(msg.chatId, "🤖 Desculpe, os meus sensores estão offline no momento. 🌧️");
        }
    }

    // ─── Parsing e despacho da resposta do agente ─────────────────────────────

    private async handleAgentResponse(
        aiResponse: string,
        chatId: string,
        sessionId: string,
        adapter: ClientAdapter
    ): Promise<void> {

        // Processar tag [SEND_PDF: caminho]
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

        // Processar tag [MONITOR_TASK: ferramenta | taskId]
        const taskTagRegex = /\[MONITOR_TASK:\s*(.+?)\s*\|\s*(.+?)\]/;
        const taskMatch = aiResponse.match(taskTagRegex);

        if (taskMatch) {
            const checkToolName = taskMatch[1].trim();
            const taskId = taskMatch[2].trim();
            aiResponse = aiResponse.replace(taskTagRegex, '').trim();
            this.monitorTaskInBackground(checkToolName, taskId, chatId, sessionId, adapter);
        }

        if (aiResponse.length > 0) {
            await adapter.sendText(chatId, `🤖 ${aiResponse}`);
            console.log(`🤖 Resposta enviada para o chat (${chatId})`);
        }
    }

    // ─── Monitoramento assíncrono de tarefas ──────────────────────────────────

    private monitorTaskInBackground(
        checkToolName: string,
        taskId: string,
        chatId: string,
        sessionId: string,
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
                    return; // Ainda processando — aguarda próximo ciclo
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
                    { configurable: { thread_id: sessionId } }
                );

                let finalMessage = agentResult.messages[agentResult.messages.length - 1].content;

                if (Array.isArray(finalMessage)) {
                    finalMessage = finalMessage.map((block: any) => block.text || '').join('\n');
                }

                await this.handleAgentResponse(finalMessage, chatId, sessionId, adapter);

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
