# Android 离线 OCR 模型

DailyNote 的图片文字识别使用 Google ML Kit 中文文字识别：

```gradle
implementation 'com.google.mlkit:text-recognition-chinese:16.0.1'
```

## 模型在哪里

模型不是一个放在 `public/` 或 `assets/` 下的独立文件，而是在 ML Kit AAR 内：

```text
assets/mlkit-google-ocr-models/
  gocr/gocr_models/...
  taser/...
```

Gradle 解析依赖后，会把 AAR 里的模型资源合并进 APK。安装后识别完全离线，不下载模型、不调用云端接口。

## 构建时是否要额外拷贝

不需要。`android/app/build.gradle` 已经声明依赖；`npm run build:apk` 或 `bash scripts/build-apk.sh` 会自动解析并打包。

首次构建需要联网下载 Gradle 依赖。若要在完全离线的机器上构建，请提前把 Gradle 依赖缓存准备好；仓库不直接提交 AAR，避免二进制膨胀和第三方再分发问题。

## 验证模型是否进包

构建后检查 APK：

```bash
unzip -l android/app/build/outputs/apk/debug/app-debug.apk | grep mlkit-google-ocr-models
```

应能看到 `assets/mlkit-google-ocr-models/` 下的模型文件。

## 相关代码

- `android/app/src/main/java/com/dailynote/app/MlkitOcrPlugin.java`
- `src/services/ocr.ts`
- `android/app/build.gradle`
