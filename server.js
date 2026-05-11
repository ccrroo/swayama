const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// =========================================================
// ★ AIの記憶（キャッシュ）と MongoDB の連携
// =========================================================
let actionCache = {
    "move_desk": "target.set(-6, 2, -6);", 
    "move_bed": "target.set(4, 2, 8);",    
    "move_door": "target.set(-8, 2, 0);",  
    "move_center": "target.set(0, 2, 0);", 
    "jump": "velocity.y = 15;",
    "take": "state.action = 'take';",
    "open": "state.action = 'open';"
};

let db, actionsCollection;

// MongoDBに接続する準備
async function connectDB() {
    if (!process.env.MONGODB_URI) {
        console.error("🔥 MONGODB_URIが設定されていません！");
        return;
    }
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        db = client.db('swazero'); // データベース名
        actionsCollection = db.collection('swa_actions'); // コレクション名
        console.log("✅ MongoDB Connected!");
        
        // サーバー起動時にクラウドから学習済みアクションを読み込む
        const learnedActions = await actionsCollection.find({}).toArray();
        learnedActions.forEach(doc => {
            actionCache[doc._id] = doc.code;
        });
        console.log(`✅ Loaded ${learnedActions.length} learned actions from MongoDB.`);
    } catch (e) {
        console.error("MongoDB Connection Error:", e.message);
    }
}
connectDB();

// =========================================================
// ★ AIによる指示の解読とコード生成
// =========================================================
app.post('/api/chat', async(req, res) => {
    try {
        const { userInput, gameState } = req.body;
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        const availableKeys = Object.keys(actionCache).join(", ");

        const systemPrompt = `あなたは監獄の独房に閉じ込められた男の子「Swataro」です。
プレイヤーの指示から意図を汲み取り、以下のJSON形式で返答してください。

【学習済み（既存）のアクションIDリスト】
${availableKeys}

【指示の処理ルール】
1. プレイヤーの指示が「既存のアクション」で対応できる場合：
   "isNew": false とし、"actionId" に既存のIDを指定してください。
2. リストにない全く新しい動き（例：「カラフルに光って」「膨らんで」「スキップして」など）の場合：
   "isNew": true とし、"actionId" に新しいアクション名（英数字のアンダーバー区切り）を付け、
   "custom_code" に JavaScript のコードを生成してください。
3. 「壁を壊す」「ワープする」などゲームが崩壊する指示の場合は：
   "isNew": false, "actionId": "none" とし、replyで「それは無理だ！」と断ってください。

【custom_code の書き方（サンドボックス環境）】
JavaScriptで記述し、以下の変数のみ操作可能です。これ以外は絶対に使わないでください。
- mesh (3Dモデル。mesh.scale.set(x,y,1)、mesh.material.color.setHex(0xff0000) など)
- velocity (物理エンジンの勢い。velocity.y = 15 等。※座標は直接いじらないこと)
- target (移動先座標。target.set(x, 2, z) ※xとzは-14〜14の範囲のみ)
- time (経過時間(秒)。Math.sin(time*5)等で波のようなアニメーションに使用可能)
- state (アイテム関係。取る/開ける場合は state.action = 'take'; または 'open';)

出力例（新規アクション「大きく膨らむ」の場合）：
{
  "reply": "体が勝手に膨らむ！",
  "isNew": true,
  "actionId": "expand_body",
  "custom_code": "mesh.scale.set(12, 12, 1);"
}
`;

        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-flash-lite-preview",
            systemInstruction: systemPrompt,
            generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent(userInput);
        const aiData = JSON.parse(result.response.text());

        let codeToExecute = "";

        // ★ フローチャートの分岐：新規なら生成してクラウドに保存、既存ならキャッシュから取得
        if (aiData.isNew && aiData.custom_code) {
            codeToExecute = aiData.custom_code;
            actionCache[aiData.actionId] = aiData.custom_code; // メモリに記憶

            // クラウド（MongoDB）に新規保存して恒久的に学習
            if (actionsCollection) {
                actionsCollection.updateOne(
                    { _id: aiData.actionId },
                    { $set: { code: aiData.custom_code, createdAt: new Date() } },
                    { upsert: true }
                ).catch(err => console.error("MongoDB save error:", err));
            }
        } else {
            codeToExecute = actionCache[aiData.actionId] || "";
        }

        res.json({ reply: aiData.reply, code: codeToExecute });

    } catch (error) {
        console.error("🔥 Server Error:", error.message);
        res.status(500).json({ error: `サーバー内部エラー: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Swa-Zero Server is running on port ${PORT}`);
});
