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
import { transcribeAudio } from '../utils/transcription.js';
import { ClientAdapter, IncomingMessage } from '../core/types.js';

const AUTH_FOLDER = 'auth_info_baileys';

const SPREADSHEET_MIMETYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
]);

export class WhatsAppAdapter implements ClientAdapter {
    private sock: any = null;

    async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
        await this.connect(onMessage);
    }

    private async connect(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
        const { version, isLatest } = await fetchLatestBaileysVersion();

        console.log(`[Baileys] Versão do WhatsApp: ${version.join('.')}, isLatest: ${isLatest}`);

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            syncFullHistory: false,
            browser: Browsers.ubuntu("Chrome")
        });

        this.sock.ev.on("connection.update", (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n================================================');
                console.log('📱 ESCANEIE O QR CODE ABAIXO PARA CONECTAR:');
                console.log('================================================\n');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Conexão fechada. A reconectar:', shouldReconnect);
                if (shouldReconnect) this.connect(onMessage);
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado! A aguardar mensagens...');
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('messages.upsert', async (m: any) => {
            if (!m.messages?.length) return;

            const msg = m.messages[0];
            const chatId: string = msg.key.remoteJid!;

            if (!msg.message || chatId === 'status@broadcast') return;
            if (chatId?.endsWith('@g.us')) return;
            if (msg.key.fromMe) return;

            let sessionId: string = msg.senderPn || msg.key.participant || msg.participant || chatId;
            if (sessionId && !sessionId.includes('@') && sessionId !== chatId) {
                sessionId = `${sessionId}@s.whatsapp.net`;
            }

            console.log(`\n📩 Mensagem | chat: ${chatId} | sessão: ${sessionId}`);

            const documentMsg = msg.message?.documentMessage
                || msg.message?.documentWithCaptionMessage?.message?.documentMessage;

            const text: string | undefined = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || documentMsg?.caption;


            const incomingMsg: IncomingMessage = { sessionId, chatId, text };

            if (documentMsg) {
                const mimeType = documentMsg.mimetype ?? '';
                const fileName = documentMsg.fileName || documentMsg.title || `file_${Date.now()}`;

                const isPdf = mimeType === 'application/pdf';
                const isSpreadsheet = SPREADSHEET_MIMETYPES.has(mimeType);

                if (isPdf || isSpreadsheet) {
                    console.log(`📎 ${isPdf ? 'PDF' : 'Planilha'} recebido: ${fileName}`);

                    try {
                        const buffer = await downloadMediaMessage(
                            msg, 'buffer', {},
                            { logger: console as any, reuploadRequest: this.sock.updateMediaMessage }
                        ) as Buffer;

                        incomingMsg.attachment = {
                            type: isPdf ? 'pdf' : 'spreadsheet',
                            buffer,
                            fileName,
                            mimeType
                        };
                    } catch (error) {
                        console.error('❌ Erro ao baixar ficheiro:', error);
                        await this.sendText(chatId, "Ocorreu um erro ao receber o teu ficheiro. Tenta novamente.");
                        return;
                    }
                }
            }

            // ── Áudio (ptt / audioMessage) ────────────────────────────────────
            const audioMsg = msg.message?.audioMessage;
            if (audioMsg && !documentMsg) {
                console.log("🎙️ Áudio detetado! A transcrever...");
                try {
                    const audioBuffer = await downloadMediaMessage(
                        msg, 'buffer', {},
                        { logger: console as any, reuploadRequest: this.sock.updateMediaMessage }
                    ) as Buffer;

                    const tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
                    fs.writeFileSync(tempPath, audioBuffer);

                    try {
                        const transcription = await transcribeAudio(tempPath);
                        console.log(`🎙️ Transcrição: "${transcription}"`);
                        incomingMsg.text = `[SISTEMA]: O usuário enviou um áudio que foi transcrito automaticamente. Responda ao conteúdo da transcrição de forma natural, sem mencionar que não consegue ouvir áudios. Número do usuário: ${sessionId}. Transcrição: "${transcription}"`;
                    } finally {
                        fs.unlinkSync(tempPath);
                    }
                } catch (error) {
                    console.error("❌ Erro ao transcrever áudio:", error);
                    await this.sendText(chatId, "Ocorreu um erro ao transcrever o teu áudio. Tenta novamente.");
                    return;
                }
            }

            await onMessage(incomingMsg);
        });
    }

    async sendText(chatId: string, text: string): Promise<void> {
        await this.sock.sendMessage(chatId, { text });
    }

    async sendFile(chatId: string, filePath: string, fileName: string): Promise<void> {
        await this.sock.sendMessage(chatId, {
            document: { url: filePath },
            mimetype: 'application/pdf',
            fileName
        });
    }

    async setTyping(chatId: string): Promise<void> {
        await this.sock.sendPresenceUpdate('composing', chatId);
    }
}
