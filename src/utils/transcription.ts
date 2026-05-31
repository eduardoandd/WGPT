import OpenAI from 'openai';
import fs from 'fs';

export async function transcribeAudio(filePath: string): Promise<string> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-1',
        language: 'pt',
    });
    return response.text;
}
