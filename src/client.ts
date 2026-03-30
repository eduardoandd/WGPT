import { ClientConfig, MultiServerMCPClient } from "@langchain/mcp-adapters";
import "dotenv/config";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, HumanMessage } from "langchain";
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


// servidores disponíveis para utilizar
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

    },
    useStandardContentBlocks: true
}

let client: MultiServerMCPClient // cliente
let agent: any = null;
let mcpTools: any[] = []; // Variável global para as ferramentas MCP, facilitando o acesso pelo monitor em background
const AUTH_FOLDER = 'auth_info_baileys';

async function runClient() {
    console.log("A iniciar Cliente MCP");

    // handshake cliente -> servidor
    client = new MultiServerMCPClient(seversConfig)

    mcpTools = await client.getTools() // lista de ferramentas disponíveis no servidor

    console.log(`Quantidade de Ferramentas disponíveis: ${mcpTools.length}`);

    // memoria na ram
    const checkpointer = new MemorySaver();

    agent = createAgent({
        model: expertModel, // modelo padronizado
        tools: mcpTools, // lista de ferramentas para o agente utilizar
        checkpointer: checkpointer, // anti-amnésia
        systemPrompt: `
Você é um assistente executivo virtual prestativo e de alto nível. Responda SEMPRE em português brasileiro.

### 1. FORMATAÇÃO E RESPOSTAS (WHATSAPP)
- Use APENAS a formatação nativa do WhatsApp: coloque palavras entre asteriscos para *negrito* e underlines para _itálico_.
- NUNCA envie tabelas em Markdown no chat.
- O uso de Markdown avançado (com tabelas e formatações complexas) é ESTRITAMENTE OBRIGATÓRIO E EXCLUSIVO para preencher o parâmetro 'markdownContent' da ferramenta 'generate_pdf_report'. No chat com o usuário, mantenha texto simples e limpo.

### 2. ⚠️ REGRA DE OURO: TAREFAS ASSÍNCRONAS (SQL, APIs Pesadas)
Ferramentas assíncronas NÃO devolvem o resultado final na hora. Elas retornam um texto informando o 'ID da Tarefa' e o 'Nome da ferramenta de verificação'. Quando acionar uma destas ferramentas, siga EXATAMENTE estes passos:
1. Escreva uma resposta natural e curta avisando o usuário que está a processar o pedido (ex: "⏳ Estou analisando os dados, aviso em instantes!").
2. OBRIGATORIAMENTE inclua a tag oculta no FINAL da sua resposta no formato exato: [MONITOR_TASK: nome_da_ferramenta_de_check | ID_da_tarefa].
3. O ID deve ser copiado EXATAMENTE como a ferramenta devolveu.
4. NUNCA, em hipótese alguma, mencione a palavra "Task ID", mostre o código do ID, ou fale o nome da ferramenta no texto da conversa visível ao usuário. O ID vive apenas dentro da tag.

### 3. DIRETRIZES DE USO DAS FERRAMENTAS

* 📊 **Planilhas e Relatórios:**
    - Se o usuário enviar uma planilha: Use 'read_spreadsheet_async'. Analise os valores como um especialista (busque totais, médias, padrões). Em seguida, OBRIGATORIAMENTE crie um relatório formatado e chame a ferramenta 'generate_pdf_report_async' para entregar a análise em PDF ao usuário.
    - Se o usuário pedir um relatório: Use 'generate_pdf_report_async' e estruture o 'markdownContent' de forma rica, elegante e agradável para a leitura (com tabelas e destaques).

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

* 🗄️ **Banco de Dados SQLite:**
    - Você tem acesso direto ao BD. As consultas pesadas são feitas assincronamente (veja a Regra de Ouro acima).
    - CUIDADO EXTREMO: Ao fazer alterações (UPDATE, DELETE), tenha certeza absoluta de usar a cláusula 'WHERE' corretamente para não corromper ou apagar a base de dados.
`
    });
}

async function connectToWhatsApp() {

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER); // define dados da sessão.
    const { version, isLatest } = await fetchLatestBaileysVersion(); // consulta os servidores do wpp para atualizar os protocolos

    console.log(`[Baileys] A usar a versão do WhatsApp: ${version.join('.')}, isLatest: ${isLatest}`);

    // instanciando conexão
    const sock = makeWASocket({
        version, // versão do protocolo
        auth: state, // sessão
        printQRInTerminal: false,
        syncFullHistory: false, // desliga sincronização de msg antiga para ficar mais rápido
        browser: Browsers.ubuntu("Chrome")
    })

    // escuta as mudanças de estado da sua conexão
    sock.ev.on("connection.update", (update: any) => {

        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('\n================================================');
            console.log('📱 ESCANEIE O QR CODE ABAIXO PARA CONECTAR O HOST:');
            console.log('================================================\n');
            qrcode.generate(qr, { small: true });
        }

        // avalia o motivo da desconexão
        if (connection === 'close') {

            // se o motivo for logout
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão fechada. A reconectar: ', shouldReconnect);

            // se foi logout tenta reconectar
            if (shouldReconnect) {
                connectToWhatsApp()
            }

        }
        else if (connection === 'open') {
            console.log('✅ SESSÃO DO WHATSAPP ESTABELECIDA! 🚀 A aguardar as mensagens dos clientes...');
        }

    })

    // sempre que os dados da sessão ou criptografia mudar
    sock.ev.on('creds.update', saveCreds)

    // escuta o recebimento de mensagens
    sock.ev.on('messages.upsert', async (m: any) => {

        // ignora eventos vazios
        if (!m.messages || m.messages.length === 0) return

        const msg = m.messages[0] // objeto conversa

        // 1. CHAT ID: É para onde devemos enviar a resposta (Pode ser @lid ou @s.whatsapp.net)
        const chatId = msg.key.remoteJid!;

        // Ignora status (stories)
        if (!msg.message || chatId === 'status@broadcast') return;

        // Ignora mensagens de grupos
        if (chatId?.endsWith('@g.us')) return;

        // Ignora as mensagens enviadas pelo próprio bot (evita que ele converse sozinho num loop)
        if (msg.key.fromMe) return;

        // 2. USER ID: Tenta pegar o número real do cliente (se não achar, usa o chatId mesmo)
        let senderInfo = msg.senderPn || msg.key.participant || msg.participant || chatId;

        if (senderInfo && !senderInfo.includes('@') && senderInfo !== chatId) {
            senderInfo = `${senderInfo}@s.whatsapp.net`;
        }

        console.log(`\n📩 Mensagem recebida no chat: ${chatId} | Pelo utilizador: ${senderInfo}`);

        const documentMsg = msg.message?.documentMessage || msg.message?.documentWithCaptionMessage?.message?.documentMessage;
        const isDocument = !!documentMsg; // Retorna true se encontrou o documento

        const reciveText = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            documentMsg?.caption;


        let messageToAgent = `[Mensagem de: ${senderInfo}] ${reciveText}`;

        if (reciveText && reciveText.startsWith('🤖')) {
            return;
        }

        // lógica de interceptação de PDF
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

                    // captura o nome do documento
                    let originalFileName = documentMsg?.fileName || documentMsg?.title || `documento_sem_nome_${Date.now()}.pdf`;
                    const safeFileName = originalFileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const filePath = path.join(os.tmpdir(), safeFileName);

                    fs.writeFileSync(filePath, buffer as Buffer);
                    console.log(`✅ Ficheiro guardado temporariamente em: ${filePath}`);

                    // Usa o senderInfo para o agente guardar corretamente na base de dados
                    messageToAgent = `[SISTEMA]: O usuário enviou um arquivo PDF. O arquivo já foi baixado e salvo localmente no caminho: ${filePath}. O número do usuário é ${senderInfo}. Por favor, utilize a ferramenta 'ingest_pdf_async' para processar os embeddings deste arquivo. Use exatamente o nome "${originalFileName}" no parâmetro 'fileName' da ferramenta.`;

                } catch (error) {
                    console.error("❌ Erro ao transferir ou guardar o PDF:", error);
                    messageToAgent = `[SISTEMA]: O usuário tentou enviar um arquivo PDF, mas ocorreu um erro no download. Avise-o sobre a falha.`;
                }
            }

            if (
                mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || // .xlsx
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

        if (messageToAgent && agent) {

            console.log(`A processar entrada para a IA: ${isDocument ? '[Ficheiro PDF]' : reciveText}`);

            // Usa o chatId para simular a ação de "a escrever..." na janela de conversa correta
            await sock.sendPresenceUpdate('composing', chatId)

            try {
                // Usa o senderInfo para manter a memória do LangChain (Contexto do Utilizador)
                const result = await agent.invoke(
                    { messages: [new HumanMessage(messageToAgent)] },
                    { configurable: { thread_id: senderInfo } }
                );

                let aiResponse = result.messages[result.messages.length - 1].content;

                if (Array.isArray(aiResponse)) {
                    aiResponse = aiResponse.map((block: any) => block.text || '').join('\n');
                }

                // 1. Procura pela tag [SEND_PDF:...] na resposta da IA
                const pdfTagRegex = /\[SEND_PDF:\s*(.+?)\]/;
                const match = aiResponse.match(pdfTagRegex);

                if (match) {
                    const filePath = match[1].trim(); // Pega o caminho do arquivo gerado
                    console.log(`📤 A preparar para enviar relatório PDF: ${filePath}`);

                    try {
                        // Envia o documento físico pelo WhatsApp
                        await sock.sendMessage(chatId, {
                            document: { url: filePath },
                            mimetype: 'application/pdf',
                            fileName: path.basename(filePath) || 'Relatorio.pdf'
                        });
                        console.log('✅ PDF enviado com sucesso para o WhatsApp!');
                    } catch (err) {
                        console.error('❌ Erro ao enviar o PDF pelo WhatsApp:', err);
                    }

                    // Limpa a tag [SEND_PDF:...] da resposta de texto da IA
                    aiResponse = aiResponse.replace(pdfTagRegex, '').trim();
                }

                // --- NOVA LÓGICA DE MONITORIZAÇÃO DE TASKS ASSÍNCRONAS ---
                const taskTagRegex = /\[MONITOR_TASK:\s*(.+?)\s*\|\s*(.+?)\]/;
                const taskMatch = aiResponse.match(taskTagRegex);

                if (taskMatch) {
                    const checkToolName = taskMatch[1].trim(); // Ex: check_api_task
                    const taskId = taskMatch[2].trim();        // Ex: 1234-5678

                    aiResponse = aiResponse.replace(taskTagRegex, '').trim();

                    // Inicia a monitorização em background passando a ferramenta correta
                    monitorTaskInBackground(checkToolName, taskId, chatId, senderInfo, sock);
                }

                // 2. Só envia a mensagem de texto se sobrar algum texto após remover as tags
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

// ---------------------------------------------------------
// FUNÇÃO PARA MONITORIZAR TASKS SQL EM BACKGROUND
// ---------------------------------------------------------
// ---------------------------------------------------------
// FUNÇÃO PARA MONITORIZAR TASKS ASSÍNCRONAS EM BACKGROUND
// ---------------------------------------------------------
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
                return; // Aguarda o próximo ciclo
            }

            clearInterval(interval); // Terminou!

            console.log(`✅ Tarefa ${taskId} finalizada. A acordar a IA...`);
            await sock.sendPresenceUpdate('composing', chatId);

            let notificationPrompt = `[SISTEMA]: A tarefa assíncrona que você submeteu (ID: ${taskId}) foi concluída. Aqui está o resultado bruto:\n\n${responseText}\n\nPor favor, analise esses dados e envie uma mensagem direta ao utilizador informando o resultado final. Regras: NO CHAT, NÃO use tabelas Markdown. Use formatação nativa do WhatsApp (*negrito* e _itálico_). Se for um erro, avise o utilizador de forma amigável.`;

            // Força a IA a gerar o PDF logo após ler a planilha, tirando o medo dela de usar Markdown
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

            // 1. Intercepta o envio de PDF gerado no background
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

            // 2. Intercepta uma nova Task Assíncrona (Ex: A IA iniciou a geração do PDF)
            const taskTagRegex = /\[MONITOR_TASK:\s*(.+?)\s*\|\s*(.+?)\]/;
            const taskMatch = finalMessage.match(taskTagRegex);

            if (taskMatch) {
                const newCheckToolName = taskMatch[1].trim(); 
                const newTaskId = taskMatch[2].trim();        

                finalMessage = finalMessage.replace(taskTagRegex, '').trim();

                // Começa a monitorar o PDF!
                monitorTaskInBackground(newCheckToolName, newTaskId, chatId, senderInfo, sock);
            }

            // Envia o texto do resumo para o usuário no chat
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