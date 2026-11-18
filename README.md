# DailyNote

本地优先的个人日程与复盘系统：计划、反思灵感、卡片、课程、截止事项和秘密花园，全部存在你自己的目录里，不联网、不要账号。

Web/PWA 与 Android APK 共用同一份代码，数据格式互通。

## 先读

- [structure.md](structure.md)：当前目录结构、存储模型和调用关系。
- [PROGRESS.md](PROGRESS.md)：按阶段压缩的开发史；最新改动在文末。
- [MODELS.md](MODELS.md)：Android 离线 OCR 小模型如何随 APK 打包。

## 环境

- Node.js 22 LTS（CI 使用 22）与 npm 10+
- TypeScript / Vite 由项目依赖提供，不需要全局安装
- Android：JDK 17、Android Studio 或 Android SDK，compileSdk / targetSdk 36
- **请使用 npm，不要用 pnpm。** 仓库提交的是 `package-lock.json`，`npm ci` 可复现依赖。

## Web 开发

```bash
npm ci
npm run dev       # Vite 开发服务器
npm test          # Vitest，54 个文件 / 829 个用例
npm run build     # 类型检查 + 生产构建，输出 dist/
npm run preview   # 预览生产构建
```

## Android 构建

首次构建前准备 SDK：

1. 安装 Android Studio，并在 SDK Manager 安装 Android 16 / API 36。
2. 复制 `android/local.properties.example` 为 `android/local.properties`，把 `sdk.dir` 改成你的 SDK 路径；或者用 Android Studio 打开 `android/` 让它自动生成。
3. 设置 `JAVA_HOME` 指向 JDK 17。命令行只依赖 `JAVA_HOME` / PATH，不再写死任何本机 JDK 路径。

```bash
# Windows
npm run build:apk

# macOS / Linux
bash scripts/build-apk.sh
```

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`

只做 Web 构建并同步到 Android、不跑 Gradle：

```bash
npm run build:android
```

### 签名

默认 debug 构建使用 Android 默认调试签名，可以直接安装。需要覆盖安装或发布时：

```bash
bash scripts/setup-keystore.sh
```

脚本会提示输入密码，生成 `android/daily-note-keystore.jks` 和 `android/keystore.properties`。两者都在 `.gitignore` 中，**不要提交，也不要发给别人**。CI 使用 `KEYSTORE_BASE64` / `KEYSTORE_PROPERTIES` Secrets，缺失时退回 debug 签名。

## 内置模型

Android 端的中文离线 OCR 使用 ML Kit：

```gradle
implementation 'com.google.mlkit:text-recognition-chinese:16.0.1'
```

模型资源在 AAR 的 `assets/mlkit-google-ocr-models/` 里，Gradle 构建时打进 APK，运行时不联网下载。源码包不需要额外的模型文件；首次构建需要联网解析 Gradle 依赖。详见 [MODELS.md](MODELS.md)。

## 数据与隐私

- 数据是普通 JSON 文件，默认在 `Documents/DailyNote/`，可在应用内更换目录。
- 没有账号、云同步或网络请求；换设备靠导出/导入或直接拷贝目录。
- 启动优先读本地快照；只有目录结构变化或手动「重新扫描存储目录」才全量读文件。
- 写入按表指纹增量落盘，只写变脏的文件。
- `dailynote-data.json` 是测试用样例数据，不是你的真实数据。

## 目录

```text
src/utils/       纯函数（时间网格、课程、DDL、搜索、卡片…）
src/db/          业务 CRUD（内存 store、卡片库）
src/services/    文件存储、启动快照、OCR 桥
src/hooks/       数据 Hook
src/components/  复用组件
src/pages/       页面
src/types/       类型与存储表定义
test/            Vitest 测试
android/         Capacitor Android 工程与原生插件
scripts/         构建、图标、签名脚本
```

## 已知限制

- 图片识别仅 Android 可用；Web 端会提示不可用。
- 直接改磁盘文件内容不会被自动发现，需要「重新扫描存储目录」。
- 启动仍会把快照整份装回内存；图片/录音极多时内存重建会随总量增长，尚未做按记录懒加载。
- 真机上的录音权限、系统栏 Insets、公共目录写入仍需在目标 Android 设备验证。
- 仓库没有绑定远程地址；需要协作时自行添加 remote。

## 打包给其他人

源码包不应包含：

```text
node_modules/  dist/  android/.gradle/  android/app/build/  android/build/
android/local.properties  android/keystore.properties  android/*.jks
artifacts/  .git/  .idea/
```

这些已在 `.gitignore` 中；打包脚本会再次排除本机配置和签名文件。
