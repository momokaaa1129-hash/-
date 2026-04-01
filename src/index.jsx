import { Composition, registerRoot } from "remotion";
import { VideoComposition } from "./VideoComposition";

// ---- Remotionのルート ----
// ここで動画の基本仕様（解像度・FPS・長さ）を登録します。
// 実際の長さは --props で渡す durationInSeconds で上書きされます。

const RemotionRoot = () => {
  return (
    <Composition
      id="VideoComposition"
      component={VideoComposition}
      fps={30}
      width={1080}
      height={1920}
      // calculateMetadata を使い、propsのdurationInSecondsから実際のフレーム数を計算
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round((props.durationInSeconds ?? 60) * 30),
      })}
      defaultProps={{
        subtitles: [],   // [{label, start, end, text}] の配列
        hasBgm: false,   // BGMファイルがあればtrue
        durationInSeconds: 60,
      }}
    />
  );
};

registerRoot(RemotionRoot);
