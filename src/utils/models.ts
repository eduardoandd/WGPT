import { ChatOpenAI } from "@langchain/openai";

// especealizado em velocidade
export const fastModel = new ChatOpenAI({
        model: "gpt-4o-mini",
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY
    });
export const expertModel = new ChatOpenAI({
        model: "gpt-5.2-pro",
        apiKey: process.env.OPENAI_API_KEY
    });