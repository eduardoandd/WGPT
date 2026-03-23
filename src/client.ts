import { ClientConfig, MultiServerMCPClient } from "@langchain/mcp-adapters";
import "dotenv/config";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, HumanMessage } from "langchain";
import { fastModel } from "./utils/models.js";
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
        }
    },
    useStandardContentBlocks: true

}

let client: MultiServerMCPClient // cliente
let agent: any = null;
const AUTH_FOLDER = 'auth_info_baileys';



async function runClient() {

    console.log("Iniciando Cliente MCP");

    // handshake cliente -> servidor
    client = new MultiServerMCPClient(seversConfig)

    const mcpTools = await client.getTools() // lista de ferramentas disponíveis no servidor

    console.log(`Quantidade de Ferramentas disponíveis: ${mcpTools.length}`);

    // memoria na ram
    const checkpointer = new MemorySaver();

    agent = createAgent({
        model: fastModel, // modelo padronizado
        tools: mcpTools, // lista de ferramentas para o agente utilizar
        checkpointer: checkpointer, // anti-amnésia
        systemPrompt: `
            Você é um agente pessoal prestativo.
            Pode responder dúvidas do usuário buscando informações no banco de dados,
            ingerir ou buscar embeddings de diferentes tipos de arquivos, e consultar o catálogo de arquivos salvos.
            Perante o contexto da conversa, escolha qual ferramenta utilizar.
            Se você não tiver certeza de qual fonte de dados o usuário está falando, primeiro use a 
            ferramenta list_my_files, se ainda sim não tiver certeza, pergunte.
        `
    });


}

async function connectToWhatsApp() {

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER); // define dados da sessão.
    const { version, isLatest } = await fetchLatestBaileysVersion(); // consulta os servidores do wpp para atualizar os protocolos

    console.log(`[Baileys] Usando a versão do WhatsApp: ${version.join('.')}, isLatest: ${isLatest}`);

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
            console.log('❌ Conexão fechada. Reconectando: ', shouldReconnect);

            // se foi logout tenta reconectar
            if (shouldReconnect) {
                connectToWhatsApp()
            }

        }
        else if (connection === 'open') {
            console.log('✅ SESSÃO DO WHATSAPP ESTABELECIDA! 🚀 Aguardando as mensagens dos clientes...');

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

        const isDocument = msg.message.documentMessage // verifica se é documento
        const reciveText = msg.message.conversation || msg.message.extendedTextMessage?.text; 

        let messageToAgent = reciveText

        if (reciveText && reciveText.startsWith('🤖')) {
            return;
        }

        // lógica de interceptação de PDF
        if (isDocument) {

            const mimeType = msg.message.documentMessage?.mimetype;

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
                    let originalFileName = msg.message.documentMessage?.fileName || msg.message.documentMessage?.title || `documento_sem_nome_${Date.now()}.pdf`;
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

                const aiResponse = result.messages[result.messages.length - 1].content;

                // Usa o chatId para enviar a mensagem de volta
                await sock.sendMessage(chatId, { text: `🤖 ${aiResponse}` });
                console.log(`🤖 Respondi para o chat (${chatId})`);

            } catch (error) {
                console.error("Erro ao processar IA ou a ligar às ferramentas MCP:", error);
                await sock.sendMessage(chatId, { text: "🤖 Desculpe, os meus sensores estão offline no momento. 🌧️" });
            }

        }

    })

}

async function start() {

    try {
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