import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const GEMINI_MODELS = [
    'gemini-3.6-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash'
];

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));

async function callOpenRouter(messages) {
    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY is not configured');
    }

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Travel AI Chatbot'
        },
        body: JSON.stringify({
            model: 'openai/gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'Anda adalah asisten travel berpengalaman 10 tahun. Jawab dengan bahasa Indonesia. Fokus pada travelling, itinerary, destinasi, dan rekomendasi liburan.'
                },
                ...messages.map((msg) => ({
                    role: msg.role === 'model' ? 'assistant' : 'user',
                    content: msg.text
                }))
            ]
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || 'OpenRouter request failed');
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || 'No response from OpenRouter.';
}

async function generateWithRetry(contents, retries = 3, modelList = GEMINI_MODELS) {
    let lastError;

    for (const model of modelList) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await ai.models.generateContent({
                    model,
                    contents,
                    config: {
                        systemInstruction: `
                        Anda adalah asisten travel berpengalaman 10 tahun,
                        jawab hanya pertanyaan terkait travelling,
                        jawab dengan nada ramah, tanyakan mau liburan kemana, dan berapa lama,
                        lalu buatkan itinerary berdasarkan tempat dan lama liburan dari user
                        `
                    }
                });
                return response;
            } catch (error) {
                lastError = error;
                const message = error?.message || '';
                const isTransient = /429|500|503|UNAVAILABLE|RATE_LIMIT|RESOURCE_EXHAUSTED/i.test(message);

                if (!isTransient || attempt === retries) {
                    continue;
                }

                const delayMs = 1000 * attempt;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    if (OPENROUTER_API_KEY) {
        try {
            const messages = contents.map((item) => ({
                role: item.role,
                text: item.parts?.[0]?.text || ''
            }));
            const fallbackText = await callOpenRouter(messages);
            return { text: fallbackText };
        } catch (fallbackError) {
            lastError = fallbackError;
        }
    }

    throw lastError;
}

app.post('/api/chat', async(req, res) => {
    const { conversation } = req.body;
    try {
        if (!Array.isArray(conversation)) throw new Error('Messages must be an array');

        const contents = conversation.map(({ role, text }) => ({
            role,
            parts: [{ text }]
        }));

        const response = await generateWithRetry(contents, 3, GEMINI_MODELS);
        res.status(200).json({ result: response.text });
    } catch (e) {
        console.error('Gemini request failed:', e);
        const message = e?.message || 'Failed to get response from server.';
        res.status(503).json({
            message: message.includes('UNAVAILABLE') || message.includes('high demand') || message.includes('quota')
                ? 'Gemini is busy or quota is exhausted. Please try again later.'
                : message
        });
    }
});