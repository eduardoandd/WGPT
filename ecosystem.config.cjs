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
      name: "renan-bot",
      script: "npx",
      args: "tsx src/index.ts",
      env: {
        AGENT_PROFILE: "renan",
        CLIENT_ADAPTER: "telegram"
      }
    }
  ]
};
