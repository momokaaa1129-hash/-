import {
  AbsoluteFill,
  Audio,
  Video,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

// ---- 定数 ----
const SAFE_ZONE_RATIO = 0.15; // 上下15% = 288px
const FONT_FAMILY =
  '"Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif';

// ---- メインコンポーネント ----
// props（pipeline.js step5 から渡される）:
//   phrases         [{text, start, end, isHook}]
//   hasBackground   background.mp4 があれば true
//   hasBgm          bgm.mp3 があれば true
//   durationInSeconds
//   sfxFiles        {whoosh: bool, chime: bool}
//   endingSec       締めセクション開始秒

export const VideoComposition = ({
  phrases,
  hasBackground,
  hasBgm,
  durationInSeconds,
  sfxFiles = {},
  endingSec = 50,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const currentTime = frame / fps;
  const safeY = height * SAFE_ZONE_RATIO; // 288px

  // 現在のフレーズを探す
  const allPhrases = phrases ?? [];
  const currentIdx = allPhrases.findIndex(
    (p) => currentTime >= p.start && currentTime < p.end
  );
  const currentPhrase = currentIdx >= 0 ? allPhrases[currentIdx] : null;
  const isHook = currentPhrase?.isHook ?? false;

  // フレーズ内のローカルフレーム（アニメーション用）
  const phraseStartFrame = currentPhrase
    ? Math.round(currentPhrase.start * fps)
    : 0;
  const phraseDurFrames = currentPhrase
    ? Math.max(2, Math.round((currentPhrase.end - currentPhrase.start) * fps))
    : 1;
  const localFrame = frame - phraseStartFrame;

  // ---- フェードイン・アウト ----
  const FADE = 4;
  const canFade  = phraseDurFrames > FADE * 2;
  const canScale = phraseDurFrames > FADE;

  const opacity = currentPhrase
    ? canFade
      ? interpolate(
          localFrame,
          [0, FADE, phraseDurFrames - FADE, phraseDurFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        )
      : 1
    : 0;

  // ---- スケールアニメーション ----
  const scale = currentPhrase && canScale
    ? interpolate(localFrame, [0, FADE], [isHook ? 1.1 : 0.88, 1.0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  // ---- フォントサイズ・オーバーレイ ----
  const fontSize    = isHook ? 120 : 90;   // 改善2: 拡大
  const overlayAlpha = isHook ? 0.70 : 0.42;

  // 締めセクション開始フレーム（効果音用）
  const endingFrame = Math.round(endingSec * fps);

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
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, #1a1a3e 0%, #0a0a14 60%, #000 100%)",
          }}
        />
      )}

      {/* ── 暗いオーバーレイ ── */}
      <AbsoluteFill
        style={{ backgroundColor: `rgba(0,0,0,${overlayAlpha})` }}
      />

      {/* ── ナレーション ── */}
      <Audio src={staticFile("narration.mp3")} />

      {/* ── BGM ── */}
      {hasBgm && <Audio src={staticFile("bgm.mp3")} volume={0.18} />}

      {/* ── 効果音: フック開始時 whoosh ── */}
      {sfxFiles.whoosh && (
        <Sequence from={0} durationInFrames={fps * 2}>
          <Audio src={staticFile("sfx/whoosh.mp3")} volume={0.45} />
        </Sequence>
      )}

      {/* ── 効果音: 締め開始時 chime ── */}
      {sfxFiles.chime && endingFrame > 0 && (
        <Sequence from={endingFrame} durationInFrames={fps * 4}>
          <Audio src={staticFile("sfx/chime.mp3")} volume={0.35} />
        </Sequence>
      )}

      {/* ── 字幕エリア ── */}
      {currentPhrase && (
        <AbsoluteFill
          style={{
            justifyContent: isHook ? "center" : "flex-end",
            alignItems: "center",
            paddingBottom: isHook ? 0 : safeY + 30,
            paddingLeft: 36,
            paddingRight: 36,
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              opacity,
              textAlign: "center",
              // 改善2: 半透明の黒帯（視認性向上）
              backgroundColor: isHook
                ? "rgba(0,0,0,0.35)"
                : "rgba(0,0,0,0.55)",
              borderRadius: isHook ? 20 : 14,
              paddingTop:    isHook ? 28 : 18,
              paddingBottom: isHook ? 28 : 18,
              paddingLeft:   isHook ? 52 : 36,
              paddingRight:  isHook ? 52 : 36,
              maxWidth: "100%",
            }}
          >
            <span
              style={{
                display: "block",
                color: "#ffffff",
                fontSize,
                fontWeight: 900,
                fontFamily: FONT_FAMILY,
                lineHeight: 1.4,
                letterSpacing: "0.05em",
                // 改善2: 太い黒縁取り（4方向 + ぼかし）
                textShadow: [
                  "-4px -4px 0 #000",
                  " 4px -4px 0 #000",
                  "-4px  4px 0 #000",
                  " 4px  4px 0 #000",
                  "-2px  0   0 #000",
                  " 2px  0   0 #000",
                  " 0   -2px 0 #000",
                  " 0    2px 0 #000",
                  "0 0 20px rgba(0,0,0,0.95)",
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
