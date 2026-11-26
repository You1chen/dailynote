# DailyNote 两页改版说明

> 状态：Web/PWA 已完成并通过构建与回归测试；Android debug APK 已在本机用 JDK 21 + Android SDK 36 构建并导出。APK 为 debug 签名，包名 `com.dailynote.app`，版本 `1.3.0 (6)`。
> 入口：`src/main.tsx` → `src/v2/AppV2.tsx`。旧的 `src/App.tsx`、旧页面和旧组件仍保留用于数据兼容和回归测试，但已不参与新路由。

## 1. 现在的两页

| 页面 | 内容 |
| --- | --- |
| **今日** | 大日期（点开月历选日）、当天课程的紧凑条、24 小时竖向时间轴、框选新建日程、日程编辑、顶部「待办」入口、桌面端的今日概览与最近卡片 |
| **卡片** | 「关系网 / 卡片库」切换、搜索与时间/类型筛选、Logseq 风格卡片关系网、卡片列表、卡片新建与编辑 |

除这两页外，只有浮层：

- **相机球**（右下角）：拍照 / 相册 → 识别成日程，或保存为卡片；保存卡片时可以选择不识别文字，只保留图片，之后再补备注。
- **待办抽屉**：从顶部「待办」按钮打开的全屏清单，支持快速添加、勾选完成与撤销、整理层级、遗留。
- **导入课表**：网址 / 网页源码 / 文本 / 截图四种来源，解析后预览、修正、导入。
- **使用说明**：两页应用及四个核心功能的完整说明书。
- **设置**：主题、默认日程时长、立即保存、导出/导入备份、重新扫描、使用说明入口。
- **首次欢迎**：只在无既有状态的新安装出现。

## 2. 保留与移除

保留并重做：

- 卡片：文字、图片、录音（旧数据只读展示）、类型、标签、关联课程、手动关联卡片。
- 框选时间新建日程：时间轴长按拖动选起止，松手编辑；点击空白按默认时长新建。
- TODO：从悬浮球迁移到顶部按钮 + 全屏抽屉；数据结构仍使用原来的任务树。
- 说明书：重写为两页应用的说明。

从界面移除、数据保留：

- DDL、重要的事、长期目标、秘密花园、结算、遗留问题页、记事/回忆、旧课程表页、周视图、回收站、旧备份页、搜索、侧边导航、旧首次引导。
- 旧数据文件不动；新界面只读取卡片、课程/学期、每日计划、任务树。
- 旧路由（如 `#/settings`、`#/ddl`）会重定向到「今日」。

## 3. 数据模型变化

`KnowledgeCard` 新增五个**可选**字段，旧卡片不需要迁移：

```ts
tags?: string[];         // 标签；共享标签形成确认连线
keywords?: string[];     // 手动关键词；共享关键词形成确认连线
courseIds?: number[];    // 直接关联课程，只用于卡片信息，不再生成关系网边
links?: string[];        // 已确认关联的卡片 id（块引用），关系网实线
ignoredLinks?: string[]; // 被拒绝的关联建议（负反馈），避免重复出现
```

- 卡片保存时会保持已确认关联**双向一致**（A 关联 B，B 也会写入 A）。
- 关键词从关系网节点的长按菜单设置；相同关键词会直接连成实线，不依赖文本相似度阈值。
- 课程、卡片类型、正文相似度、标题出现**不再直接生成边**。它们由发现引擎转成建议，确认后才写入 `links`。
- 删除卡片会同时清理其他卡片对它的 `links` 和 `ignoredLinks` 引用。
- 旧课程知识树里 `node.cardIds` 的关联仍会被读取为「间接课程关联」，用于卡片编辑器的课程显示，但不再作为关系网连线。
- `knowledge-cards.json` 文件格式保持兼容。

## 4. 课程表抓取

新增/改造：

- `src/v2/utils/timetableHtml.ts`：纯正则 HTML 课表解析器。
  - 支持 `<table>`、`rowspan`/`colspan`、`<br>`、HTML 实体、嵌套标签。
  - 识别星期表头、第 a-b 节、HH:mm 时间段；默认 12 节课时间表；无法识别行时按 5–6 / 10–14 行推断每行节数。
  - 解析课程名、教师、地点、`1-16周` / `单周` / `双周`。
  - 同一天相邻重复单元格合并。
- `src/v2/utils/timetableHtml.ts` 的 `parseTimetableText`：支持粘贴文本（`周一 08:00-09:40 高等数学 @教1-101`、`周二 第3-4节 英语 1-16周 教2-202` 等）。
- `src/v2/components/CourseImportSheet.tsx`：四种来源 + 可编辑预览 + 开学日期 + 替换/追加。
- Android 应用内抓取：
  - `CourseGrabPlugin.java`：调用 `startActivityForResult` 打开站内浏览器。
  - `CourseGrabActivity.java`：WebView（桌面 UA、Cookie、HTTP 混合内容），用户登录并打开课表页后点「读取本页」，把 `document.documentElement.outerHTML` 返回给网页层。
  - `AndroidManifest.xml` 新增 Activity；`MainActivity` 注册插件；`usesCleartextTraffic="true"` 兼容仍使用 HTTP 的校园站点。

限制：

- 网页版直接输入网址受浏览器 CORS 限制，多数教务系统会失败；网页版建议使用「源码」「文字」或「截图识别」。
- Android 站内抓取需要在有 Android SDK 的机器上编译真机验证；这里没有打包验证。
- 如果课表在跨域 iframe 或 canvas 里，outerHTML 抓不到；可改用源码/文字/截图。
- 截图识别后仍然走文本解析，需要识别结果里包含星期和时间（或节次）才能生成课程。

## 5. 拍照（相机球）

- 右下角悬浮球从「识图」改为「拍照」，图标改为相机；点开后可拍照或从相册选图。
- 选好照片后先做目的地选择：
  - **识别成日程**：OCR 后把首行作为名称、全文作为内容，打开当天日程编辑器。
  - **保存为卡片**：进入卡片选项，开关「识别文字」。
    - 开：OCR 后文字 + 原图一起进入新卡片编辑器。
    - 关：完全不识别，只保存图片；进入编辑器后点「＋ 文字」补备注。
- Android：沿用 `MlkitOcrPlugin.java` 的 ML Kit 中文离线识别。
- Web：`tesseract.js` + 本地资源（`public/tesseract/*`、`public/tessdata/chi_sim.traineddata`），首次加载约数秒，之后可离线。
- PWA 会预缓存约 10.9 MB 的 OCR 资源；Android APK 不打包这些 Web OCR 资源（原生使用 ML Kit），只保留 ML Kit 模型。
- 原来的「存为待办」入口已从相机球移除；待办仍可从顶部抽屉直接添加。

## 6. 卡片关系网与内链融合

关系网按 `Logseq 内链融合架构方案.txt` 的思路重做：**系统负责发现，写作者保留决定权**。发现结果不再静默变成边，而是先进入建议队列。

### 6.1 锚点层：只画已确认的链接

`src/v2/utils/cardGraph.ts` 只把三种显式锚点当作边，旧卡片无需迁移：

| 锚点 | 对应字段 | 含义 | 线权重 |
| --- | --- | --- | --- |
| 块引用 / 手动确认 | `links` | A 直接引用 B；接受建议也写入这里 | 3 |
| 页面引用 | 共享 `keywords` | 同一关键词视为同一页面 | 2 |
| 页面引用 | 共享 `tags` | 同一标签视为同一页面 | 1.5 |

- 手动链接优先级最高；一条边可同时合并 `manual` / `keyword` / `tag` 多个理由。
- 同课程、同类型、正文相似、标题出现 **都不再直接生成边**；它们只用于发现建议，避免静默污染关系网。
- 超过 4 张卡片的 keyword / tag 组使用按创建时间的环，而不是全连接，防止抱团。
- `src/v2/utils/graphLayout.ts`：确定性力导向布局（phyllotaxis 种子 + 斥力/弹簧/重力/碰撞），新增 `paddingRight`，给右上角缩放控件预留安全区，节点标签不会被按钮遮挡。
- `CardGraphView`：实线 = 已确认，细虚线 = 待确认建议；悬停节点时高亮相关边。支持拖拽、缩放、点击查看、长按/右键菜单。

### 6.2 发现层：字面 + 内容相似双引擎

`src/v2/utils/cardDiscovery.ts`，完全本地、无网络、无模型下载：

- **字面引擎**
  - 扫描卡片标题 + 正文 + 评论 + 录音文件名。
  - 命中另一张卡的**标题**：唯一标题 92%（标题 ≥4 字）或 84%，歧义标题 56%。
  - 命中另一张卡的关键词：唯一关键词 74%，歧义 50%。
  - 英文/数字锚点使用词边界（`RAG` 不会命中 `storage` / `average` 内部）。
- **内容相似引擎**
  - 复用 `cardKeywords` 的中文 bigram / 英文词元，做本地 TF-IDF + 余弦相似度。
  - 默认阈值 0.3，至少共享 2 个词元；输出 `内容相近 · 68%` 这样的可读理由。
  - 不引入 ONNX / 外部进程；文本不出设备。后续若换成本地向量模型，队列接口不变。
- 两张卡之间只保留一条建议；已确认、已忽略、已经以字面理由出现的 pair 不会重复进入语义建议。
- 每张卡片最多 2 条字面 + 2 条语义建议，全局最多 48 条，按置信度/相似度排序。

### 6.3 交互层：建议队列与分级确认

- `src/v2/components/CardLinkSuggestionsSheet.tsx`：建议队列。
  - 「全部 / 字面 / 相近」筛选；每条显示来源卡 → 目标卡、理由和置信度。
  - **接受**：写入双方 `links`，关系网立刻变实线；toast 提供「撤销」。
  - **忽略**：写入双方 `ignoredLinks`，同一条建议不再出现；toast 可撤销，队列底部可「恢复」全部已忽略建议。
  - 强调「系统发现，由你确认；接受后才写入关系网」，不静默自动写入。
- 块级局部确认：长按关系网节点 → 菜单新增「查看关联建议」，只显示与这张卡相关的建议；顶部显示「只看 xxx」并可清除。
- 数据层 `src/db/knowledgeCards.ts`：
  - `confirmCardLink` / `removeCardLink` / `ignoreCardLinkSuggestion` / `restoreCardLinkSuggestion` / `restoreIgnoredCardLinks` 都在同一次事务里同时更新两端，失败回滚。
  - 接受建议会清掉该 pair 的负反馈；手动关联也会清掉对应 `ignoredLinks`。
- 默认**不开启**高置信字面自动写入：所有发现都先进入队列，避免误链污染知识库。需要更激进时，可在 `cardDiscovery.ts` 的阈值/上限上调整，或后续在设置里加显式开关。
- 旧的「同课程 / 同类型 / 关键词相似自动浅色线」已移除，对应文案与图例一并更新。

关系网与卡片库共享搜索、时间范围、类型筛选；卡片编辑器里的「选择关联卡片」维护的是已确认关联，两端同步。

## 7. 设计与实现

- 设计变量集中在 `src/v2/v2.css`：Apple 系统字体栈、浅色 `#f5f5f7` / 深色 `#0a0a0c`、单一蓝色强调色、暖白卡片、毛玻璃顶栏与浮层、iOS 风格分段控件与底部标签。
- 动效：按压即时缩放、浮层上滑、面板拖拽关闭、当前时间红线、尊重 `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast`。
- 焦点：Sheet 内有 Tab 焦点环与栈顶 Esc 关闭；浮层锁滚动。
- 图标：新的蓝色「卡片 + 对勾」应用图标，Web/PWA/Android 启动器图标与开屏图已更新。
- 组件：`src/v2/components/Sheet.tsx` 统一浮层；`ScheduleSheet` 全局日程编辑；`TodoSheet`、`CameraSheet`、`HelpSheet`、`SettingsSheet`、`CardEditorSheet`、`CardDetailSheet`、`CardKeywordSheet`、`CardContextMenu`、`CardLinkSuggestionsSheet`、`DatePickerSheet`、`CourseImportSheet`、`WeekTimetableSheet`、`WelcomeSheet`、`CardGraphView`。
- 今日页顶部去掉了横向一周日期条，只保留大日期 + 月历选择器 + 下方竖向时间轴；移动端课程条压成一行，时间轴从约 174px 开始（原来约 439px），不再出现日期/统计换行。
- 时间框选：`.v-time-grid` 使用 `touch-action: none`，触摸滚动由 `PlanTimeGrid` 手动完成；快速滑动=滚动，长按后拖动=框选，浏览器原生滚动不会再把时间轴带走。已在 390px 视口用 CDP 触摸事件验证。

## 8. 运行 / 验证

```bash
npm ci
npm run dev       # 开发
npm test          # 70 个测试文件 / 969 个用例（含 graph、discovery、DB 事务测试）
npm run build     # 类型检查 + 生产构建
```

本次验证结果：

- `npx tsc --noEmit` 通过。
- `npm test`：70 个文件 / 969 个用例全部通过。
- `npm run build` 通过；PWA 预缓存 23 项（约 10.9 MB，含 OCR 模型与图标）。
- 浏览器截图与交互验收（Chromium/Edge，390×844 / 320×720）：
  - 今日桌面 / 390px 移动 / 320px 窄屏；顶部不再换行，无横向溢出；时间轴从 174px 开始，底部与标签栏留 20px。
  - 月历选择日期、左右切日、回到今天。
  - 鼠标拖选和 **CDP 触摸长按拖选**都能打开新建日程；快速触摸滑动仍能滚动时间轴且不误触新建。
  - 拍照浮层 → 保存为卡片 → 关闭识别 → 1 张图片、0 段文字；开启识别 → 1 段文字 + 1 张图片。
  - 拍照识别 → 日程编辑器。
  - Logseq 风格关系网：相同时段只有 1 条已确认实线 + 1 条待确认虚线；长按菜单出现「查看关联建议」。
  - 建议队列：字面命中 92%；接受后实线 2 条、虚线 0 条；撤销后恢复；忽略后队列为空且底部出现「恢复」；恢复后建议回来。
  - 320px 下页面 `scrollWidth=320`，队列无横向溢出；右上角控件不再遮挡节点标签。
  - 浅色 / 深色主题、菜单、说明书、设置；无控制台错误。
- 截图在 `artifacts/v4/`。

### Android 构建环境

本机已安装的构建工具（与源码分离，位于 D 盘）：

| 工具 | 路径 / 版本 |
| --- | --- |
| JDK | `D:\android-tools\jdk-21`（Temurin 21.0.5+11） |
| Gradle | `D:\android-tools\gradle-8.14.3`（8.14.3） |
| Android SDK | `D:\android-tools\sdk`（platform 36、build-tools 36.0.0 / 35.0.0、platform-tools 37.0.3） |
| SDK 配置 | `android/local.properties` → `sdk.dir=D:/android-tools/sdk` |
| 构建缓存 | `D:\android-tools\gradle-home` |

构建步骤：

```powershell
$env:JAVA_HOME='D:\android-tools\jdk-21'
$env:ANDROID_HOME='D:\android-tools\sdk'
$env:ANDROID_SDK_ROOT='D:\android-tools\sdk'
$env:GRADLE_USER_HOME='D:\android-tools\gradle-home'
$env:CAPACITOR='true'
npx tsc --noEmit
npx vite build
# 原生 APK 用 ML Kit：去掉只有浏览器用的 Tesseract 资源（约 10 MB）
Remove-Item -Recurse -Force dist\tesseract,dist\tessdata -ErrorAction SilentlyContinue
npx cap sync android
cd android
D:\android-tools\gradle-8.14.3\bin\gradle.bat --no-daemon --init-script D:\android-tools\init-mirrors.gradle assembleDebug
```

- 本机 Maven Central 直连很慢，构建时用 `D:\android-tools\init-mirrors.gradle` 把阿里云镜像放在前面；这是本机构建辅助，不影响仓库源码。
- 项目路径含中文「桌面」，AGP 需要 `android.overridePathCheck=true`（已写入 `android/gradle.properties`）。
- debug APK：`android/app/build/outputs/apk/debug/dailynote.apk`（约 30.4 MB），已复制到：
  - `exports/DailyNote-two-page-debug.apk`
  - 上级目录的 `DailyNote-two-page-debug.apk`
- SHA-256：`4CAEB7755BE669DF1ACDEC0910F38CDB5BF4ED6BDD7DB11DB1615B9E786E93CE`

## 9. 已知限制 / 后续

- **APK 是 debug 签名**：根目录旧文件 `DailyNote-3.0.0-update-debug.apk` 实际也是 `1.3.0 (6)`，并且使用同一枚 Android Debug 证书，正常情况下可以直接覆盖安装。如果系统安装器拒绝，再卸载旧 App（公共 `Documents/DailyNote` 数据仍在，重新授权存储权限即可）；需要正式发布时，用旧签名 keystore 打 release 包。
- `CourseGrabActivity` 已成功编译并打进 APK，但本机没有连接 Android 设备，站内登录/抓取还需要在真机验证一次。
- APK 只保留 `arm64-v8a` / `armeabi-v7a`（与项目原配置一致）；x86 模拟器不包含 ML Kit 原生库。
- Web 直接抓课程网址受 CORS 限制，这是浏览器安全模型，不是解析器问题。
- 旧卡片里的评论仅保留数据，不在新 UI 编辑；录音可播放，不可新录。若需要恢复评论/录音编辑，可在卡片编辑器里继续扩展。
- 关联建议是启发式：字面只看标题/关键词，内容相似是本地 TF-IDF 而不是真正的语义向量；短标题、同主题卡片可能产生噪音，可用「忽略」形成负反馈，或调 `cardDiscovery.ts` 顶部的阈值/上限。默认不静默写入，所有建议都需确认。
- 课程表抓取的「截图」来源本质是 OCR 文本解析，不是图像表格识别；网格截图可能识别不出星期/时间，建议用源码或文本。
- 旧功能页面代码仍在仓库中（测试与数据兼容用），未从磁盘删除。
