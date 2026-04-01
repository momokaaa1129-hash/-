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
  styleGuide: path.join(ROOT, "style_guide.md"),
  candidates: path.join(ROOT, "output", "scripts", "candidates.json"),
  explanation: path.join(ROOT, "output", "scripts", "explanation.json"),
  script: path.join(ROOT, "output", "scripts", "script.txt"),
  audio: path.join(ROOT, "output", "audio", "narration.mp3"),
  video: path.join(ROOT, "output", "videos", "final.mp4"),
  bgm: path.join(ROOT, "output", "assets", "bgm.mp3"),
  errorLog: path.join(ROOT, "output", "error_log.txt"),
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
 * ステップ1: 面白い科学実験の候補を3件取得し candidates.json に保存
 */
async function step1_fetchCandidates() {
  console.log("\n=== ステップ1: 実験テーマの取得 ===");

  const prompt = `
あなたはYouTube Shortsのコンテンツリサーチャーです。
「最近バズった面白い科学実験」を3件リストアップしてください。

条件:
- 視覚的に驚ける（映像映えする）
- 60秒以内で説明できる
- 中学生でも理解できる

出力形式（JSON のみ。コードブロック不要）:
{
  "candidates": [
    {
      "id": 1,
      "title": "実験のタイトル（日本語）",
      "description": "どんな実験か1〜2文で説明",
      "keywords": ["キーワード1", "キーワード2"],
      "buzz_reason": "なぜバズりやすいか1文で"
    },
    ...
  ],
  "retrieved_at": "ISO8601形式の日時"
}
`;

  const rawText = await withRetry(
    () => Promise.resolve(callGemini({ model: "gemini-2.0-flash-thinking-exp", prompt })),
    3,
    "step1"
  );

  // JSON 部分だけ抽出（コードブロックで囲まれている場合を考慮）
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

  if (!data.retrieved_at) {
    data.retrieved_at = new Date().toISOString();
  }

  writeJson(PATHS.candidates, data);
  console.log(`✓ candidates.json に ${data.candidates.length} 件保存しました`);
  data.candidates.forEach((c) => console.log(`  - ${c.title}`));
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
以下は科学実験の候補リストです。

${JSON.stringify(candidates, null, 2)}

この中から YouTube Shorts で最もバズりそうな実験を1件選び、
以下の構造の JSON を出力してください（コードブロック不要）:

{
  "selected": {
    "id": <候補のid>,
    "title": "<タイトル>",
    "reason_selected": "<選んだ理由（1文）>"
  },
  "explanation": {
    "scientific_basis": "<科学的根拠（2〜3文）>",
    "daily_connection": "<日常生活との繋がり（1〜2文）>",
    "trivia": "<豆知識（1〜2文）>",
    "common_misconception": "<よくある誤解（1〜2文）>"
  }
}
`;

  const rawText = await withRetry(
    () => Promise.resolve(callGemini({
        model: "gemini-2.5-pro-preview-03-25",
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

=== 解説素材 ===
${JSON.stringify(explanation, null, 2)}

=== 出力形式 ===
以下の4セクションを含む台本テキストのみ出力（JSON不要）:

[フック: 0〜3秒]
（30字以内の問いかけ or 驚き表現）

[紹介: 3〜15秒]
（実験名・概要、80字以内）

[解説: 15〜50秒]
（科学的仕組み・日常例・豆知識、200字以内）

[締め: 50〜60秒]
（日常への繋がり・知識の余韻、60字以内）

スタイルガイドの禁止表現を一切使わないこと。フェニックスの口調で書くこと。
`;

  const scriptText = await withRetry(
    () => Promise.resolve(callGemini({
        model: "gemini-2.5-pro-preview-03-25",
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
  const narrationText = scriptText
    .replace(/\[.+?\]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

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
 * script.txt のセクションヘッダーを解析して字幕データを返す。
 * 例: "[フック: 0〜3秒]\nテキスト" → [{label:"フック", start:0, end:3, text:"テキスト"}]
 */
function parseScriptToSubtitles(scriptText) {
  const subtitles = [];
  // [ラベル: 開始〜終了秒] にマッチ
  const headerRe = /\[([^:：]+)[：:]\s*(\d+)[〜~](\d+)秒\]/g;
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

  headers.forEach((h, i) => {
    const contentStart = h.index + h.length;
    const contentEnd =
      i + 1 < headers.length ? headers[i + 1].index : scriptText.length;
    const text = scriptText.slice(contentStart, contentEnd).trim();
    if (text) {
      subtitles.push({ label: h.label, start: h.start, end: h.end, text });
    }
  });

  return subtitles;
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

  // ---- 動画の長さ = 字幕の最終終了時刻 ----
  const durationInSeconds = Math.max(...subtitles.map((s) => s.end));

  // ---- props をファイルに書き出す（Windowsでの引数エスケープ問題を回避） ----
  const props = { subtitles, hasBgm, durationInSeconds };
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
  const targetStep = stepArg ? parseInt(stepArg.split("=")[1], 10) : null;

  const steps = [
    { num: 1, fn: step1_fetchCandidates, name: "実験テーマの取得" },
    { num: 2, fn: step2_generateExplanation, name: "深掘り解説生成" },
    { num: 3, fn: step3_generateScript, name: "台本生成" },
    { num: 4, fn: step4_generateAudio, name: "音声生成" },
    { num: 5, fn: step5_renderVideo, name: "動画レンダリング" },
  ];

  // 実行するステップを絞り込む
  const stepsToRun = targetStep
    ? steps.filter((s) => s.num === targetStep)
    : steps;

  if (stepsToRun.length === 0) {
    console.error(`ステップ ${targetStep} は存在しません（1〜5）`);
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
  if (!targetStep || targetStep === 5) {
    if (fs.existsSync(PATHS.video)) {
      console.log(`動画ファイル: ${PATHS.video}`);
    }
  }
}

main();
