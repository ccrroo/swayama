const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

app.post('/api/chat', async(req, res) => {
    try {
        // ★ ゲーム側から「プレイヤーの言葉」と「現在のゲーム状況」の両方を受け取る
        const { userInput, gameState } = req.body;

        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Renderの「Environment Variables」に GEMINI_API_KEY が設定されていません！");
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // ★ Swataroに「今何が起きたか」をコッソリ教えてあげる
        const systemPrompt = `あなたは監獄の極狭い独房に閉じ込められた男Swataroです。AIではありません。
監視カメラ越しのハッカーに指示されて動いています。短く、焦った台詞のみ返してください。

【現在の状況・行動結果】：${gameState || "特になし"}

上記の状況を踏まえて、ハッカー（プレイヤー）に相棒として返事をしてください。`;

        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-flash-lite-preview",
            systemInstruction: systemPrompt
        });

        const result = await model.generateContent(userInput);
        const reply = result.response.text();

        res.json({ reply: reply });

    } catch (error) {
        console.error("🔥 Server Error:", error.message);
        res.status(500).json({ error: `サーバー内部エラー: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Swa-Zero Server is running on port ${PORT}`);
});
