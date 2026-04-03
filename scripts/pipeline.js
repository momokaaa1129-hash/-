/**
 * YouTube Shorts 自動生成パイプライン
 *
 * 使い方:
 *   node scripts/pipeline.js          # 全ステップ実行
 *   node scripts/pipeline.js --step=1 # ステップ単体実行
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// dotenv を動的にロード（ESM 互換）
const require = createRequire(import.meta.url);
try {
  const dotenv = require("dotenv");
  dotenv.config();
} catch {
  console.warn("dotenv が見つかりません。環境変数を直接設定してください。");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---- パス定数 ----
const PATHS = {
  styleGuide:  path.join(ROOT, "style_guide.md"),
  candidates:  path.join(ROOT, "output", "scripts", "candidates.json"),
  explanation: path.join(ROOT, "output", "scripts", "explanation.json"),
  script:      path.join(ROOT, "output", "scripts", "script.txt"),
  timing:      path.join(ROOT, "output", "scripts", "timing.json"),
  srt:         path.join(ROOT, "output", "scripts", "subtitle.srt"),
  audio:       path.join(ROOT, "output", "audio", "narration.mp3"),
  video:       path.join(ROOT, "output", "videos", "final.mp4"),
  bgm:         path.join(ROOT, "output", "assets", "bgm.mp3"),
  background:  path.join(ROOT, "output", "assets", "background.mp4"),
  clips:       path.join(ROOT, "output", "assets", "clips"),
  sfxDir:      path.join(ROOT, "output", "assets", "sfx"),
  errorLog:    path.join(ROOT, "output", "error_log.txt"),
};

// ---- ユーティリティ ----

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeText(filePath, text) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, text, "utf-8");
}

function logError(stepName, error) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [${stepName}] ${error}\n`;
  ensureDir(PATHS.errorLog);
  fs.appendFileSync(PATHS.errorLog, message, "utf-8");
  console.error(message.trim());
}

/**
 * 最大 maxRetries 回リトライしながら非同期処理を実行する。
 * 全試行が失敗した場合は最後のエラーをスローする。
 */
async function withRetry(fn, maxRetries = 3, stepName = "unknown") {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = `試行 ${attempt}/${maxRetries} 失敗: ${err.message}`;
      console.warn(`[${stepName}] ${msg}`);
      if (attempt < maxRetries) {
        await sleep(attempt * 1000);
      }
    }
  }
  logError(stepName, `3回リトライ後も失敗: ${lastError.message}`);
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- curl ベース HTTP ヘルパー ----
// Node.js の DNS 解決がこの環境でブロックされているため、
// システムの curl コマンド経由でAPIリクエストを行う。

/**
 * curl を使って POST リクエストを送り、レスポンスボディを返す。
 * @param {object} opts
 * @param {string} opts.url
 * @param {object} opts.headers  key-value ヘッダー
 * @param {object|string} opts.body  JSON オブジェクトまたは文字列
 * @param {boolean} [opts.binary]  true のとき Buffer を返す
 * @returns {string|Buffer}
 */
function curlPost({ url, headers, body, binary = false }) {
  const tmpIn = path.join(os.tmpdir(), `pipeline_req_${Date.now()}.json`);
  const tmpOut = path.join(os.tmpdir(), `pipeline_res_${Date.now()}.bin`);

  try {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    fs.writeFileSync(tmpIn, bodyStr, "utf-8");

    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`)
      .join(" ");

    execSync(
      `curl -sS -k -X POST ${headerArgs} -d @${JSON.stringify(tmpIn)} -o ${JSON.stringify(tmpOut)} ${JSON.stringify(url)}`,
      { stdio: ["ignore", "ignore", "pipe"] }
    );

    return binary
      ? fs.readFileSync(tmpOut)
      : fs.readFileSync(tmpOut, "utf-8");
  } finally {
    for (const f of [tmpIn, tmpOut]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

/**
 * curl を使って GET リクエストを送る。
 */
function curlGet({ url, headers = {} }) {
  const headerArgs = Object.entries(headers)
    .map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`)
    .join(" ");
  return execSync(
    `curl -sS -k ${headerArgs} ${JSON.stringify(url)}`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

// ---- ElevenLabs 誤読対策：読み仮名変換テーブル ----
// ElevenLabsが誤読しやすい漢字をひらがなに置換する
const KANJI_TTS_MAP = [
  // 長いものを先に並べて部分一致の誤置換を防ぐ
  ["過酸化水素", "かさんかすいそ"],
  ["電気分解",   "でんきぶんかい"],
  ["原子核",     "げんしかく"],
  ["中性子",     "ちゅうせいし"],
  ["酸化",       "さんか"],
  ["還元",       "かんげん"],
  ["触媒",       "しょくばい"],
  ["分解",       "ぶんかい"],
  ["反応",       "はんのう"],
  ["気体",       "きたい"],
  ["液体",       "えきたい"],
  ["固体",       "こたい"],
  ["水素",       "すいそ"],
  ["酸素",       "さんそ"],
  ["燃焼",       "ねんしょう"],
  ["密度",       "みつど"],
  ["濃度",       "のうど"],
  ["溶液",       "ようえき"],
  ["溶解",       "ようかい"],
  ["結晶",       "けっしょう"],
  ["中和",       "ちゅうわ"],
  ["電流",       "でんりゅう"],
  ["電圧",       "でんあつ"],
  ["磁力",       "じりょく"],
  ["重力",       "じゅうりょく"],
  ["慣性",       "かんせい"],
  ["圧力",       "あつりょく"],
  ["温度",       "おんど"],
  ["速度",       "そくど"],
  ["分子",       "ぶんし"],
  ["原子",       "げんし"],
  ["電子",       "でんし"],
  ["陽子",       "ようし"],
  ["炎",         "ほのお"],
  ["泡",         "あわ"],
  ["熱",         "ねつ"],
  ["光",         "ひかり"],
];

function convertKanjiForTTS(text) {
  let result = text;
  for (const [kanji, reading] of KANJI_TTS_MAP) {
    result = result.replaceAll(kanji, reading);
  }
  return result;
}

// ---- Gemini API ヘルパー ----

function callGemini({ model, prompt, systemInstruction }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const body = {
    contents,
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    generationConfig: { responseMimeType: "text/plain" },
  };

  const raw = curlPost({
    url,
    headers: { "Content-Type": "application/json" },
    body,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini API レスポンスが JSON でありません:\n${raw}`);
  }

  if (parsed.error) {
    throw new Error(`Gemini API エラー: ${JSON.stringify(parsed.error)}`);
  }

  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini API レスポンスにテキストがありません:\n${raw}`);
  }
  return text;
}

// ---- ステップ実装 ----

/**
 * ステップ1: 英語キーワードで海外実験動画を5件収集し、
 * Gemini にタイトルを分析させて candidates.json に保存する。
 *
 * ワークフロー: 動画先行 → 台本生成
 *   動画のタイトル・IDを素材にして解説を生成することで
 *   背景動画と台本の内容が一致する。
 */
async function step1_fetchCandidates() {
  console.log("\n=== ステップ1: 海外実験動画の収集 ===");

  // yt-dlp の存在確認
  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    throw new Error("yt-dlp が見つかりません。\n  インストール: pip install yt-dlp");
  }

  const SEARCH_QUERIES = [
    "science experiment amazing reaction",
    "cool chemistry experiment kids",
    "physics experiment viral reaction",
  ];

  const seenIds = new Set();
  const videoItems = [];

  for (const q of SEARCH_QUERIES) {
    if (videoItems.length >= 5) break;
    try {
      const raw = execSync(
        `yt-dlp "ytsearch5:${q}" --flat-playlist --print "%(id)s\t%(title)s" --no-warnings`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
      );
      for (const line of raw.trim().split(/\r?\n/).filter(Boolean)) {
        if (videoItems.length >= 5) break;
        const tabIdx = line.indexOf("\t");
        const id    = tabIdx >= 0 ? line.slice(0, tabIdx).trim() : line.trim();
        const title = tabIdx >= 0 ? line.slice(tabIdx + 1).trim() : "";
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          videoItems.push({ id, title: title || id });
        }
      }
    } catch (err) {
      console.warn(`  ⚠ "${q}" の検索をスキップ: ${err.message.slice(0, 60)}`);
    }
  }

  if (videoItems.length === 0) {
    throw new Error("動画の検索結果が0件でした。ネットワーク接続を確認してください。");
  }

  console.log(`  ${videoItems.length} 件の動画を取得しました`);
  videoItems.forEach((v) => console.log(`    - [${v.id}] ${v.title}`));

  // Gemini がタイトルを分析し「何の実験か」を把握、最もバズりそうな1件を選ぶ
  const videoList = videoItems
    .map((v, i) => `${i + 1}. [VideoID: ${v.id}] ${v.title}`)
    .join("\n");

  const prompt = `
以下は海外の科学実験動画のリスト（YouTubeのID + タイトル）です。

${videoList}

これらの各動画を「タイトルから推測して、この動画で何が起きているか」を把握し、
YouTube Shortsで最もバズりそうな実験を1件選んでください。

条件:
- 視覚的に驚ける（映像映えする）
- 60秒以内で説明できる
- 中学生でも理解できる

出力形式（JSONのみ。コードブロック不要）:
{
  "candidates": [
    {
      "id": 1,
      "video_id": "<選んだ動画のYouTube ID>",
      "title": "実験名（日本語）",
      "description": "この動画で何が起きているか（1〜2文、日本語）",
      "keywords": ["キーワード1", "キーワード2"],
      "buzz_reason": "なぜバズりやすいか（1文）"
    }
  ],
  "retrieved_at": "ISO8601形式の日時"
}
`;

  const rawText = await withRetry(
    () => Promise.resolve(callGemini({ model: "gemini-2.5-flash", prompt })),
    3,
    "step1"
  );

  const jsonText = extractJson(rawText);
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error(`Gemini の応答が JSON としてパースできません:\n${rawText}`);
  }

  if (!data.candidates || !Array.isArray(data.candidates)) {
    throw new Error("candidates 配列が応答に含まれていません");
  }

  // 収集した全動画IDを保存（stepBg が再利用できるよう）
  data.source_video_ids = videoItems.map((v) => v.id);
  data.retrieved_at = data.retrieved_at || new Date().toISOString();

  writeJson(PATHS.candidates, data);
  console.log(`✓ candidates.json を保存しました`);
  data.candidates.forEach((c) => console.log(`  - ${c.title} [${c.video_id}]`));
  return data;
}

/**
 * ステップ2: 候補から最もバズりそうな1件を選び、詳細解説を生成して explanation.json に保存
 */
async function step2_generateExplanation() {
  console.log("\n=== ステップ2: 実験の深掘り解説生成 ===");

  if (!fs.existsSync(PATHS.candidates)) {
    throw new Error(
      "candidates.json が見つかりません。先にステップ1を実行してください。"
    );
  }
  const candidates = readJson(PATHS.candidates);

  const prompt = `
以下は海外の科学実験動画をもとに収集した候補リストです。
各候補の "description" フィールドには「この動画で何が起きているか」が書かれています。

${JSON.stringify(candidates, null, 2)}

この中から YouTube Shorts で最もバズりそうな実験を1件選び、
日本語視聴者向けの詳しい解説を以下の JSON 形式で出力してください（コードブロック不要）:

{
  "selected": {
    "id": <候補のid>,
    "video_id": "<選んだ候補の video_id>",
    "title": "<実験タイトル（日本語）>",
    "reason_selected": "<選んだ理由（1文）>"
  },
  "explanation": {
    "what_happens": "<この実験・動画で何が起きているか（1〜2文）>",
    "scientific_basis": "<科学的根拠（2〜3文）>",
    "daily_connection": "<日常生活との繋がり（1〜2文）>",
    "trivia": "<豆知識（1〜2文）>",
    "common_misconception": "<よくある誤解（1〜2文）>"
  },
  "diagrams": [
    {
      "timing": <解説パート(15〜50秒)の中で図説を表示する秒数。例: 25>,
      "duration": <表示秒数。5〜8秒を推奨>,
      "type": "flow",
      "steps": [
        {"text": "<ステップ1のテキスト（10字以内）>", "arrow": "→"},
        {"text": "<ステップ2のテキスト（10字以内）>", "arrow": "→"},
        {"text": "<ステップ3のテキスト（10字以内）>"}
      ]
    }
  ]
}

diagrams の注意点:
- この実験の「仕組み」を3ステップの因果関係で説明すること
- steps は必ず3つ。最後のステップに arrow は不要
- timing は必ず 18〜44 の範囲にすること（解説パート内）
- テキストは短く・インパクトある表現にすること
`;

  const rawText = await withRetry(
    () => Promise.resolve(callGemini({
        model: "gemini-2.5-flash",
        prompt,
        systemInstruction:
          "あなたは科学コンテンツの専門家です。正確で分かりやすい解説を提供してください。情報を捏造せず、不明な点は「取得失敗」と記録してください。",
      })),
    3,
    "step2"
  );

  const jsonText = extractJson(rawText);
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error(`Gemini の応答が JSON としてパースできません:\n${rawText}`);
  }

  writeJson(PATHS.explanation, data);
  console.log(`✓ explanation.json を保存しました: ${data.selected.title}`);
  return data;
}

/**
 * ステップ3: style_guide.md を読み込み、台本を生成して script.txt に保存
 */
async function step3_generateScript() {
  console.log("\n=== ステップ3: 台本の自動生成 ===");

  if (!fs.existsSync(PATHS.explanation)) {
    throw new Error(
      "explanation.json が見つかりません。先にステップ2を実行してください。"
    );
  }
  if (!fs.existsSync(PATHS.styleGuide)) {
    throw new Error("style_guide.md が見つかりません。");
  }

  const explanation = readJson(PATHS.explanation);
  const styleGuide = fs.readFileSync(PATHS.styleGuide, "utf-8");

  const prompt = `
以下のスタイルガイドを**厳守**して、YouTube Shorts用の60秒台本を生成してください。

=== スタイルガイド ===
${styleGuide}

=== 解説素材（海外実験動画をもとに生成） ===
${JSON.stringify(explanation, null, 2)}

=== 台本の流れ（厳守） ===
この動画で「何が起きているか」を視聴者が理解できるよう、以下の流れで構成すること:
  フック    → 「なぜこうなるの？」という疑問・驚きで視聴者を掴む
  紹介      → 「実はこういう現象なんだ」と現象を紹介
  解説      → 「仕組みはこうだよ」と科学的に説明
  締め      → 「日常でも〇〇に使われてる」と身近な例で締める

=== 出力形式（厳守） ===
必ず以下の形式で出力すること。セクションヘッダー行（[フック: 0〜3秒] など）は**必ず残す**こと。ヘッダーを省略しないこと。

[フック: 0〜3秒]
ここにフックのテキスト（30字以内の問いかけ or 驚き表現）

[紹介: 3〜15秒]
ここに紹介のテキスト（実験名・概要、80字以内）

[解説: 15〜50秒]
ここに解説のテキスト（科学的仕組み・日常例・豆知識、200字以内）

[締め: 50〜60秒]
ここに締めのテキスト（日常への繋がり・知識の余韻、60字以内）

注意：
- セクションヘッダー（[フック: 0〜3秒] 等）は必ずそのまま出力すること
- 各セクションの（...）の説明文は出力しないこと。台本テキストのみ書くこと
- スタイルガイドの禁止表現を一切使わないこと
- フェニックスの口調で書くこと
- 読みが複数ある漢字や専門用語は、テキスト音声合成（TTS）での誤読を防ぐため
  直接ひらがなで書くこと
  例：酸素 → さんそ、触媒 → しょくばい、泡 → あわ、炎 → ほのお
`;

  const scriptText = await withRetry(
    () => Promise.resolve(callGemini({
        model: "gemini-2.5-flash",
        prompt,
        systemInstruction:
          "あなたはフェニックスというキャラクターで台本を書くライターです。スタイルガイドを必ず守ってください。",
      })),
    3,
    "step3"
  );

  writeText(PATHS.script, scriptText.trim());
  console.log(`✓ script.txt を保存しました`);
  console.log("--- 台本プレビュー（先頭200字） ---");
  console.log(scriptText.slice(0, 200));
  console.log("-----------------------------------");
  return scriptText;
}

/**
 * ステップ4: ElevenLabs API で音声生成し narration.mp3 に保存
 */
async function step4_generateAudio() {
  console.log("\n=== ステップ4: ナレーション音声の生成 ===");

  if (!fs.existsSync(PATHS.script)) {
    throw new Error(
      "script.txt が見つかりません。先にステップ3を実行してください。"
    );
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) throw new Error("ELEVENLABS_API_KEY が設定されていません");
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID が設定されていません");

  const scriptText = fs.readFileSync(PATHS.script, "utf-8");

  // セクションタグを除去してナレーション用テキストを作成
  // さらに漢字→読み仮名変換でElevenLabsの誤読を防ぐ
  const narrationText = convertKanjiForTTS(
    scriptText
      .replace(/\[.+?\]/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const body = JSON.stringify({
    text: narrationText,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0.4,
      use_speaker_boost: true,
    },
  });

  ensureDir(PATHS.audio);

  await withRetry(() => {
    const tmpBody = path.join(os.tmpdir(), `el_req_${Date.now()}.json`);
    try {
      fs.writeFileSync(tmpBody, body, "utf-8");

      // curl 1回で直接ファイルに保存し、ステータスコードを標準出力へ
      const statusRaw = execSync(
        `curl -sS -k -X POST ` +
          `-H ${JSON.stringify(`xi-api-key: ${apiKey}`)} ` +
          `-H "Content-Type: application/json" ` +
          `-H "Accept: audio/mpeg" ` +
          `-d @${JSON.stringify(tmpBody)} ` +
          `-o ${JSON.stringify(PATHS.audio)} ` +
          `-w "%{http_code}" ` +
          JSON.stringify(url),
        { stdio: ["ignore", "pipe", "pipe"] }
      ).toString().trim();

      if (statusRaw !== "200") {
        // エラー時はレスポンス本文がファイルに入っているので読み取る
        const errBody = fs.existsSync(PATHS.audio)
          ? fs.readFileSync(PATHS.audio, "utf-8")
          : "(レスポンスなし)";
        try { fs.unlinkSync(PATHS.audio); } catch { /* ignore */ }
        throw new Error(`ElevenLabs API エラー ${statusRaw}: ${errBody}`);
      }
    } finally {
      try { fs.unlinkSync(tmpBody); } catch { /* ignore */ }
    }
  }, 3, "step4");

  const sizeMB = (fs.statSync(PATHS.audio).size / 1024 / 1024).toFixed(2);
  console.log(`✓ narration.mp3 を保存しました (${sizeMB} MB)`);
  return PATHS.audio;
}

/**
 * ステップWhisper: faster-whisper で narration.mp3 を解析し
 * フレーズ単位のタイムスタンプを output/scripts/timing.json に保存する。
 *
 * 前提: pip install faster-whisper
 */
async function stepWhisper_alignAudio() {
  console.log("\n=== ステップWhisper: 音声タイミング解析 ===");

  if (!fs.existsSync(PATHS.audio)) {
    throw new Error(
      "narration.mp3 が見つかりません。先にステップ4を実行してください。"
    );
  }

  const whisperScript = path.join(ROOT, "scripts", "whisper_align.py");

  // Python コマンド（Windows: python / mac+linux: python3 を優先）
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  await withRetry(
    () => {
      execSync(`${pythonCmd} "${whisperScript}"`, {
        cwd: ROOT,
        stdio: "inherit",
        timeout: 300000, // 最大5分
      });
    },
    3,
    "stepWhisper"
  );

  if (!fs.existsSync(PATHS.timing)) {
    throw new Error("timing.json の生成に失敗しました。");
  }

  const timing = readJson(PATHS.timing);
  console.log(`✓ タイミング解析完了 (${timing.phrase_count} フレーズ)`);

  // ---- SRT ファイルを生成（Filmoraなどの外部ツールで読み込める形式） ----
  const toSrtTime = (sec) => {
    const h   = Math.floor(sec / 3600);
    const m   = Math.floor((sec % 3600) / 60);
    const s   = Math.floor(sec % 60);
    const ms  = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  };

  const srtContent = timing.phrases
    .map((p, i) =>
      `${i + 1}\n${toSrtTime(p.start)} --> ${toSrtTime(p.end)}\n${p.text}`
    )
    .join("\n\n");

  // UTF-8 BOMなし で保存
  fs.writeFileSync(PATHS.srt, srtContent, { encoding: "utf-8" });
  console.log(`✓ subtitle.srt を保存しました (${timing.phrases.length} 件)`);

  return PATHS.timing;
}

/**
 * ステップBG: YouTube動画から背景クリップを生成し background.mp4 に保存する。
 *
 * 前提ツール（要インストール）:
 *   pip install yt-dlp
 *   ffmpeg （PATH に通しておくこと）
 */
async function stepBg_fetchBackgroundVideo() {
  console.log("\n=== ステップBG: 背景動画の生成 ===");

  // yt-dlp / ffmpeg の存在確認
  for (const [cmd, hint] of [
    ["yt-dlp --version", "pip install yt-dlp"],
    ["ffmpeg -version",  "https://ffmpeg.org/download.html"],
  ]) {
    try {
      execSync(cmd, { stdio: "pipe" });
    } catch {
      throw new Error(`${cmd.split(" ")[0]} が見つかりません。\n  インストール: ${hint}`);
    }
  }

  // candidates.json の source_video_ids を優先して再利用（step1 で収集済み）
  // なければ explanation.json のキーワードから英語で検索
  const seenIds = new Set();
  const allVideoIds = [];

  if (fs.existsSync(PATHS.candidates)) {
    const candidates = readJson(PATHS.candidates);
    const srcIds = candidates.source_video_ids ?? [];
    if (srcIds.length > 0) {
      console.log(`  step1 で収集した動画IDを再利用 (${srcIds.length} 件)`);
      for (const id of srcIds) {
        if (!seenIds.has(id)) { seenIds.add(id); allVideoIds.push(id); }
      }
    }
  }

  // IDが足りない場合は英語キーワードで追加検索
  if (allVideoIds.length < 4) {
    if (!fs.existsSync(PATHS.explanation)) {
      throw new Error("explanation.json が見つかりません。先にステップ2を実行してください。");
    }
    const explanation = readJson(PATHS.explanation);
    const jpTitle = explanation.selected.title.replace(/["""''「」【】（）()]/g, "").trim();

    let enQuery = "";
    try {
      enQuery = callGemini({
        model: "gemini-2.5-flash",
        prompt: `次の日本語の科学実験名をYouTube検索用の英語キーワードに訳してください（2〜4単語のみ出力）: "${jpTitle}"`,
      }).trim().replace(/["""]/g, "").slice(0, 60);
      console.log(`  英語キーワード: "${enQuery}"`);
    } catch {
      console.warn("  ⚠ 英語キーワードの生成をスキップ");
    }

    // 英語キーワードのみで検索（海外動画を優先）
    const searchQ = enQuery ? `${enQuery} experiment` : "science experiment amazing";
    try {
      const raw = execSync(
        `yt-dlp "ytsearch8:${searchQ}" --flat-playlist --print id --no-warnings`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
      );
      for (const id of raw.trim().split(/\r?\n/).filter(Boolean)) {
        if (!seenIds.has(id)) { seenIds.add(id); allVideoIds.push(id); }
      }
    } catch (err) {
      console.warn(`  ⚠ "${searchQ}" の検索をスキップ: ${err.message.slice(0, 60)}`);
    }
  }

  // Pexels 動画を追加（APIキーが設定されている場合のみ）
  const pexelsKey = process.env.PEXELS_API_KEY;
  const pexelsClipUrls = [];
  if (pexelsKey) {
    // candidates.json の実験タイトルを英語キーワードとして使用
    let pexelsQuery = "science experiment";
    if (fs.existsSync(PATHS.candidates)) {
      try {
        const cands = readJson(PATHS.candidates);
        const title = cands.candidates?.[0]?.title ?? "";
        if (title) pexelsQuery = title.replace(/["""''「」【】（）()]/g, "").trim();
      } catch { /* ignore */ }
    }
    try {
      const raw = curlGet({
        url: `https://api.pexels.com/videos/search?query=${encodeURIComponent(pexelsQuery)}&per_page=5&orientation=portrait`,
        headers: { "Authorization": pexelsKey },
      });
      const data = JSON.parse(raw);
      for (const v of (data.videos || [])) {
        // 縦型優先・最大720p
        const file =
          v.video_files.find((f) => f.width <= 1080 && f.height >= 720 && f.height <= 1920) ||
          v.video_files[0];
        if (file?.link) pexelsClipUrls.push({ id: `pexels_${v.id}`, url: file.link });
      }
      console.log(`  Pexels: ${pexelsClipUrls.length} 件`);
    } catch (err) {
      console.warn(`  ⚠ Pexels をスキップ: ${err.message.slice(0, 60)}`);
    }
  }

  if (allVideoIds.length === 0 && pexelsClipUrls.length === 0) {
    throw new Error("動画の検索結果が0件でした。ネットワーク接続を確認してください。");
  }
  console.log(`  合計 ${allVideoIds.length} 件のYouTube ID（重複排除済み）`);

  // ---- クリップ変換ヘルパー ----
  fs.mkdirSync(PATHS.clips, { recursive: true });
  const processedClips = [];
  let clipIndex = 0;

  /** rawファイルをffmpegで縦型1080x1920・5秒に変換してprocessedClipsに追加 */
  function processRawClip(rawPath, label) {
    const processed = path.join(PATHS.clips, `clip_${clipIndex}.mp4`);
    try {
      execSync(
        `ffmpeg -y -i "${rawPath}" -t 5 ` +
          `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" ` +
          `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -an "${processed}"`,
        { stdio: "pipe", timeout: 90000 }
      );
      if (fs.existsSync(processed) && fs.statSync(processed).size > 5000) {
        processedClips.push(processed);
        console.log(`  ✓ クリップ${processedClips.length} [${label}]`);
        clipIndex++;
        return true;
      }
    } catch (err) {
      console.warn(`  ⚠ 変換失敗 [${label}]: ${err.message.slice(0, 60)}`);
    }
    try { fs.unlinkSync(rawPath); } catch { /* ignore */ }
    return false;
  }

  // ---- YouTube クリップ ----
  for (const vid of allVideoIds) {
    if (processedClips.length >= 6) break;
    // オープニングをスキップするため開始位置を 30〜60 秒後にランダム設定
    const startSec = Math.floor(Math.random() * 31) + 30;
    const endSec   = startSec + 5;
    const rawPattern = path.join(PATHS.clips, `raw_yt_${clipIndex}.%(ext)s`).replace(/\\/g, "/");
    try {
      execSync(
        `yt-dlp -f "best[height<=720]" ` +
          `--download-sections "*${startSec}-${endSec}" ` +
          `--match-filter "!subtitles" ` +
          `--no-part --no-continue --no-warnings -o "${rawPattern}" ` +
          `"https://www.youtube.com/watch?v=${vid}"`,
        { stdio: "pipe", timeout: 60000 }
      );
      const rawFile = fs.readdirSync(PATHS.clips).find((f) => f.startsWith(`raw_yt_${clipIndex}.`));
      if (rawFile) processRawClip(path.join(PATHS.clips, rawFile), vid);
    } catch (err) {
      console.warn(`  ⚠ YouTube ${vid} をスキップ: ${err.message.slice(0, 60)}`);
    }
  }

  // ---- Pexels クリップ ----
  for (const { id, url } of pexelsClipUrls) {
    if (processedClips.length >= 8) break;
    const rawPath = path.join(PATHS.clips, `raw_px_${clipIndex}.mp4`);
    try {
      execSync(
        `curl -sS -k -L -o "${rawPath}" "${url}"`,
        { stdio: "pipe", timeout: 60000 }
      );
      if (fs.existsSync(rawPath)) processRawClip(rawPath, id);
    } catch (err) {
      console.warn(`  ⚠ Pexels ${id} をスキップ: ${err.message.slice(0, 60)}`);
    }
  }

  if (processedClips.length === 0) {
    throw new Error(
      "有効なクリップを1件も取得できませんでした。\n" +
        "  - yt-dlp と ffmpeg が正しくインストールされているか確認してください\n" +
        "  - ネットワーク接続を確認してください"
    );
  }

  // ---- ffmpeg でクリップを結合 ----
  const concatList = path.join(PATHS.clips, "concat_list.txt");
  fs.writeFileSync(
    concatList,
    processedClips.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"),
    "utf-8"
  );
  ensureDir(PATHS.background);
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${PATHS.background}"`,
    { stdio: "pipe" }
  );

  console.log(`✓ background.mp4 を保存しました（${processedClips.length}クリップ）`);
  return PATHS.background;
}

/**
 * ステップSFX: Freesound API から効果音を取得し output/assets/sfx/ に保存する。
 *
 * 必要な設定: .env に FREESOUND_API_KEY を追加
 * 取得方法: https://freesound.org/apiv2/apply/
 *
 * 取得する効果音:
 *   whoosh.mp3  … フック開始時（インパクト音）
 *   chime.mp3   … 締め開始時（余韻チャイム）
 */
async function stepSfx_fetchSoundEffects() {
  console.log("\n=== ステップSFX: 効果音の取得 ===");

  const apiKey = process.env.FREESOUND_API_KEY;
  if (!apiKey) {
    console.warn(
      "  ⚠ FREESOUND_API_KEY が未設定です。.env に追加してください。\n" +
        "    取得: https://freesound.org/apiv2/apply/\n" +
        "  効果音なしで続行します。"
    );
    return null;
  }

  fs.mkdirSync(PATHS.sfxDir, { recursive: true });

  const SFX_TARGETS = [
    { name: "whoosh", query: "whoosh swipe fast",    outFile: "whoosh.mp3" },
    { name: "chime",  query: "soft chime bell calm", outFile: "chime.mp3"  },
  ];

  for (const target of SFX_TARGETS) {
    const outPath = path.join(PATHS.sfxDir, target.outFile);
    if (fs.existsSync(outPath)) {
      console.log(`  ✓ ${target.outFile} はキャッシュ済み`);
      continue;
    }

    try {
      // Freesound でテキスト検索
      const searchUrl =
        `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(target.query)}` +
        `&token=${apiKey}&fields=id,name,previews&page_size=5&format=json`;
      const raw = curlGet({ url: searchUrl });
      const data = JSON.parse(raw);
      const results = data.results ?? [];

      if (results.length === 0) {
        console.warn(`  ⚠ "${target.query}" の検索結果が0件`);
        continue;
      }

      // 最初のヒットのプレビューURLをダウンロード
      const previewUrl = results[0]?.previews?.["preview-hq-mp3"] ??
                         results[0]?.previews?.["preview-lq-mp3"];
      if (!previewUrl) {
        console.warn(`  ⚠ ${target.name}: プレビューURLが見つかりません`);
        continue;
      }

      execSync(
        `curl -sS -k -L -o "${outPath}" "${previewUrl}"`,
        { stdio: "pipe", timeout: 30000 }
      );

      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
        console.log(`  ✓ ${target.outFile} を保存しました`);
      } else {
        console.warn(`  ⚠ ${target.outFile} のダウンロードに失敗しました`);
        try { fs.unlinkSync(outPath); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn(`  ⚠ ${target.name} をスキップ: ${err.message.slice(0, 80)}`);
    }
  }

  return PATHS.sfxDir;
}

/**
 * ステップBGM: archive.org から著作権フリー音楽を取得し bgm.mp3 に保存する。
 * APIキー不要。すでに bgm.mp3 があればスキップ。
 */
async function stepBgm_fetchBGM() {
  console.log("\n=== ステップBGM: BGM取得 ===");

  if (fs.existsSync(PATHS.bgm)) {
    console.log("  ✓ bgm.mp3 はキャッシュ済み");
    return PATHS.bgm;
  }

  ensureDir(PATHS.bgm);

  // archive.org の著作権フリー楽曲を検索（APIキー不要）
  const searchUrl =
    "https://archive.org/advancedsearch.php?" +
    "q=subject%3A%22royalty+free%22+subject%3A%22instrumental%22+mediatype%3Aaudio" +
    "&fl[]=identifier,title&sort[]=downloads+desc&rows=10&page=1&output=json";

  try {
    const raw = curlGet({ url: searchUrl });
    const data = JSON.parse(raw);
    const items = data?.response?.docs ?? [];

    if (items.length === 0) {
      console.warn("  ⚠ archive.org 検索結果が0件でした");
      return null;
    }

    for (const item of items.slice(0, 5)) {
      const id = item.identifier;
      try {
        const filesRaw = curlGet({ url: `https://archive.org/metadata/${id}/files` });
        const filesData = JSON.parse(filesRaw);
        const mp3 = (filesData?.result ?? []).find(
          (f) => f.name?.endsWith(".mp3") && f.source === "original"
        );
        if (!mp3) continue;

        const mp3Url =
          `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(mp3.name)}`;
        execSync(
          `curl -sS -k -L -o "${PATHS.bgm}" "${mp3Url}"`,
          { stdio: "pipe", timeout: 90000 }
        );

        if (fs.existsSync(PATHS.bgm) && fs.statSync(PATHS.bgm).size > 10000) {
          console.log(`  ✓ BGMを保存しました: ${mp3.name} (archive.org/${id})`);
          return PATHS.bgm;
        }
      } catch { /* 次の候補を試す */ }
    }
  } catch (err) {
    console.warn(`  ⚠ archive.org BGM取得をスキップ: ${err.message.slice(0, 60)}`);
  }

  console.warn(
    "  ⚠ BGMの自動取得に失敗しました。\n" +
    "    output/assets/bgm.mp3 に著作権フリーの音楽ファイルを手動で配置してください。"
  );
  return null;
}

/**
 * script.txt のセクションヘッダーを解析して字幕データを返す。
 *
 * 対応フォーマット①（ヘッダーあり）:
 *   [フック: 0〜3秒]
 *   テキスト
 *
 * 対応フォーマット②（ヘッダーなし・Geminiがヘッダーを省略した場合）:
 *   テキスト（段落1）
 *
 *   テキスト（段落2）
 *   → 段落の順番でフック→紹介→解説→締め の固定タイミングを割り当て
 */
function parseScriptToSubtitles(scriptText) {
  // ---- フォーマット①: タイミングヘッダーを探す ----
  // 全角チルド(〜)・半角チルド(~)・波ダッシュ(～) をすべて許容
  const headerRe = /\[([^:：\]]+)[：:]\s*(\d+)\s*[〜~～]\s*(\d+)秒\]/g;
  const headers = [];
  let match;
  while ((match = headerRe.exec(scriptText)) !== null) {
    headers.push({
      label: match[1].trim(),
      start: parseInt(match[2], 10),
      end: parseInt(match[3], 10),
      index: match.index,
      length: match[0].length,
    });
  }

  if (headers.length > 0) {
    return headers
      .map((h, i) => {
        const contentStart = h.index + h.length;
        const contentEnd =
          i + 1 < headers.length ? headers[i + 1].index : scriptText.length;
        const text = scriptText.slice(contentStart, contentEnd).trim();
        return text ? { label: h.label, start: h.start, end: h.end, text } : null;
      })
      .filter(Boolean);
  }

  // ---- フォーマット②: ヘッダーなし → 段落分割 + 固定タイミング ----
  // Geminiがヘッダーを省略してテキストだけ出力した場合のフォールバック
  const DEFAULT_TIMING = [
    { label: "フック", start: 0,  end: 3  },
    { label: "紹介",  start: 3,  end: 15 },
    { label: "解説",  start: 15, end: 50 },
    { label: "締め",  start: 50, end: 60 },
  ];

  const paragraphs = scriptText
    .split(/\n{2,}/)          // 空行で段落分割
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  // 段落数がセクション数より少ない場合は末尾のセクションに残りを結合
  const result = DEFAULT_TIMING.map((timing, i) => {
    if (i < paragraphs.length - 1) {
      return { ...timing, text: paragraphs[i] };
    }
    if (i === DEFAULT_TIMING.length - 1) {
      // 最後のセクション：残り段落をすべて結合
      return { ...timing, text: paragraphs.slice(i).join("\n") };
    }
    return null;
  }).filter(Boolean);

  return result;
}

/**
 * ステップ5: Remotion で動画をレンダリングし final.mp4 に保存
 */
async function step5_renderVideo() {
  console.log("\n=== ステップ5: 動画のレンダリング ===");

  // 前提ファイルの確認
  if (!fs.existsSync(PATHS.script)) {
    throw new Error(
      "script.txt が見つかりません。先にステップ3を実行してください。"
    );
  }
  if (!fs.existsSync(PATHS.audio)) {
    throw new Error(
      "narration.mp3 が見つかりません。先にステップ4を実行してください。"
    );
  }

  // ---- 字幕データを script.txt から生成 ----
  const scriptText = fs.readFileSync(PATHS.script, "utf-8");
  const subtitles = parseScriptToSubtitles(scriptText);
  if (subtitles.length === 0) {
    throw new Error(
      "script.txt からタイミング情報を読み取れませんでした。\n" +
        "フォーマット例: [フック: 0〜3秒]"
    );
  }
  console.log(`  字幕セクション: ${subtitles.map((s) => s.label).join(" → ")}`);

  // ---- 音声ファイルを public/ にコピー（Remotionが参照できる場所） ----
  const publicDir = path.join(ROOT, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(PATHS.audio, path.join(publicDir, "narration.mp3"));
  console.log("  ✓ narration.mp3 → public/");

  const hasBgm = fs.existsSync(PATHS.bgm);
  if (hasBgm) {
    fs.copyFileSync(PATHS.bgm, path.join(publicDir, "bgm.mp3"));
    console.log("  ✓ bgm.mp3 → public/");
  }

  // ---- 背景動画（stepBg で生成済みなら使用） ----
  const hasBackground = fs.existsSync(PATHS.background);
  if (hasBackground) {
    fs.copyFileSync(PATHS.background, path.join(publicDir, "background.mp4"));
    console.log("  ✓ background.mp4 → public/");
  }

  // ---- 効果音ファイルを public/sfx/ にコピー ----
  const sfxFiles = {};
  if (fs.existsSync(PATHS.sfxDir)) {
    const sfxPublic = path.join(publicDir, "sfx");
    fs.mkdirSync(sfxPublic, { recursive: true });
    for (const fname of ["whoosh.mp3", "chime.mp3"]) {
      const src = path.join(PATHS.sfxDir, fname);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(sfxPublic, fname));
        sfxFiles[fname.replace(".mp3", "")] = true;
        console.log(`  ✓ sfx/${fname} → public/sfx/`);
      }
    }
  }

  // ---- 音声の実長を取得してフレーズタイムラインを構築 ----
  const audioDuration = getAudioDuration(PATHS.audio);
  const durationInSeconds = Math.min(
    audioDuration,
    Math.max(...subtitles.map((s) => s.end))
  );

  // timing.json があればWhisperの精密タイミングを優先する
  let phrases;
  if (fs.existsSync(PATHS.timing)) {
    console.log("  Whisperタイミングを使用します (timing.json)");
    const timingData = readJson(PATHS.timing);
    const hookEnd = subtitles.find((s) => s.label === "フック")?.end ?? 3;
    phrases = timingData.phrases.map((p) => ({
      ...p,
      isHook: p.end <= hookEnd,
    }));
  } else {
    console.log("  推定タイミングを使用します（精度向上には --step=whisper を実行）");
    phrases = buildPhraseTimeline(subtitles, durationInSeconds);
  }
  console.log(`  フレーズ総数: ${phrases.length}`);

  // ---- 締めセクションの開始フレームを計算（効果音用） ----
  const endingSec = subtitles.find((s) => s.label === "締め")?.start ?? 50;

  // ---- explanation.json から図説データを取得 ----
  let diagrams = [];
  if (fs.existsSync(PATHS.explanation)) {
    try {
      const exp = readJson(PATHS.explanation);
      diagrams = exp.diagrams ?? [];
      if (diagrams.length > 0) {
        console.log(`  図説: ${diagrams.length} 件 (${diagrams.map((d) => `${d.timing}秒`).join(", ")})`);
      }
    } catch { /* explanation.json が壊れていても続行 */ }
  }

  // ---- props をファイルに書き出す（Windowsでの引数エスケープ問題を回避） ----
  const props = { phrases, hasBackground, hasBgm, durationInSeconds, sfxFiles, endingSec, diagrams };
  const propsFile = path.join(os.tmpdir(), `remotion_props_${Date.now()}.json`);
  fs.writeFileSync(propsFile, JSON.stringify(props), "utf-8");

  ensureDir(PATHS.video);

  await withRetry(
    () => {
      execSync(
        `npx remotion render src/index.jsx VideoComposition` +
          ` ${JSON.stringify(PATHS.video)}` +
          ` --props=${JSON.stringify(propsFile)}`,
        { cwd: ROOT, stdio: "inherit" }
      );
    },
    3,
    "step5"
  );

  try { fs.unlinkSync(propsFile); } catch { /* ignore */ }

  console.log(`✓ final.mp4 を保存しました: ${PATHS.video}`);
  return PATHS.video;
}

// ---- 背景動画・字幕タイムライン用ヘルパー ----

/**
 * ffprobe で音声ファイルの長さ（秒）を取得する。
 * ffprobe が使えない場合は 60 秒を返す。
 */
function getAudioDuration(audioPath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${audioPath}"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const data = JSON.parse(out);
    const stream = data.streams?.find((s) => s.codec_type === "audio");
    const dur = parseFloat(stream?.duration ?? "0");
    return dur > 0 ? dur : 60;
  } catch {
    console.warn("  ⚠ ffprobe で音声長を取得できませんでした（60秒で代用）");
    return 60;
  }
}

/**
 * 日本語テキストを文節単位で短いフレーズに分割する。
 * 分割条件（優先順）:
 *   1. 句読点（。、！？…\n）→ 必ず区切る
 *   2. 助詞（は が を に で と も の）の直後 かつ バッファ4字以上
 *   3. maxChars に達した場合
 */
function splitIntoPhrases(text, maxChars = 15) {
  if (!text) return [];
  const PUNCT    = new Set([..."。、！？…\n"]);
  const PARTICLES = new Set([..."はがをにでともの"]);
  const result = [];
  let buf = "";

  for (const char of text) {
    buf += char;
    const isPunct    = PUNCT.has(char);
    const isParticle = PARTICLES.has(char) && buf.length >= 4;
    const isFull     = buf.length >= maxChars;

    if (isPunct || isParticle || isFull) {
      const chunk = buf.trim();
      if (chunk) result.push(chunk);
      buf = "";
    }
  }
  if (buf.trim()) result.push(buf.trim());
  return result.filter(Boolean);
}

/**
 * 字幕セクション配列をフレーズごとのタイムラインに変換する。
 * audioDuration: 実際の音声長（秒）。超えないようにカットする。
 */
function buildPhraseTimeline(subtitles, audioDuration) {
  const timeline = [];
  for (const sub of subtitles) {
    const secEnd = Math.min(sub.end, audioDuration);
    const secDur = secEnd - sub.start;
    if (secDur <= 0) continue;

    // フックは少し長めのフレーズでもOK（インパクト重視）
    const maxChars = sub.label === "フック" ? 15 : 15;
    const chunks = splitIntoPhrases(sub.text, maxChars);
    if (chunks.length === 0) continue;

    const timePerPhrase = secDur / chunks.length;
    chunks.forEach((text, i) => {
      timeline.push({
        text,
        start: sub.start + i * timePerPhrase,
        end:   sub.start + (i + 1) * timePerPhrase,
        isHook: sub.label === "フック",
      });
    });
  }
  return timeline;
}

// ---- JSON 抽出ヘルパー ----
function extractJson(text) {
  // ```json ... ``` ブロックを取り除く
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  // そのまま返す
  return text.trim();
}

// ---- CLI エントリーポイント ----

async function main() {
  const args = process.argv.slice(2);
  const stepArg = args.find((a) => a.startsWith("--step="));
  const stepStr = stepArg ? stepArg.split("=")[1] : null;
  // "bg" / "whisper" / "sfx" は文字列のまま、数字は整数に変換
  const targetStep = stepStr
    ? /^\d+$/.test(stepStr) ? parseInt(stepStr, 10) : stepStr
    : null;

  const steps = [
    { num: 1,         fn: step1_fetchCandidates,       name: "海外動画収集" },
    { num: 2,         fn: step2_generateExplanation,   name: "深掘り解説生成" },
    { num: 3,         fn: step3_generateScript,        name: "台本生成" },
    { num: 4,         fn: step4_generateAudio,         name: "音声生成" },
    { num: "whisper", fn: stepWhisper_alignAudio,      name: "音声タイミング解析" },
    { num: "bg",      fn: stepBg_fetchBackgroundVideo, name: "背景動画生成" },
    { num: "sfx",     fn: stepSfx_fetchSoundEffects,   name: "効果音取得" },
    { num: "bgm",     fn: stepBgm_fetchBGM,            name: "BGM取得" },
    { num: 5,         fn: step5_renderVideo,           name: "動画レンダリング" },
  ];

  const stepsToRun = targetStep !== null
    ? steps.filter((s) => s.num === targetStep)
    : steps;

  if (stepsToRun.length === 0) {
    console.error(
      `ステップ "${targetStep}" は存在しません。\n` +
      `有効な値: 1, 2, 3, 4, whisper, bg, sfx, bgm, 5`
    );
    process.exit(1);
  }

  console.log("🎬 YouTube Shorts 自動生成パイプライン 開始");
  console.log(
    `実行ステップ: ${stepsToRun.map((s) => `${s.num}(${s.name})`).join(" → ")}\n`
  );

  for (const step of stepsToRun) {
    try {
      await step.fn();
    } catch (err) {
      console.error(`\n❌ ステップ${step.num} で致命的エラーが発生しました。`);
      console.error(err.message);
      logError(`step${step.num}`, err.stack || err.message);
      console.error(
        `エラー詳細は output/error_log.txt を確認してください。`
      );
      process.exit(1);
    }
  }

  console.log("\n✅ パイプライン完了！");
  if (targetStep === null || targetStep === 5) {
    if (fs.existsSync(PATHS.video)) {
      console.log(`動画ファイル: ${PATHS.video}`);
    }
  }
  if (targetStep === null || targetStep === "bg") {
    if (fs.existsSync(PATHS.background)) {
      console.log(`背景動画: ${PATHS.background}`);
    }
  }
}

main();
