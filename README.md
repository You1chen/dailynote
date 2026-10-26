# DailyNote

本地优先的个人日程与复盘系统：计划、反思、收获、课程、截止事项，全部存在你自己的目录里，不联网、不要账号。

Web/PWA 与 Android APK 共用同一份代码，数据格式互通。

## 功能

| 模块 | 能做什么 |
| --- | --- |
| 日计划 | 时间网格、时间块规划与验收、睡眠时段折叠、课程块只读、点击空白新建 |
| 周视图 | 一周日程总览、按周过滤课程、点空白/点任务直接进当天编辑 |
| 课程表 | 学期与周次、单双周、特殊日期、列表/课表双视图 |
| 截止事项（DDL） | 截止日期与时间、地点、Markdown 备注、图片、一周内红点提醒 |
| 重要的事 | 与 DDL 同构、三天内提醒、过期一天自动收起 |
| 遗留问题 | 记录当下解决不了的事，按「距今/日期/文字」记开始时间，显示历时，一周未推进提醒 |
| 任务清单 | 悬浮球承载、层级编辑、末级勾选、拖动排序 |
| 长期目标 | 目标 + 子任务 + 进度 |
| 反思 / 收获 | 三段式反思、每日收获 |
| 搜索 | 只搜你写的内容，结果显示位置并能跳转 |
| 备份与恢复 | 整个目录即数据；导出/导入 JSON；更换存储目录；重新扫描磁盘 |

图片识别（仅 Android）：给 DDL 或重要的事添加备注图片后点「识别」，离线 OCR 抽出**时间、地点、要求、邮箱**；多项冲突时逐行取舍，已有内容不重复填。

## 技术栈

React 18 · TypeScript 5 · Vite 5 · Capacitor 8（Android）· Vitest 4 · ML Kit（中文离线 OCR）

## 快速开始

```bash
npm install
npm run dev          # 开发服务器
npm run build        # 类型检查 + 构建 Web/PWA
npm run build:apk    # 构建 Android debug APK（Windows）
```

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`

## 数据与隐私

- 所有数据是普通 JSON 文件，默认在 `Documents/DailyNote/`（可更换目录）。
- 没有任何网络请求、账号、云同步；换手机靠导出/导入或直接拷目录。
- 启动时优先复用上次的快照，只在你手动点「重新扫描存储目录」或目录结构变化时才全量读取。

## 测试

```bash
npx vitest run       # 20 个文件 / 567 个用例
```

## 目录

```
src/utils/      纯函数（时间网格、课程、DDL、识别抽取、搜索…）
src/db/         业务 CRUD（内存 store）
src/services/   存储实现、启动快照、OCR 桥
src/hooks/      数据 Hook
src/components/ 复用组件
src/pages/      页面
android/        Capacitor + 原生插件（存储权限、ML Kit OCR）
```

结构细节见 [structure.md](structure.md)；每次改动记录见 [PROGRESS.md](PROGRESS.md)。

## 已知限制

- 图片识别仅 Android 可用（依赖原生 ML Kit），Web 端会提示不可用。
- 直接改磁盘上的文件内容不会被自动发现，需点「重新扫描存储目录」。
- 任务清单的旧数据表（`tasks.json`）已不再有界面消费，只作兼容保留。
