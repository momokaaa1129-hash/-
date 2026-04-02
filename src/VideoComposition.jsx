import {
  AbsoluteFill,
  Audio,
  Video,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

// ---- 定数 ----
const SAFE_ZONE_RATIO = 0.15; // 上下15%のセーフゾーン
const FONT_FAMILY =
  '"Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif';

// ---- メインコンポーネント ----
// props（pipeline.js の step5 から渡される）:
//   phrases         ... [{text, start, end, isHook}]
//   hasBackground   ... background.mp4 があれば true
//   hasBgm          ... bgm.mp3 があれば true
//   durationInSeconds ... 動画の秒数

export const VideoComposition = ({
  phrases,
  hasBackground,
  hasBgm,
  durationInSeconds,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const currentTime = frame / fps;
  const safeY = height * SAFE_ZONE_RATIO; // = 288px

  // 現在表示するフレーズを探す
  const allPhrases = phrases ?? [];
  const currentIdx = allPhrases.findIndex(
    (p) => currentTime >= p.start && currentTime < p.end
  );
  const currentPhrase = currentIdx >= 0 ? allPhrases[currentIdx] : null;
  const isHook = currentPhrase?.isHook ?? false;

  // フレーズの先頭フレームからのローカルフレーム数（アニメーション計算用）
  const phraseStartFrame = currentPhrase
    ? Math.round(currentPhrase.start * fps)
    : 0;
  const phraseDurFrames = currentPhrase
    ? Math.max(2, Math.round((currentPhrase.end - currentPhrase.start) * fps))
    : 1;
  const localFrame = frame - phraseStartFrame;

  // ---- フェードイン・アウト ----
  const FADE = 4; // フェードのフレーム数
  const opacity = currentPhrase
    ? interpolate(
        localFrame,
        [0, FADE, phraseDurFrames - FADE, phraseDurFrames],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : 0;

  // ---- スケールアニメーション（フレーズ切り替わり時に少し拡大→通常サイズ） ----
  const scale = currentPhrase
    ? interpolate(localFrame, [0, FADE], [isHook ? 1.12 : 0.90, 1.0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  // フック: 大きなフォント・画面中央  /  それ以外: やや小さめ・中央より下
  const fontSize = isHook ? 92 : 56;
  const overlayAlpha = isHook ? 0.72 : 0.45;

  return (
    <AbsoluteFill>
      {/* ── 背景 ── */}
      {hasBackground ? (
        <AbsoluteFill>
          <Video
            src={staticFile("background.mp4")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            muted
            loop
          />
        </AbsoluteFill>
      ) : (
        /* 背景動画がない場合のフォールバックグラデーション */
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, #1a1a3e 0%, #0a0a14 60%, #000 100%)",
          }}
        />
      )}

      {/* ── 暗いオーバーレイ（背景動画の上に乗せて文字を読みやすくする） ── */}
      <AbsoluteFill
        style={{ backgroundColor: `rgba(0,0,0,${overlayAlpha})` }}
      />

      {/* ── ナレーション音声 ── */}
      <Audio src={staticFile("narration.mp3")} />

      {/* ── BGM（音量18%） ── */}
      {hasBgm && <Audio src={staticFile("bgm.mp3")} volume={0.18} />}

      {/* ── フレーズ字幕 ── */}
      {currentPhrase && (
        <AbsoluteFill
          style={{
            // フック = 画面中央、それ以外 = 下寄り（セーフゾーン内）
            justifyContent: isHook ? "center" : "flex-end",
            alignItems: "center",
            paddingBottom: isHook ? 0 : safeY + 40,
            paddingLeft: 40,
            paddingRight: 40,
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              opacity,
              textAlign: "center",
              // フックのみ半透明背景で囲む
              ...(isHook
                ? {
                    background: "rgba(0,0,0,0.3)",
                    borderRadius: 24,
                    padding: "24px 48px",
                  }
                : {}),
            }}
          >
            <span
              style={{
                display: "block",
                color: "#ffffff",
                fontSize,
                fontWeight: 900,
                fontFamily: FONT_FAMILY,
                lineHeight: 1.45,
                letterSpacing: "0.04em",
                // 黒い縁取り（4方向のtextShadow）
                textShadow: [
                  "-3px -3px 0 #000",
                  " 3px -3px 0 #000",
                  "-3px  3px 0 #000",
                  " 3px  3px 0 #000",
                  "0 0 24px rgba(0,0,0,0.9)",
                ].join(", "),
              }}
            >
              {currentPhrase.text}
            </span>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
