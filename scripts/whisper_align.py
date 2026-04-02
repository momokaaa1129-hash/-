#!/usr/bin/env python3
"""
Whisper音声アライメント

output/audio/narration.mp3 を解析してフレーズタイミングデータを生成します。
生成結果は output/scripts/timing.json に保存されます。

使い方:
  pip install faster-whisper
  python scripts/whisper_align.py
"""

import json
import sys
from pathlib import Path

# ---- 設定 ----
MODEL_SIZE = "small"   # "tiny" / "small" / "medium" / "large-v3"
MAX_CHARS  = 10        # 1フレーズの最大文字数
SPLIT_CHARS = set("。、！？…\n")  # フレーズ区切り文字


def load_model():
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("[ERROR] faster-whisper が未インストールです。", file=sys.stderr)
        print("  pip install faster-whisper", file=sys.stderr)
        sys.exit(1)

    print(f"  Whisperモデルを読み込み中 ({MODEL_SIZE} / CPU)...", flush=True)
    return WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")


def transcribe(model, audio_path: Path):
    print(f"  音声を解析中: {audio_path.name} ...", flush=True)
    segments_gen, info = model.transcribe(
        str(audio_path),
        language="ja",
        word_timestamps=True,
        beam_size=5,
        vad_filter=True,            # 無音区間をスキップして精度向上
        vad_parameters={"min_silence_duration_ms": 300},
    )
    return segments_gen, info


def group_into_phrases(segments_gen):
    """単語タイムスタンプを 5〜MAX_CHARS 文字のフレーズにまとめる"""
    words = []
    for seg in segments_gen:
        if not seg.words:
            continue
        for w in seg.words:
            word = w.word.strip()
            if word:
                words.append({
                    "word":  word,
                    "start": round(w.start, 3),
                    "end":   round(w.end,   3),
                })

    if not words:
        return []

    phrases = []
    buf_text  = ""
    buf_start = None
    buf_end   = None

    for w in words:
        if buf_start is None:
            buf_start = w["start"]
        buf_text += w["word"]
        buf_end   = w["end"]

        # 区切り文字が含まれるか、最大文字数に達したら分割
        should_split = (
            len(buf_text) >= MAX_CHARS
            or any(c in buf_text for c in SPLIT_CHARS)
        )
        if should_split:
            phrases.append({
                "text":  buf_text.strip(),
                "start": buf_start,
                "end":   buf_end,
            })
            buf_text  = ""
            buf_start = None
            buf_end   = None

    # 末尾の残りを追加
    if buf_text.strip():
        phrases.append({
            "text":  buf_text.strip(),
            "start": buf_start,
            "end":   buf_end,
        })

    return phrases


def main():
    root        = Path(__file__).parent.parent
    audio_path  = root / "output" / "audio"   / "narration.mp3"
    timing_path = root / "output" / "scripts" / "timing.json"

    if not audio_path.exists():
        print(f"[ERROR] {audio_path} が見つかりません。先にステップ4を実行してください。",
              file=sys.stderr)
        sys.exit(1)

    model = load_model()
    segments_gen, info = transcribe(model, audio_path)
    phrases = group_into_phrases(segments_gen)

    if not phrases:
        print("[ERROR] 音声から単語を検出できませんでした。", file=sys.stderr)
        sys.exit(1)

    timing_path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "phrases":    phrases,
        "language":   info.language,
        "phrase_count": len(phrases),
    }
    with open(timing_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  ✓ {len(phrases)} フレーズのタイミングを保存: {timing_path}", flush=True)


if __name__ == "__main__":
    main()
