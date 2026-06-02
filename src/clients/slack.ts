import { App } from '@slack/bolt';
import fs from 'fs';
import { ClientAdapter, IncomingMessage } from '../core/types.js';

const SPREADSHEET_MIMETYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
]);

export class SlackAdapter implements ClientAdapter {
    private app: App;

    constructor() {
        const botToken = process.env.SLACK_BOT_TOKEN;
        const appToken = process.env.SLACK_APP_TOKEN;
        if (!botToken) throw new Error('❌ SLACK_BOT_TOKEN não definido no .env');
        if (!appToken) throw new Error('❌ SLACK_APP_TOKEN não definido no .env (Socket Mode)');

        this.app = new App({
            token: botToken,
            appToken,
            socketMode: true,
        });
    }

    async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
        // DMs e mensagens em canais onde o bot foi adicionado
        this.app.message(async ({ message, client }) => {
            // Ignora mensagens do próprio bot e subtypes (join, leave, etc.)
            if ((message as any).subtype || (message as any).bot_id) return;

            const msg = message as any;
            const chatId = msg.channel as string;
            const userId = msg.user as string;
            const sessionId = `slack-${userId}`;
            const text: string | undefined = msg.text ?? undefined;

            console.log(`\n💬 Slack | canal: ${chatId} | sessão: ${sessionId}`);

            const incomingMsg: IncomingMessage = { sessionId, chatId, text };

            // Verifica se há arquivo anexado
            if (msg.files && msg.files.length > 0) {
                const file = msg.files[0];
                const mimeType: string = file.mimetype ?? '';
                const fileName: string = file.name || `file_${Date.now()}`;

                const isPdf = mimeType === 'application/pdf';
                const isSpreadsheet = SPREADSHEET_MIMETYPES.has(mimeType);

                if (isPdf || isSpreadsheet) {
                    console.log(`📎 ${isPdf ? 'PDF' : 'Planilha'} recebido: ${fileName}`);
                    try {
                        const downloadUrl = file.url_private_download || file.url_private;
                        const response = await fetch(downloadUrl, {
                            headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
                        });
                        const buffer = Buffer.from(await response.arrayBuffer());

                        incomingMsg.attachment = {
                            type: isPdf ? 'pdf' : 'spreadsheet',
                            buffer,
                            fileName,
                            mimeType
                        };
                    } catch (error) {
                        console.error('❌ Erro ao baixar arquivo do Slack:', error);
                        await this.sendText(chatId, "There was an error receiving your file. Please try again.");
                        return;
                    }
                }
            }

            await onMessage(incomingMsg);
        });

        await this.app.start();
        console.log('✅ Slack bot conectado via Socket Mode! Aguardando mensagens...');
    }

    async sendText(chatId: string, text: string): Promise<void> {
        const MAX = 3000; // limite seguro para Slack
        if (text.length <= MAX) {
            await this.app.client.chat.postMessage({ channel: chatId, text });
            return;
        }
        for (let i = 0; i < text.length; i += MAX) {
            await this.app.client.chat.postMessage({ channel: chatId, text: text.slice(i, i + MAX) });
        }
    }

    async sendFile(chatId: string, filePath: string, fileName: string): Promise<void> {
        await this.app.client.files.uploadV2({
            channel_id: chatId,
            file: fs.createReadStream(filePath),
            filename: fileName,
        });
    }

    async setTyping(_chatId: string): Promise<void> {
        // Slack não tem API pública de "typing" para bots via Socket Mode
    }
}
