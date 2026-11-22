# DailyNote

DailyNote 是一款本地优先的日程与笔记应用。它提供时间轴、TODO、长期目标、知识卡片、课表和截止事项。Web/PWA 与 Android 共用一套 React 和 TypeScript 源码。

## 本地开发

使用 Node.js 22 和 npm，安装依赖后启动开发服务器。

```sh
npm ci
npm run dev
```

运行 `npm test` 执行回归测试。`npm run build` 做类型检查并生成 Web 生产包，`npm run preview` 可预览构建结果。项目结构、路由和存储约定见 [structure.md](structure.md)。

## Android 构建

安装 JDK 21 和 Android SDK 36，设置 `JAVA_HOME`，并通过 `ANDROID_SDK_ROOT` 或 `android/local.properties` 指定 SDK。可以按 [SDK 路径模板](android/local.properties.example) 填写本机路径。

```sh
# Windows
npm run build:apk

# macOS / Linux
bash scripts/build-apk.sh
```

调试 APK 输出到 `android/app/build/outputs/apk/debug/dailynote.apk`。发布构建使用开发者自己的签名配置，Windows 运行 `npm run build:release`，macOS / Linux 运行 `bash scripts/build-apk.sh --release`。中文离线 OCR 由 ML Kit 提供，使用说明见 [MODELS.md](MODELS.md)。

## 数据与备份

- Android 默认保存到 `Documents/DailyNote/`，可以在应用内更改目录。
- Web 端数据保存在当前浏览器的 IndexedDB 中。清除站点数据前，可先通过应用导出备份。
- 两个平台可用 JSON 备份迁移数据。
