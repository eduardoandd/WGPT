import "dotenv/config";
import { AgentCore } from "./core/agent.js";
import { WhatsAppAdapter } from "./clients/whatsapp.js";
import { CLIAdapter } from "./clients/cli.js";
import { TelegramAdapter } from "./clients/telegram.js";
import { ClientAdapter } from "./core/types.js";
import { AGENT_PROFILES } from "./agents/index.js";
import { getDb } from "./utils/database.js";

// AGENT_PROFILE=eduardo  CLIENT_ADAPTER=whatsapp   → npm run dev
// AGENT_PROFILE=eduardo  CLIENT_ADAPTER=cli         → npm run dev:cli
// AGENT_PROFILE=eduardo  CLIENT_ADAPTER=telegram    → npm run dev:telegram

function createAdapter(): ClientAdapter {
    const channel = (process.env.CLIENT_ADAPTER ?? 'whatsapp').toLowerCase();

    switch (channel) {
        case 'cli':
            console.log("🖥️  Adapter: CLI");
            return new CLIAdapter();

        case 'telegram':
            console.log("✈️  Adapter: Telegram");
            return new TelegramAdapter();

        case 'whatsapp':
        default:
            console.log("📱 Adapter: WhatsApp");
            return new WhatsAppAdapter();
    }
}

async function start() {
    try {
        await getDb();

        const profileName = (process.env.AGENT_PROFILE ?? 'eduardo').toLowerCase();
        const channelName = (process.env.CLIENT_ADAPTER ?? 'whatsapp').toLowerCase();

        const agentConfig = AGENT_PROFILES[profileName];
        if (!agentConfig) {
            console.error(`❌ Perfil de agente desconhecido: "${profileName}". Disponíveis: ${Object.keys(AGENT_PROFILES).join(', ')}`);
            process.exit(1);
        }

        console.log(`🤖 Perfil: ${profileName} | 📡 Canal: ${channelName}`);

        const threadPrefix = `${profileName}:${channelName}`;
        const core = new AgentCore(agentConfig, threadPrefix);
        await core.initialize();

        const adapter = createAdapter();

        process.on('SIGINT', async () => {
            console.log("\n🛑 Encerrando...");
            await core.close();
            process.exit(0);
        });

        await adapter.start(async (msg) => {
            await core.processMessage(msg, adapter);
        });

    } catch (error) {
        console.error("💥 Erro crítico ao iniciar:", error);
        process.exit(1);
    }
}

start();
