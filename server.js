const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // .envファイルからAPIキーを読み込む魔法

const app = express();

// どのサイトからの通信も許可する（エラー防止）
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Google AIの準備 (.envのキーを使用)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ゲーム側から通信を受け取る窓口
app.post('/api/chat', async(req, res) => {
    const { userInput } = req.body;

    // Swataroの人格設定
    const systemPrompt = "あなたは監獄の極狭い独房に閉じ込められた男Swataroです。AIではありません。短く、焦った台詞のみ返してください。監視カメラ越しのハッカーに指示されています。";

    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: systemPrompt
        });

        // AIに考えさせる
        const result = await model.generateContent(userInput);
        const reply = result.response.text();

        // 成功したらゲーム側に返す
        res.json({ reply: reply });
    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Swa-Zero Server is running on port ${PORT}`);
});