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

// ---- 図説オーバーレイ ----
// diagram: { timing, duration, type, steps: [{text, arrow?}] }
// 背景を暗くし、3ステップが左からフェードインで順番に登場する。
const DiagramOverlay = ({ diagram, fps, frame }) => {
  const startFrame  = Math.round(diagram.timing * fps);
  const totalFrames = Math.max(2, Math.round(diagram.duration * fps));
  const localFrame  = frame - startFrame;

  if (localFrame < 0 || localFrame >= totalFrames) return null;

  const steps = diagram.steps ?? [];

  // オーバーレイ全体のフェードイン・アウト
  const FADE = 8;
  const canFade = totalFrames > FADE * 2;
  const overlayOpacity = canFade
    ? interpolate(
        localFrame,
        [0, FADE, totalFrames - FADE, totalFrames],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : 1;

  // ステップは全体の前半 60% で順番に表示
  const revealWindow = totalFrames * 0.6;
  const framesPerStep = steps.length > 1 ? revealWindow / steps.length : revealWindow;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "rgba(0,0,0,0.88)",
        opacity: overlayOpacity,
        justifyContent: "center",
        alignItems: "center",
        paddingLeft: 56,
        paddingRight: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          gap: 0,
        }}
      >
        {steps.map((step, i) => {
          const stepStart = Math.round(framesPerStep * i);
          const STEP_FADE = Math.min(10, Math.max(2, Math.round(framesPerStep * 0.5)));
          const stepOpacity = interpolate(
            localFrame,
            [stepStart, Math.min(stepStart + STEP_FADE, totalFrames - 1)],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const stepX = interpolate(
            localFrame,
            [stepStart, Math.min(stepStart + STEP_FADE, totalFrames - 1)],
            [-50, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
              }}
            >
              {/* ステップボックス */}
              <div
                style={{
                  opacity: stepOpacity,
                  transform: `translateX(${stepX}px)`,
                  backgroundColor: "rgba(79,195,247,0.15)",
                  border: "3px solid rgba(79,195,247,0.7)",
                  borderLeft: "8px solid #4fc3f7",
                  borderRadius: 16,
                  paddingTop: 22,
                  paddingBottom: 22,
                  paddingLeft: 36,
                  paddingRight: 36,
                  width: "100%",
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    display: "block",
                    color: "#ffffff",
                    fontSize: 72,
                    fontWeight: 900,
                    fontFamily: FONT_FAMILY,
                    lineHeight: 1.3,
                    letterSpacing: "0.04em",
                    textShadow: "0 2px 16px rgba(0,0,0,0.9)",
                  }}
                >
                  {step.text}
                </span>
              </div>

              {/* 矢印（次のステップへ） */}
              {step.arrow && i < steps.length - 1 && (
                <div
                  style={{
                    opacity: stepOpacity,
                    color: "#4fc3f7",
                    fontSize: 64,
                    fontWeight: 900,
                    lineHeight: 1,
                    marginTop: 6,
                    marginBottom: 6,
                    textShadow: "0 0 20px rgba(79,195,247,0.6)",
                  }}
                >
                  ↓
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---- メインコンポーネント ----
// props（pipeline.js step5 から渡される）:
//   phrases         [{text, start, end, isHook}]
//   hasBackground   background.mp4 があれば true
//   hasBgm          bgm.mp3 があれば true
//   durationInSeconds
//   sfxFiles        {whoosh: bool, chime: bool}
//   endingSec       締めセクション開始秒
//   diagrams        [{timing, duration, type, steps}]

export const VideoComposition = ({
  phrases,
  hasBackground,
  hasBgm,
  durationInSeconds,
  sfxFiles = {},
  endingSec = 50,
  diagrams = [],
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

  // 現在表示すべき図説を探す
  const allDiagrams = diagrams ?? [];
  const currentDiagram = allDiagrams.find(
    (d) => currentTime >= d.timing && currentTime < d.timing + d.duration
  ) ?? null;

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
  const fontSize     = isHook ? 120 : 90;
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

      {/* ── 通常オーバーレイ（図説中は DiagramOverlay が上書き） ── */}
      {!currentDiagram && (
        <AbsoluteFill
          style={{ backgroundColor: `rgba(0,0,0,${overlayAlpha})` }}
        />
      )}

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

      {/* ── 図説オーバーレイ（解説パート途中に挿入） ── */}
      {allDiagrams.map((diagram, i) => (
        <DiagramOverlay key={i} diagram={diagram} fps={fps} frame={frame} />
      ))}

      {/* ── 字幕エリア（図説表示中は非表示） ── */}
      {currentPhrase && !currentDiagram && (
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
