import { OpenAIEmbeddings } from "@langchain/openai";
import "dotenv/config";


export const largeOpenAiEmbedding = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY ,
    model: "text-embedding-3-large",
})

export const smallOpenAiEmbedding = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY ,
    model: "text-embedding-3-small",
})