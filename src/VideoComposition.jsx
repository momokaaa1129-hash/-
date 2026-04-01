import {
  AbsoluteFill,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";

// ---- 定数 ----
// セーフゾーン（上下15%）
const SAFE_ZONE_RATIO = 0.15;

// フォント（日本語対応・OSごとのフォールバック）
const FONT_FAMILY =
  '"Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif';

// ---- メインコンポーネント ----
// props:
//   subtitles      ... [{label, start, end, text}] の配列
//   hasBgm         ... BGMファイルがあればtrue
//   durationInSeconds ... 動画の秒数

export const VideoComposition = ({ subtitles, hasBgm, durationInSeconds }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const currentTime = frame / fps;
  const safeY = height * SAFE_ZONE_RATIO; // 上下セーフゾーン = 288px

  // 現在の時刻に対応する字幕を取得
  const currentSub = (subtitles ?? []).find(
    (s) => currentTime >= s.start && currentTime < s.end
  );

  const isHook = currentSub?.label === "フック";

  return (
    <AbsoluteFill>
      {/* 背景グラデーション */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, #1a1a3e 0%, #0a0a14 60%, #000 100%)",
        }}
      />

      {/* ナレーション音声（フルタイム再生） */}
      <Audio src={staticFile("narration.mp3")} />

      {/* BGM（存在する場合のみ・音量20%） */}
      {hasBgm && (
        <Audio src={staticFile("bgm.mp3")} volume={0.2} />
      )}

      {/* セーフゾーンガイド用ラッパー（上下15%内側に収める） */}
      <AbsoluteFill
        style={{
          paddingTop: safeY,
          paddingBottom: safeY,
          paddingLeft: 40,
          paddingRight: 40,
        }}
      >
        {/* フック（0〜3秒）：画面中央に大きく表示してスケールイン */}
        {isHook && (
          <HookText frame={frame} fps={fps} text={currentSub.text} />
        )}

        {/* 紹介・解説・締め：画面下部に字幕バーとして表示 */}
        {!isHook && currentSub && (
          <SubtitleBar
            frame={frame}
            fps={fps}
            text={currentSub.text}
            label={currentSub.label}
          />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- フックテキスト（中央・大きく・スケールイン） ----
const HookText = ({ frame, fps, text }) => {
  // 0フレームから springアニメーションでスケールイン
  const scale = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
    from: 0.6,
    to: 1,
  });

  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          color: "#ffffff",
          fontSize: 88,
          fontWeight: 900,
          fontFamily: FONT_FAMILY,
          textAlign: "center",
          lineHeight: 1.35,
          letterSpacing: "0.02em",
          transform: `scale(${scale})`,
          opacity,
          textShadow: "0 0 40px rgba(100, 140, 255, 0.6), 0 4px 16px rgba(0,0,0,0.9)",
          // テキストに縁取り（白文字 + 黒縁）
          WebkitTextStroke: "2px rgba(0,0,0,0.4)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// ---- 字幕バー（画面下部） ----
const SubtitleBar = ({ frame, fps, text, label }) => {
  // セクションが切り替わるたびにフェードイン
  // frame=0 から数えているわけではないので、
  // セクション開始からのローカルフレームはpropsで渡さず、
  // 簡易的にグローバルフレームで代用する（短いフェードで十分）
  const opacity = interpolate(frame % (fps * 3), [0, 8], [0.6, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  // 締めのみ少し大きめにして印象を変える
  const isEnding = label === "締め";
  const fontSize = isEnding ? 56 : 50;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
      }}
    >
      <div
        style={{
          opacity,
          backgroundColor: "rgba(0, 0, 0, 0.72)",
          borderRadius: 20,
          padding: "22px 44px",
          maxWidth: "100%",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <p
          style={{
            color: "#ffffff",
            fontSize,
            fontWeight: 700,
            fontFamily: FONT_FAMILY,
            textAlign: "center",
            lineHeight: 1.6,
            letterSpacing: "0.03em",
            margin: 0,
            textShadow: "0 2px 8px rgba(0,0,0,0.8)",
          }}
        >
          {text}
        </p>
      </div>
    </AbsoluteFill>
  );
};
