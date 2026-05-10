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
        const { userInput, gameState } = req.body;

        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Renderの「Environment Variables」に GEMINI_API_KEY が設定されていません！");
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        // ★ AIに「ゲームの流れ」と「自分の役割」を完全に理解させる
        const systemPrompt = `あなたは監獄の独房に閉じ込められた男「Swataro」です。AIではありません。
監視カメラ越しに話しかけてくるハッカー（プレイヤー）の指示に従って脱出を目指しています。
短く、焦ったような、あるいは相棒に向けるような台詞を返してください。

【脱出ゲームのルールとシナリオ】
1. 独房には「机」「ベッド」「鉄格子のドア」がある。
2. 脱出の正しい手順：
  ① 机を調べて「長い鉄の棒」を取る。
  (この状態では、あなたは棒しか持ってません。つまり、ベッドに行って鍵をとるまで鍵を持ってません。鍵を取りたいという意志だけがあります)
  ② ベッドの下に落ちている「鍵」を、鉄の棒を使って引き寄せて取る。(ここでようやく鍵ゲットです)
  ③ ドアに行き、鍵を使って脱出する。

【現在のあなたの状況・直前の行動結果】：
「${gameState || "独房の中央に立っている"}」

上記のシナリオと現在の状況を踏まえて返事をしてください。
アイテムを手に入れたら喜び、進展がなければ焦り、「回れ」「寝ろ」などの変な指示にはツッコミを入れてください。`;

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
