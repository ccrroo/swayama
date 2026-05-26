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

const CORE_ACTIONS = {
    "move_desk": "if(!state.done){ target.set(-6, 2, -6); state.done=true; }",
    // ★修正2：ベッドとの「物理的な摩擦」を避けるため x=4 から x=2 に変更！
    "move_bed": "if(!state.done){ target.set(2, 2, 8); state.done=true; }", 
    "move_door": "if(!state.done){ target.set(-8, 2, 0); state.done=true; }",
    "move_center": "if(!state.done){ target.set(0, 2, 0); state.done=true; }",
    "jump": "if(!state.done){ velocity.y = 15; state.done=true; }",
    "take": "if(!state.done){ state.action = 'take'; state.done=true; }",
    "open": "if(!state.done){ state.action = 'open'; state.done=true; }"
};
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
            if (!CORE_ACTIONS[doc._id]) {
                actionCache[doc._id] = doc.code;
            }
        });
        console.log(`✅ Loaded ${learnedActions.length} learned actions from MongoDB.`);
    } catch (e) {
        console.error("MongoDB Connection Error:", e.message);
    }
}
connectDB();

app.post('/api/chat', async(req, res) => {
    try {
        // ★ 変更：ゲーム側から「type（誰への指示か）」を受け取る
        const { type, userInput, gameState } = req.body;
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        let systemPrompt = "";

        const availableKeys = Object.keys(actionCache).join(", ");

        // =========================================================
        // ★ AIの人格スイッチ（監視員 or Swataro）
        // =========================================================
       if (type === "guard_check") {
            // ★変更：監視員が「勝手な想像」をしないように厳格なルールを付与
            systemPrompt = `あなたは刑務所の監視員です。部屋をスキャンしました。
【現在の部屋の状況】
${gameState}

【判定ルール（厳守）】
上記「現在の部屋の状況」の文章だけを事実として確認してください。書かれていない異常を勝手に想像しないでください。
以下のいずれかが文章に含まれている場合のみ「異常あり (isSuspicious: true)」です。
- ベッドが浮いている
- 鍵を持っている
- 不審物（見慣れない物体）がある
- 囚人が暴れている・走り回っている

上記に該当しない場合は、絶対に「異常なし (isSuspicious: false)」とし、replyは「異常なし。」の一言にしてください。
異常がある場合は、その異常について激怒して追及するセリフをreplyに書いてください。
出力形式 (JSON): {"reply": "セリフ", "isSuspicious": true/false}`;
            
        } else if (type === "guard_judge") {
            // モード2：言い訳を評価する監視員
            systemPrompt = `あなたは刑務所の恐ろしい監視員です。部屋の異常について囚人が以下の言い訳をしました。
【言い訳】「${userInput}」
これが論理的で納得できる、あるいは面白くてつい許してしまうような内容なら passed を true にしてください。ふざけすぎや意味不明なら false です。
出力形式 (JSON): {"reply": "セリフ", "passed": true/false}`;
            
        } else {
            // モード3：いつものSwataro（元のプロンプトを完全維持 ＋ 証拠隠滅ルールの追加）
            systemPrompt = `あなたは監獄の独房に閉じ込められたかよわい男の子「Swataro」です。
プレイヤーの指示から意図を汲み取り、以下のJSON形式で返答してください。

【現在のあなたの状況（絶対忘れないでください）】
${gameState}

【学習済み（既存）のアクションIDリスト】
${availableKeys}

【指示の処理ルール】
【指示の処理ルール】
1. プレイヤーの指示が「既存のアクション」で対応できる場合：
   "isNew": false とし、"actionId" に既存のIDを指定してください。
   （★重要：「机」「ベッド」「ドア」への移動は絶対に既存の move_desk, move_bed, move_door を使用すること！絶対に新しい移動アクションを作らないでください！）
   （★重要：「取る」「拾う」「鍵を取る」などのアイテム取得は、すべて既存の "take" を指定してください！）
2. リストにない全く新しい動き（例：「カラフルに光って」「膨らんで」など）の場合：
   "isNew": true とし、"actionId" に新しいアクション名を付け、"custom_code" に JavaScript のコードを生成してください。
3. 「壁を壊す」「外に出る」などゲームが崩壊する指示の場合は：
   "isNew": false, "actionId": "none" とし、replyで「それは無理だ！」と断ってください。

【脱出ゲームのルールとシナリオ】
1. 独房には「机」「ベッド」「鉄格子のドア」がある。
2. 脱出の正しい手順：
  ① ベッドに行き、ベッドを持ち上げる（builder.liftBed(); を実行）
  ② 持ち上げたベッドの下にある「鍵」を取る（takeアクション）
  ③ ドアに行き、鍵を使って脱出する。
※机には何もありません。

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

【アイテム錬成（builder）】
あなたは3D空間に「物理演算を持つアイテム」を召喚できます。必ず if(!state.done) の中で1回だけ実行してください。
出現位置は、あなたの頭上 (playerBody.position.x, playerBody.position.y + 5, playerBody.position.z) にするのが基本です。
- 四角形: builder.createBox(幅, 高さ, 奥行き, 0xRRGGBB, x, y, z);
- 球体: builder.createSphere(半径, 0xRRGGBB, x, y, z);
- アイコン: builder.createIcon("🍔", サイズ, x, y, z); // 食べ物や動物、道具などを要求されたら、最適な「絵文字」を選んで召喚してください！
【ベッドの操作】
- 持ち上げる: builder.liftBed();
- 下ろす（証拠隠滅）: builder.dropBed(); // ★追加：監視員が来る前にベッドを下ろすよう指示されたら使ってください。

出力例（新規アクション「ハンバーガーを出して」の場合）：
{
  "reply": "ハンバーガーだ！",
  "isNew": true,
  "actionId": "spawn_hamburger",
  "custom_code": "if(!state.done){ builder.createIcon('🍔', 3, playerBody.position.x, playerBody.position.y + 5, playerBody.position.z); state.done=true; }"
}
`;
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-3.5-flash",
            systemInstruction: systemPrompt,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 監視員がチェックする時はユーザーの入力（指示）がないのでダミーのテキストを渡す
        const textToProcess = userInput || "状況を確認しろ";
        const result = await model.generateContent(textToProcess);
        const aiData = JSON.parse(result.response.text());

        // =========================================================
        // ★ 分岐：Swataroの時だけコードを生成・保存する
        // =========================================================
        if (!type || type === "swataro") {
            let codeToExecute = "";

            if (aiData.isNew && aiData.custom_code) {
                codeToExecute = aiData.custom_code;
                actionCache[aiData.actionId] = aiData.custom_code;

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
            
        } else {
            // 監視員の場合は、判定結果（JSON）をそのままゲーム側に返すだけ
            res.json(aiData);
        }

    } catch (error) {
        console.error("🔥 Server Error:", error.message);
        res.status(500).json({ error: `サーバー内部エラー: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Swa-Zero Server is running on port ${PORT}`);
});
