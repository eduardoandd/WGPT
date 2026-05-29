import { ClientConfig, MultiServerMCPClient } from "@langchain/mcp-adapters";
import "dotenv/config";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import { expertModel, fastModel } from "./utils/models.js";
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage
} from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getDb } from "./utils/database.js";
import { transcribeAudio } from "./utils/transcription.js";



const seversConfig: ClientConfig = {
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
        taskManager: {
            transport: "stdio",
            command: "npx",
            args: ["tsx", "./src/servers/task-manager.ts"],
            env: {
                ...process.env,
                FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
            }
        },

    },
    useStandardContentBlocks: true
}

let client: MultiServerMCPClient 
let agent: any = null;
let mcpTools: any[] = []; 
const AUTH_FOLDER = 'auth_info_baileys';

async function runClient() {
    console.log("A iniciar Cliente MCP");

    
    client = new MultiServerMCPClient(seversConfig)

    mcpTools = await client.getTools() 

    console.log(`Quantidade de Ferramentas disponíveis: ${mcpTools.length}`);

    
    const checkpointer = new MemorySaver();

    agent = createAgent({
        model: fastModel, 
        tools: mcpTools, 
        checkpointer: checkpointer, 
        systemPrompt: `
Você é um assistente executivo virtual prestativo e de alto nível. Responda SEMPRE em português brasileiro.

### 1. FORMATAÇÃO E RESPOSTAS (WHATSAPP)
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

* ✅ **Gerenciamento de Tarefas (Task Manager):**
    - Para CRIAR uma tarefa (ex: "me lembra de ir ao médico amanhã às 9h", "cria uma tarefa para sexta"): use 'create_task' com description, dateISO (YYYY-MM-DD) e timeISO (HH:MM) se houver horário. ⚠️ SÍNCRONA — confirme ao usuário imediatamente após criar.
    - Para LISTAR tarefas (ex: "quais tarefas tenho amanhã?", "o que tenho pra hoje?"): use 'list_tasks_by_date' com dateISO. ⚠️ SÍNCRONA — retorna o resultado imediatamente. NÃO use o padrão de tarefa assíncrona.
    - Para CONCLUIR uma tarefa: use 'complete_task' com o taskId (obtido via list_tasks_by_date). SÍNCRONA.
    - Para DELETAR uma tarefa: use 'delete_task' com o taskId. SÍNCRONA.
    - Resolva expressões de data relativas (hoje, amanhã, sexta, semana que vem) para o formato ISO antes de chamar as ferramentas. A data de hoje é ${new Date().toISOString().split('T')[0]}.
    - Resolva expressões de data relativas (hoje, amanhã, sexta, semana que vem) para o formato ISO antes de chamar as ferramentas. A data de hoje é ${new Date().toISOString().split('T')[0]}.
`
    });
}

async function connectToWhatsApp() {

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER); 
    const { version, isLatest } = await fetchLatestBaileysVersion(); 

    console.log(`[Baileys] A usar a versão do WhatsApp: ${version.join('.')}, isLatest: ${isLatest}`);

    
    const sock = makeWASocket({
        version, 
        auth: state, 
        printQRInTerminal: false,
        syncFullHistory: false, 
        browser: Browsers.ubuntu("Chrome")
    })

    
    sock.ev.on("connection.update", (update: any) => {

        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('\n================================================');
            console.log('📱 ESCANEIE O QR CODE ABAIXO PARA CONECTAR O HOST:');
            console.log('================================================\n');
            qrcode.generate(qr, { small: true });
        }

        
        if (connection === 'close') {

            
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão fechada. A reconectar: ', shouldReconnect);

            
            if (shouldReconnect) {
                connectToWhatsApp()
            }

        }
        else if (connection === 'open') {
            console.log('✅ SESSÃO DO WHATSAPP ESTABELECIDA! 🚀 A aguardar as mensagens dos clientes...');
        }

    })

    
    sock.ev.on('creds.update', saveCreds)

    
    sock.ev.on('messages.upsert', async (m: any) => {

        
        if (!m.messages || m.messages.length === 0) return

        const msg = m.messages[0] 

        
        const chatId = msg.key.remoteJid!;

        
        if (!msg.message || chatId === 'status@broadcast') return;

        
        if (chatId?.endsWith('@g.us')) return;

        
        if (msg.key.fromMe) return;

        
        let senderInfo = msg.senderPn || msg.key.participant || msg.participant || chatId;

        if (senderInfo && !senderInfo.includes('@') && senderInfo !== chatId) {
            senderInfo = `${senderInfo}@s.whatsapp.net`;
        }

        // Número de telefone limpo extraído do chatId (ex: "5511939134918")
        const phoneNumber = chatId.replace('@s.whatsapp.net', '').replace(/@.*/, '');

        console.log(`\n📩 Mensagem recebida no chat: ${chatId} | Pelo utilizador: ${senderInfo} | Telefone: ${phoneNumber}`);

        const documentMsg = msg.message?.documentMessage || msg.message?.documentWithCaptionMessage?.message?.documentMessage;
        const isDocument = !!documentMsg; 

        const reciveText = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            documentMsg?.caption;


        let messageToAgent = `[Mensagem de: ${senderInfo} | Telefone: ${phoneNumber}] ${reciveText}`;

        if (reciveText && reciveText.startsWith('🤖')) {
            return;
        }

        
        if (isDocument) {

            const mimeType = documentMsg?.mimetype;

            if (mimeType === 'application/pdf') {
                console.log("📄 PDF detetado! A iniciar a transferência...");

                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        {
                            logger: console as any,
                            reuploadRequest: sock.updateMediaMessage
                        }
                    )

                    
                    let originalFileName = documentMsg?.fileName || documentMsg?.title || `documento_sem_nome_${Date.now()}.pdf`;
                    const safeFileName = originalFileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const filePath = path.join(os.tmpdir(), safeFileName);

                    fs.writeFileSync(filePath, buffer as Buffer);
                    console.log(`✅ Ficheiro guardado temporariamente em: ${filePath}`);

                    
                    messageToAgent = `[SISTEMA]: O usuário enviou um arquivo PDF. O arquivo já foi baixado e salvo localmente no caminho: ${filePath}. O número do usuário é ${senderInfo}. Por favor, utilize a ferramenta 'ingest_pdf_async' para processar os embeddings deste arquivo. Use exatamente o nome "${originalFileName}" no parâmetro 'fileName' da ferramenta.`;

                } catch (error) {
                    console.error("❌ Erro ao transferir ou guardar o PDF:", error);
                    messageToAgent = `[SISTEMA]: O usuário tentou enviar um arquivo PDF, mas ocorreu um erro no download. Avise-o sobre a falha.`;
                }
            }

            if (
                mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                mimeType === 'application/vnd.ms-excel' ||
                mimeType === 'text/csv'
            ) {
                console.log("📊 Planilha detetada! A iniciar a transferência...");

                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { logger: console as any, reuploadRequest: sock.updateMediaMessage }
                    );

                    let originalFileName = documentMsg?.fileName || documentMsg?.title || `planilha_${Date.now()}.xlsx`;
                    const safeFileName = originalFileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const filePath = path.join(os.tmpdir(), safeFileName);

                    fs.writeFileSync(filePath, buffer as Buffer);
                    console.log(`✅ Planilha guardada temporariamente em: ${filePath}`);

                    messageToAgent = `[SISTEMA]: O usuário enviou uma planilha salva em: ${filePath}. 
Siga EXATAMENTE estes passos:
1. Use a ferramenta 'read_spreadsheet_async' para ler os dados brutos.
2. Analise os resultados e monte um relatório em Markdown focado em INSIGHTS (totais, médias, padrões). 
3. ⚠️ IMPORTANTE: NÃO tente colocar a planilha inteira no Markdown. Se for criar tabelas, mostre NO MÁXIMO as 5 a 10 linhas mais relevantes (ex: Top 5 itens). Escrever textos muito grandes causará falha no sistema.
4. Chame a ferramenta 'generate_pdf_report' passando o título, um 'fileName' (terminado em .pdf) e o Markdown gerado no parâmetro 'markdownContent'.
O que o usuário disse: "${reciveText || 'Faça uma análise resumida desta planilha e gere o PDF'}"`;

                } catch (error) {
                    console.error("❌ Erro ao descarregar planilha:", error);
                    messageToAgent = `[SISTEMA]: Ocorreu um erro ao descarregar a planilha do utilizador.`;
                }
            }
        }

        // Detectar mensagem de áudio (ptt ou audioMessage)
        const audioMsg = msg.message?.audioMessage;
        if (audioMsg && !isDocument) {
            console.log("🎙️ Áudio detetado! A transcrever...");
            try {
                const audioBuffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { logger: console as any, reuploadRequest: sock.updateMediaMessage }
                );
                const tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
                fs.writeFileSync(tempPath, audioBuffer as Buffer);
                try {
                    const transcription = await transcribeAudio(tempPath);
                    console.log(`🎙️ Transcrição: "${transcription}"`);
                    messageToAgent = `[SISTEMA]: O usuário enviou um áudio que foi transcrito automaticamente. Responda ao conteúdo da transcrição de forma natural, sem mencionar que não consegue ouvir áudios. Número do usuário: ${senderInfo} | Telefone: ${phoneNumber}. Transcrição: "${transcription}"`;
                } finally {
                    fs.unlinkSync(tempPath);
                }
            } catch (error) {
                console.error("❌ Erro ao transcrever áudio:", error);
                messageToAgent = `[SISTEMA]: O usuário enviou um áudio, mas ocorreu um erro na transcrição. Avise-o sobre a falha.`;
            }
        }

        if (messageToAgent && agent) {

            console.log(`A processar entrada para a IA: ${isDocument ? '[Ficheiro PDF]' : audioMsg ? `[Áudio] ${reciveText ?? '(transcrito)'}` : reciveText}`);

            
            await sock.sendPresenceUpdate('composing', chatId)

            try {
                
                const result = await agent.invoke(
                    { messages: [new HumanMessage(messageToAgent)] },
                    { configurable: { thread_id: senderInfo } }
                );

                let aiResponse = result.messages[result.messages.length - 1].content;

                if (Array.isArray(aiResponse)) {
                    aiResponse = aiResponse.map((block: any) => block.text || '').join('\n');
                }

                
                const pdfTagRegex = /\[SEND_PDF:\s*(.+?)\]/;
                const match = aiResponse.match(pdfTagRegex);

                if (match) {
                    const filePath = match[1].trim(); 
                    console.log(`📤 A preparar para enviar relatório PDF: ${filePath}`);

                    try {
                        
                        await sock.sendMessage(chatId, {
                            document: { url: filePath },
                            mimetype: 'application/pdf',
                            fileName: path.basename(filePath) || 'Relatorio.pdf'
                        });
                        console.log('✅ PDF enviado com sucesso para o WhatsApp!');
                    } catch (err) {
                        console.error('❌ Erro ao enviar o PDF pelo WhatsApp:', err);
                    }

                    
                    aiResponse = aiResponse.replace(pdfTagRegex, '').trim();
                }

                
                const taskTagRegex = /\[MONITOR_TASK:\s*(.+?)\s*\|\s*(.+?)\]/;
                const taskMatch = aiResponse.match(taskTagRegex);

                if (taskMatch) {
                    const checkToolName = taskMatch[1].trim(); 
                    const taskId = taskMatch[2].trim();        

                    aiResponse = aiResponse.replace(taskTagRegex, '').trim();

                    
                    monitorTaskInBackground(checkToolName, taskId, chatId, senderInfo, sock);
                }

                
                if (aiResponse.length > 0) {
                    await sock.sendMessage(chatId, { text: `🤖 ${aiResponse}` });
                    console.log(`🤖 Respondi texto para o chat (${chatId})`);
                }

            } catch (error) {
                console.error("Erro ao processar IA ou a ligar às ferramentas MCP:", error);
                await sock.sendMessage(chatId, { text: "🤖 Desculpe, os meus sensores estão offline no momento. 🌧️" });
            }
        }
    })
}







function monitorTaskInBackground(checkToolName: string, taskId: string, chatId: string, senderInfo: string, sock: any) {
    console.log(`👀 A iniciar monitorização da tarefa em background: ${taskId} usando a ferramenta ${checkToolName}`);

    const interval = setInterval(async () => {
        try {
            const checkTool = mcpTools.find(t => t.name === checkToolName);

            if (!checkTool) {
                console.error(`❌ Ferramenta ${checkToolName} não encontrada! Cancelando monitorização.`);
                clearInterval(interval);
                return;
            }

            const result = await checkTool.invoke({ taskId: taskId });
            const responseText = typeof result === 'string' ? result : JSON.stringify(result);

            if (responseText.includes("ainda está em processamento")) {
                return; 
            }

            clearInterval(interval); 

            console.log(`✅ Tarefa ${taskId} finalizada. A acordar a IA...`);
            await sock.sendPresenceUpdate('composing', chatId);

            let notificationPrompt = `[SISTEMA]: A tarefa assíncrona que você submeteu (ID: ${taskId}) foi concluída. Aqui está o resultado bruto:\n\n${responseText}\n\nPor favor, analise esses dados e envie uma mensagem direta ao utilizador informando o resultado final. Regras: NO CHAT, NÃO use tabelas Markdown. Use formatação nativa do WhatsApp (*negrito* e _itálico_). Se for um erro, avise o utilizador de forma amigável.`;

            
            if (checkToolName === "check_spreadsheet_task" && !responseText.includes("Erro") && !responseText.includes("falhou")) {
                notificationPrompt += `\n\n⚠️ INSTRUÇÃO OBRIGATÓRIA: Como você acabou de ler uma planilha, você DEVE OBRIGATORIAMENTE fazer duas coisas agora:
1. Escrever o resumo rápido para enviar no chat.
2. Chamar a ferramenta 'generate_pdf_report_async' para gerar o relatório completo. IMPORTANTE: No parâmetro 'markdownContent' desta ferramenta, VOCÊ PODE E DEVE usar tabelas Markdown e formatação rica baseada nos dados lidos.`;
            }

            const agentResult = await agent.invoke(
                { messages: [{ role: "user", content: notificationPrompt }] },
                { configurable: { thread_id: senderInfo } }
            );

            let finalMessage = agentResult.messages[agentResult.messages.length - 1].content;

            
            if (Array.isArray(finalMessage)) {
                finalMessage = finalMessage.map((block: any) => block.text || '').join('\n');
            }

            
            const pdfTagRegex = /\[SEND_PDF:\s*(.+?)\]/;
            const pdfMatch = finalMessage.match(pdfTagRegex);



            if (pdfMatch) {
                const filePath = pdfMatch[1].trim();
                console.log(`📤 A preparar para enviar relatório PDF (via Background): ${filePath}`);

                try {
                    await sock.sendMessage(chatId, {
                        document: { url: filePath },
                        mimetype: 'application/pdf',
                        fileName: path.basename(filePath) || 'Relatorio.pdf'
                    });
                    console.log('✅ PDF enviado com sucesso para o WhatsApp!');
                } catch (err) {
                    console.error('❌ Erro ao enviar o PDF pelo WhatsApp:', err);
                }

                finalMessage = finalMessage.replace(pdfTagRegex, '').trim();
            }

            
            const taskTagRegex = /\[MONITOR_TASK:\s*(.+?)\s*\|\s*(.+?)\]/;
            const taskMatch = finalMessage.match(taskTagRegex);

            if (taskMatch) {
                const newCheckToolName = taskMatch[1].trim();
                const newTaskId = taskMatch[2].trim();

                finalMessage = finalMessage.replace(taskTagRegex, '').trim();

                
                monitorTaskInBackground(newCheckToolName, newTaskId, chatId, senderInfo, sock);
            }

            
            if (finalMessage.length > 0) {
                await sock.sendMessage(chatId, { text: `🤖 ${finalMessage}` });
            }

        } catch (error) {
            console.error(`❌ Erro ao monitorizar a tarefa ${taskId}:`, error);
            clearInterval(interval);
        }
    }, 10000);
}

async function start() {
    try {
        await getDb();
        await runClient()
        await connectToWhatsApp()
    } catch (error) {
        console.error("Erro crítico ao iniciar:", error);
        if (client) await client.close();
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    console.log("\nEncerrando conexões MCP e WhatsApp...");
    if (client) await client.close();
    process.exit(0);
});

start()