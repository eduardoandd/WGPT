import readline from 'readline';
import path from 'path';
import { ClientAdapter, IncomingMessage } from '../core/types.js';

export class CLIAdapter implements ClientAdapter {

    async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        console.log('\n🖥️  Modo CLI ativo. Digite sua mensagem e pressione Enter.\n');

        const ask = () => {
            rl.question('Você: ', async (text) => {
                if (!text.trim()) {
                    ask();
                    return;
                }

                const msg: IncomingMessage = {
                    sessionId: 'cli-user',
                    chatId: 'cli',
                    text: text.trim()
                };

                await onMessage(msg);
                ask();
            });
        };

        ask();
    }

    async sendText(_chatId: string, text: string): Promise<void> {
        const clean = text.replace(/^🤖\s*/, '');
        console.log(`\nAgente: ${clean}\n`);
    }

    async sendFile(_chatId: string, filePath: string, fileName: string): Promise<void> {
        console.log(`\n📄 [Arquivo gerado] ${fileName}`);
        console.log(`   Caminho: ${path.resolve(filePath)}\n`);
    }

    async setTyping(_chatId: string): Promise<void> {
        process.stdout.write('⏳ Pensando...\r');
    }
}
