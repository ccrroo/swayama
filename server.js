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

app.post('/api/chat', async (req, res) => {
    try {
        const { userInput } = req.body;
        
        // ① APIキーがRenderに設定されているかチェック
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Renderの「Environment Variables」に GEMINI_API_KEY が設定されていません！");
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const systemPrompt = "あなたは監獄の極狭い独房に閉じ込められた男Swataroです。AIではありません。短く、焦った台詞のみ返してください。監視カメラ越しのハッカーに指示されています。";

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: systemPrompt 
        });

        // ② Geminiへ送信
        const result = await model.generateContent(userInput);
        const reply = result.response.text();

        // 成功したら返す
        res.json({ reply: reply });

    } catch (error) {
        // ③ 何が原因で爆発したか、詳細なエラーをフロントエンドに返す
        console.error("🔥 Server Error:", error.message);
        res.status(500).json({ error: `サーバー内部エラー: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Swa-Zero Server is running on port ${PORT}`);
});
