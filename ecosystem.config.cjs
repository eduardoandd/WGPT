module.exports = {
  apps: [
    {
      name: "eduardo-bot",
      script: "npx",
      args: "tsx src/index.ts",
      env: {
        AGENT_PROFILE: "eduardo",
        CLIENT_ADAPTER: "whatsapp",
        // A VPS roda em UTC. Sem isso, o horário das tarefas (taskTime/
        // notificationTime) é gravado 3h adiantado no Firestore.
        TZ: "America/Sao_Paulo"
      }
    },
    {
      // Job diário de assinaturas: lança os gastos recorrentes e enfileira o
      // toque na outbox (o eduardo-bot entrega). Roda 1x e sai; o cron_restart
      // do PM2 dispara de novo no horário. NÃO mantém WhatsApp aberto.
      name: "finance-cron",
      script: "npx",
      args: "tsx src/jobs/subscription-runner.ts",
      autorestart: false,
      // 11:00 UTC = 08:00 America/Sao_Paulo (Brasil sem horário de verão).
      cron_restart: "0 11 * * *",
      env: {
        TZ: "America/Sao_Paulo"
      }
    },
    // ⚠️ NÃO rode dois bots de WhatsApp sem WHATSAPP_AUTH_FOLDER diferente —
    // eles compartilham a mesma sessão e respondem cada mensagem em dobro.
    // O profile "demo" foi feito para o Slack (veja o script dev:slack):
    // {
    //   name: "demo-bot",
    //   script: "npx",
    //   args: "tsx src/index.ts",
    //   env: {
    //     AGENT_PROFILE: "demo",
    //     CLIENT_ADAPTER: "slack",
    //     SLACK_BOT_TOKEN: "xoxb-...",
    //     SLACK_APP_TOKEN: "xapp-..."
    //   }
    // },
    //
    // Se um dia quiser MESMO dois WhatsApp, cada um precisa da sua pasta de auth
    // (e de um número/QR próprio):
    // env: { AGENT_PROFILE: "demo", CLIENT_ADAPTER: "whatsapp", WHATSAPP_AUTH_FOLDER: "auth_info_demo" }
    //
    // Adicione aqui os bots dos clientes quando estiverem prontos:
    // {
    //   name: "renan-bot",
    //   script: "npx",
    //   args: "tsx src/index.ts",
    //   env: {
    //     AGENT_PROFILE: "renan",
    //     CLIENT_ADAPTER: "telegram",
    //     TELEGRAM_BOT_TOKEN: "token-do-renan"
    //   }
    // },
    // {
    //   name: "demo-slack",
    //   script: "npx",
    //   args: "tsx src/index.ts",
    //   env: {
    //     AGENT_PROFILE: "demo",
    //     CLIENT_ADAPTER: "slack",
    //     SLACK_BOT_TOKEN: "xoxb-...",
    //     SLACK_APP_TOKEN: "xapp-..."
    //   }
    // },
  ]
};
