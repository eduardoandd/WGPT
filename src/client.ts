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
        model: fastModel, // modelo padronizado
        tools: mcpTools, // lista de ferramentas para o agente utilizar
        checkpointer: checkpointer, // anti-amnésia
        systemPrompt: `

        Você é um agente pessoal prestativo, responda sempre em português brasileiro.
            Pode responder dúvidas do usuário buscando informações no banco de dados,
            ingerir ou buscar embeddings de diferentes tipos de arquivos, e consultar o catálogo de arquivos salvos.
            Perante o contexto da conversa, escolha qual ferramenta utilizar.
            Se você não tiver certeza de qual fonte de dados o usuário está falando, primeiro use a 
            ferramenta list_my_files, se ainda sim não tiver certeza, pergunte.
            Use APENAS a formatação nativa do WhatsApp: coloque palavras entre asteriscos para *negrito* e underlines para _itálico_.
            
            Nota: A única exceção é quando você for enviar texto para a ferramenta 'generate_pdf_report'. Dentro do parâmetro 'markdownContent' dessa ferramenta, 
            você DEVE usar Markdown completo com tabelas. Mas no texto final que vai para o WhatsApp, use apenas texto simples.

            Se o usuário pedir um relatório, use a ferramenta 'generate_pdf_report'. Formate o 'markdownContent' usando Markdown, 
            incluindo tabelas e destaques sempre que achar necessário para deixar a leitura agradável.
          

            Se o utilizador pedir para enviar um documento ou relatório por e-mail:
            1. Se o documento ainda não existir, use PRIMEIRO a ferramenta 'generate_pdf_report' para criá-lo.
            2. Com o caminho do ficheiro em mãos (seja do ficheiro acabado de gerar ou de um PDF enviado pelo utilizador), use a ferramenta 'send_email' passando o caminho no 'attachmentPath'.
            3. Após o envio bem-sucedido do e-mail, avise o utilizador de forma amigável que o e-mail foi enviado.

            Se o utilizador enviar uma planilha, use a ferramenta 'read_spreadsheet' para ler os dados. Analise os 
            valores como um especialista: encontre totais, médias, padrões ou maiores gastos. 
            Em seguida, OBRIGATORIAMENTE gere um relatório formatado e chame a ferramenta 'generate_pdf_report' para transformar essa análise num PDF e entregá-lo ao utilizador.

            Se o usuário pedir para fazer uma requisição, testar um endpoint, bater numa API ou agir como um Postman, use a ferramenta 
            'make_http_request'. Forneça os resultados de forma limpa, 
            informando o Status Code e os dados retornados. Se o retorno for grande, destaque apenas as partes principais.
            uando o utilizador fornecer um Token (como JWT, Bearer), Chave de API, Hash, URL ou qualquer código longo, você DEVE copiá-lo EXATAMENTE caractere por caractere para dentro das ferramentas. 
            NÃO altere, não resuma, não adicione nem remova NENHUMA letra, número ou pontuação. A mínima alteração nesses códigos invalidará a requisição e causará erros graves no sistema.

           Você tem acesso direto ao banco de dados SQLite do sistema. Como o banco é muito grande, 
           as consultas pesadas são feitas de forma assíncrona (em duas etapas):
           1. PRIMEIRO, use a ferramenta 'submit_sql_task' com a sua query SQL. Ela devolverá um Task ID.
           2. Responda ao utilizador de forma natural, dizendo APENAS que está a processar a requisição e que o avisará quando terminar (ex: "⏳ Estou a analisar os dados, aviso já quando terminar!").
           3. OBRIGATORIAMENTE inclua a tag [MONITOR_TASK: o_id_da_tarefa_aqui] no FINAL da sua resposta.
           4. ⚠️ REGRA DE OURO: NUNCA, em hipótese alguma, mencione a palavra "Task ID", "ID da tarefa" ou mostre o código do ID no texto da conversa com o utilizador. O ID deve ficar EXCLUSIVAMENTE dentro da tag [MONITOR_TASK: ...], que é invisível para ele.
           
           Você pode fazer consultas (SELECT) ou alterações (INSERT, UPDATE, DELETE).
           Atenção: Se o utilizador pedir para atualizar ou deletar algo, tenha absoluta certeza 
           de usar a cláusula 'WHERE' corretamente para não apagar o banco inteiro!

           Se o usuário perguntar sobre notícias, cotações, dados atuais ou eventos recentes, utilize a ferramenta 'web_search' para buscar as informações em tempo real na internet antes de responder.

       

           
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
                    messageToAgent = `[SISTEMA]: O usuário enviou um arquivo PDF. O arquivo já foi baixado e salvo localmente no caminho: ${filePath}. O número do usuário é ${senderInfo}. Por favor, utilize a ferramenta 'ingest-pdf' para processar os embeddings deste arquivo. Use exatamente o nome "${originalFileName}" no parâmetro 'fileName' da ferramenta. Depois execute a ferramenta retriever-pdf para dar um breve resumo sobre esse arquivo.`;

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
1. Use a ferramenta 'read_spreadsheet' para ler os dados brutos.
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
                const taskTagRegex = /\[MONITOR_TASK:\s*(.+?)\]/;
                const taskMatch = aiResponse.match(taskTagRegex);

                if (taskMatch) {
                    const taskId = taskMatch[1].trim();
                    
                    // Limpa a tag secreta para que o utilizador não a veja no WhatsApp
                    aiResponse = aiResponse.replace(taskTagRegex, '').trim();

                    // Inicia a monitorização em background sem bloquear o fluxo atual
                    monitorTaskInBackground(taskId, chatId, senderInfo, sock);
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
function monitorTaskInBackground(taskId: string, chatId: string, senderInfo: string, sock: any) {
    console.log(`👀 A iniciar monitorização da tarefa em background: ${taskId}`);
    
    // Inicia um loop que verifica o status a cada 10 segundos
    const interval = setInterval(async () => {
        try {
            // Procura a ferramenta 'check_sql_task' diretamente na lista de ferramentas instanciadas
            const checkTool = mcpTools.find(t => t.name === "check_sql_task");
            
            if (!checkTool) {
                console.error("❌ Ferramenta check_sql_task não encontrada! Cancelando monitorização.");
                clearInterval(interval);
                return;
            }

            // Invoca a ferramenta programaticamente passando o ID da tarefa
            const result = await checkTool.invoke({ taskId: taskId });
            
            // Converte o resultado para texto
            const responseText = typeof result === 'string' ? result : JSON.stringify(result);

            // Se o MCP disser que ainda está em "pending", paramos por aqui e esperamos o próximo ciclo de 10s
            if (responseText.includes("ainda está em processamento")) {
                return;
            }

            // Se não está em processamento, a tarefa concluiu (ou deu erro)!
            clearInterval(interval); // Pára o loop para não enviar mensagens repetidas

            console.log(`✅ Tarefa ${taskId} finalizada. A acordar a IA para notificar o utilizador...`);
            
            // Simula a ação de "A escrever..." no WhatsApp
            await sock.sendPresenceUpdate('composing', chatId);

           
            const notificationPrompt = `[SISTEMA]: A tarefa SQL que você submeteu de forma assíncrona (ID: ${taskId}) acaba de ser concluída nos bastidores. Aqui está o resultado bruto retornado pelo banco de dados:\n\n${responseText}\n\nPor favor, analise esses dados e envie uma mensagem diretamente para o utilizador informando que o processamento terminou. 
            
⚠️ REGRAS OBRIGATÓRIAS DE FORMATAÇÃO: 
1. NÃO use tabelas em Markdown (como | Coluna | Valor |). O WhatsApp não suporta isso e fica ilegível!
2. Apresente os resultados APENAS em formato de texto simples, usando listas com marcadores (hifens ou emojis).
3. Use APENAS a formatação nativa do WhatsApp (*negrito* e _itálico_).`;

            // Injeta o resultado no mesmo contexto (thread) da conversa
            const agentResult = await agent.invoke(
                { messages: [{ role: "user", content: notificationPrompt }] },
                { configurable: { thread_id: senderInfo } }
            );

            // Extrai a resposta final gerada pela IA
            const finalMessage = agentResult.messages[agentResult.messages.length - 1].content;

            // Dispara a mensagem final para o WhatsApp
            await sock.sendMessage(chatId, { text: `🤖 ${finalMessage}` });

        } catch (error) {
            console.error(`❌ Erro ao monitorizar a tarefa ${taskId}:`, error);
            clearInterval(interval);
        }
    }, 10000); // 10000 ms = 10 segundos
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