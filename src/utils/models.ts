import { ChatOpenAI } from "@langchain/openai";

export const fastModel = new ChatOpenAI({
    model: "gpt-5.4-mini",
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY
});

export const expertModel = new ChatOpenAI({
    model: "gpt-5.4-mini",
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY
});