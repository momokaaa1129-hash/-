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
        phrases: [],          // [{text, start, end, isHook}] フレーズタイムライン
        hasBackground: false, // background.mp4 があれば true
        hasBgm: false,        // bgm.mp3 があれば true
        durationInSeconds: 60,
        sfxFiles: {},         // {whoosh: bool, chime: bool}
        endingSec: 50,        // 締めセクション開始秒
      }}
    />
  );
};

registerRoot(RemotionRoot);
