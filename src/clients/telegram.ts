import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import fs from 'fs';
import { ClientAdapter, IncomingMessage } from '../core/types.js';

const SPREADSHEET_MIMETYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
]);

export class TelegramAdapter implements ClientAdapter {
    private bot: Telegraf;

    constructor() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) throw new Error('❌ TELEGRAM_BOT_TOKEN não definido no .env');
        this.bot = new Telegraf(token);
    }

    async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {

        this.bot.on(message('text'), async (ctx) => {
            if (ctx.chat.type !== 'private') return;

            const chatId = ctx.chat.id.toString();
            const sessionId = `tg-${ctx.from.id}`;
            const text = ctx.message.text;

            if (text?.startsWith('🤖')) return;

            console.log(`\n📩 Telegram | chat: ${chatId} | sessão: ${sessionId}`);

            await onMessage({ sessionId, chatId, text });
        });

        this.bot.on(message('document'), async (ctx) => {
            if (ctx.chat.type !== 'private') return;

            const chatId = ctx.chat.id.toString();
            const sessionId = `tg-${ctx.from.id}`;
            const doc = ctx.message.document;
            const text = ctx.message.caption ?? undefined;
            const mimeType = doc.mime_type ?? '';
            const fileName = doc.file_name || `file_${Date.now()}`;

            const isPdf = mimeType === 'application/pdf';
            const isSpreadsheet = SPREADSHEET_MIMETYPES.has(mimeType);

            console.log(`\n📩 Telegram | chat: ${chatId} | arquivo: ${fileName}`);

            const incomingMsg: IncomingMessage = { sessionId, chatId, text };

            if (isPdf || isSpreadsheet) {
                console.log(`📎 ${isPdf ? 'PDF' : 'Planilha'} recebido: ${fileName}`);

                try {
                    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                    const response = await fetch(fileLink.href);
                    const buffer = Buffer.from(await response.arrayBuffer());

                    incomingMsg.attachment = {
                        type: isPdf ? 'pdf' : 'spreadsheet',
                        buffer,
                        fileName,
                        mimeType
                    };
                } catch (error) {
                    console.error('❌ Erro ao baixar ficheiro do Telegram:', error);
                    await this.sendText(chatId, "🤖 Ocorreu um erro ao receber o teu ficheiro. Tenta novamente.");
                    return;
                }
            }

            await onMessage(incomingMsg);
        });

        this.bot.launch();
        console.log('✅ Telegram bot conectado! A aguardar mensagens...');

        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }

    async sendText(chatId: string, text: string): Promise<void> {
        const MAX = 4096;
        if (text.length <= MAX) {
            await this.bot.telegram.sendMessage(chatId, text);
            return;
        }
        for (let i = 0; i < text.length; i += MAX) {
            await this.bot.telegram.sendMessage(chatId, text.slice(i, i + MAX));
        }
    }

    async sendFile(chatId: string, filePath: string, fileName: string): Promise<void> {
        await this.bot.telegram.sendDocument(chatId, {
            source: fs.createReadStream(filePath),
            filename: fileName
        });
    }

    async setTyping(chatId: string): Promise<void> {
        await this.bot.telegram.sendChatAction(chatId, 'typing');
    }
}
