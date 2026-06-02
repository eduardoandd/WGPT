module.exports = {
  apps: [
    {
      name: "eduardo-bot",
      script: "npx",
      args: "tsx src/index.ts",
      env: {
        AGENT_PROFILE: "eduardo",
        CLIENT_ADAPTER: "whatsapp"
      }
    },
    {
      name: "demo-bot",
      script: "npx",
      args: "tsx src/index.ts",
      env: {
        AGENT_PROFILE: "demo",
        CLIENT_ADAPTER: "whatsapp"
      }
    },
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
