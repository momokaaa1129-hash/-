# 🎬 ショート動画自動生成パイプライン
## このプロジェクトの目的
YouTube Shorts向けに「面白い実験を解説する知識系動画」を自動生成する。
フェニックスの口調で台本を生成し、音声・字幕・動画まで自動で仕上げる。
---
## ディレクトリ構成
```
project/
├── CLAUDE.md            # この指示ファイル
├── style_guide.md       # 口調スタイルガイド（必ず参照）
├── scripts/
│   └── pipeline.js      # メインパイプライン
├── output/
│   ├── scripts/         # 生成された台本テキスト
│   ├── audio/           # ElevenLabsで生成した音声
│   └── videos/          # 最終動画
└── .env                 # APIキー（Gemini・ElevenLabs）
```
---
## パイプラインの実行手順
### ステップ1：実験テーマの取得
Gemini 2.5 Flash（Thinkingモード）を使い、以下を自動実行する：
- Google検索で「最近バズった面白い科学実験」を3件リストアップ
- 条件：視覚的に驚ける、60秒以内で説明できる、中学生でも理解できる
- 結果を `output/scripts/candidates.json` に保存する
### ステップ2：実験の深掘り解説生成
Gemini 2.5 Pro（Thinkingモード）を使い、以下を実行する：
- candidates.json の中から最もバズりそうな1件を選ぶ
- 科学的根拠・日常との繋がり・豆知識・よくある誤解を生成する
- 結果を `output/scripts/explanation.json` に保存する
### ステップ3：台本の自動生成
`style_guide.md` を**必ず最初に読み込んでから**、以下を実行する：
- explanation.json をもとに、60秒YouTube Shorts用の台本を生成する
- フォーマット：フック（0〜3秒）→ 紹介（3〜15秒）→ 解説（15〜50秒）→ 締め（50〜60秒）
- スタイルガイドの口調・テンポ・禁止表現を**厳守**する
- 生成した台本を `output/scripts/script.txt` に保存する
### ステップ4：ナレーション音声の生成
ElevenLabs APIを使い、以下を実行する：
- `output/scripts/script.txt` の内容を音声に変換する
- 言語：日本語
- 使用ボイスID：`.env` の `ELEVENLABS_VOICE_ID` を参照する
- 出力先：`output/audio/narration.mp3`
### ステップ5：動画のレンダリング
Remotionを使い、以下を実行する：
- フォーマット：縦型 9:16（1080×1920px）、60秒以内
- 構成：
  - フック部分：大きなテキストをアニメーションで表示
  - 解説部分：字幕を音声に合わせて自動表示
  - 全体：BGM（output/assets/bgm.mp3 があれば使用）
- YouTube Shortsのセーフゾーン（上下15%）を必ず守る
- 出力先：`output/videos/final.mp4`
---
## APIキーの設定方法
`.env` ファイルに以下を記入する（ファイルはすでに存在する想定）：
```
GEMINI_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here
```
---
## エラー時のルール
- APIが失敗したら3回リトライする
- 3回失敗したらエラー内容を `output/error_log.txt` に書き出して止まる
- 絶対に情報を捏造・補完しない。不明な場合は「取得失敗」と記録する
---
## 実行コマンド（ユーザー向け）
パイプライン全体を一発で走らせるには以下を実行：
```
node scripts/pipeline.js
```
ステップ単体で走らせることもできる：
```
node scripts/pipeline.js --step=1   # 実験候補取得のみ
node scripts/pipeline.js --step=3   # 台本生成のみ
node scripts/pipeline.js --step=4   # 音声生成のみ
```
