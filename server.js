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
    "move_desk": "if(!state.done){ target.set(-6, 2, -6); state.done=true; }",
    "move_bed": "if(!state.done){ target.set(4, 2, 8); state.done=true; }",
    "move_door": "if(!state.done){ target.set(-8, 2, 0); state.done=true; }",
    "move_center": "if(!state.done){ target.set(0, 2, 0); state.done=true; }",
    "jump": "if(!state.done){ velocity.y = 15; state.done=true; }",
    "take": "if(!state.done){ state.action = 'take'; state.done=true; }",
    "open": "if(!state.done){ state.action = 'open'; state.done=true; }"
};

let db, actionsCollection;

async function connectDB() {
    if (!process.env.MONGODB_URI) {
        console.error("🔥 MONGODB_URIが設定されていません！");
        return;
    }
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        db = client.db('swazero');
        actionsCollection = db.collection('swa_actions');
        console.log("✅ MongoDB Connected!");

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

app.post('/api/chat', async(req, res) => {
    try {
        const { userInput, gameState } = req.body;
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        const availableKeys = Object.keys(actionCache).join(", ");

        const systemPrompt = `あなたは監獄の独房に閉じ込められたかよわい男の子「Swataro」です。
プレイヤーの指示から意図を汲み取り、以下のJSON形式で返答してください。

【現在のあなたの状況（絶対忘れないでください）】
${gameState}

【学習済み（既存）のアクションIDリスト】
${availableKeys}

【指示の処理ルール】
1. プレイヤーの指示が「既存のアクション」で対応できる場合：
   "isNew": false とし、"actionId" に既存のIDを指定してください。
   （★重要：「取る」「拾う」「棒を使って鍵を取る」などのアイテム取得は、すべて既存の "take" を指定してください！）
2. リストにない全く新しい動き（例：「カラフルに光って」「膨らんで」など）の場合：
   "isNew": true とし、"actionId" に新しいアクション名を付け、"custom_code" に JavaScript のコードを生成してください。
3. 「壁を壊す」「外に出る」などゲームが崩壊する指示の場合は：
   "isNew": false, "actionId": "none" とし、replyで「それは無理だ！」と断ってください。

【custom_code の書き方（最重要ルール）】
コードはゲーム内で「毎フレーム（1秒間に60回）」実行されます。
- ジャンプ(velocity.y)や移動先(target)の設定など、「1回だけでいい動作」は必ず以下のように書いてください。
  例: if(!state.done){ velocity.y = 15; state.done = true; }
- 大きさが脈打つなど「継続するアニメーション」は Math.sin(time) などをそのまま書いてOKです。
- ★重要: Swataroのデフォルトの大きさは mesh.scale.set(7, 7, 1); です。大きさを変更する場合は「7」を基準に計算してください。（例：膨らむなら mesh.scale.set(7 + Math.sin(time)*3, 7 + Math.sin(time)*3, 1) ）
- ★重要: プレイヤーから指示されたパラメータ（色だけ、ジャンプだけ等）のみを変更してください。指示されていないパラメータは絶対にコードに含めず、デフォルトのままにしてください。
- 操作可能な変数: mesh, velocity, target, time, state

出力例（新規アクション「大きく膨らむ」の場合）：
{
  "reply": "体が勝手に膨らむ！",
  "isNew": true,
  "actionId": "expand_body",
  "custom_code": "mesh.scale.set(14, 14, 1);" // デフォルト(7,7,1)の2倍にする
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

        if (aiData.isNew && aiData.custom_code) {
            codeToExecute = aiData.custom_code;
            actionCache[aiData.actionId] = aiData.custom_code;

            if (actionsCollection) {
                actionsCollection.updateOne({ _id: aiData.actionId }, { $set: { code: aiData.custom_code, createdAt: new Date() } }, { upsert: true }).catch(err => console.error("MongoDB save error:", err));
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
