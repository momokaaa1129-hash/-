import { Config } from "@remotion/cli/config";

// 出力フォーマット設定
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);

// 既存ファイルを上書きする
Config.setOverwriteOutput(true);
