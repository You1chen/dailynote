# DailyNote 结构说明

| 项 | 值 |
| --- | --- |
| 应用版本 | 1.3.0（`versionName 1.3.0` / `versionCode 6`） |
| 技术栈 | React 18.3 · TypeScript 5.5 · Vite 5.4 · Capacitor 8.4 · Vitest 4.1 |
| 规模 | `src/` 92 文件；`test/` 26 文件 / 645 用例 |
| 形态 | Web/PWA（IndexedDB）· Android APK（公共 Documents） |
| 数据 | 无后端、无账号；用户目录 JSON 为唯一数据源 |
| 相关文档 | 变更记录 `PROGRESS.md`；开发规则 `principle.txt` |

---

## 1. 依赖

| 依赖 | 用途 |
| --- | --- |
| react / react-dom 18.3 | UI |
| react-router-dom 6.26 | `HashRouter`，12 条路由 |
| @capacitor/core·cli·android 8.4 | 原生容器 |
| @capacitor/filesystem 8.1 | 文件读写（必须显式 `encoding: UTF8`） |
| @capacitor/app 8.1 | 返回键、前后台、版本号 |
| com.google.mlkit:text-recognition-chinese 16.0.1 | 中文 OCR（原生，模型随包） |
| date-fns 3.6 / lucide-react / recharts | 日期、图标、图表（recharts 当前无引用） |
| dexie 4.0 | 仅旧库一次性迁移 |
| vitest 4.1 + fake-indexeddb | 测试 |

---

## 2. 路由

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `/` | DailyPlan | 时间网格、时间块 CRUD、验收、课程块只读 |
| `/goals` | LongTermGoals | 目标 + 子任务 + 进度 |
| `/backlog` | BacklogPage | 遗留问题（状态、历时、气泡） |
| `/reflection` | Reflection | 三段式反思 |
| `/harvest` | Harvest | 每日收获 |
| `/ddl` | DdlPage | 截止事项（地点、Markdown 备注、图片、关联课程/自定义分组） |
| `/important` | ImportantPage | 与 DDL 同构但**无关联**；三天内气泡；过期一天收起 |
| `/courses` | CoursesPage | 课程 CRUD、学期、特殊日期、列表/课表双视图 |
| `/week` | WeekViewPage | 周日程（课程过滤 + 当天任务块） |
| `/trash` | Trash | 回收站 |
| `/backup` | BackupRestore | 导入导出、存储路径 |
| `/settings` | SettingsPage | 头像、用户名、主题、默认偏好 |

无路由页面：`SetupPage`（Boot 阶段渲染）。任务清单无路由，由 `TaskBall` 承载。

---

## 3. 目录

```
src/
├── main.tsx            Boot：loading / setup / storagePermission / ready
├── App.tsx             外壳：主题 + SideNav + Routes + TabBar + TaskBall
├── App.css             CSS 变量、重置、通用类
│
├── types/index.ts      全部数据模型 + genId / todayStr / appendTemplateItems / PERIODS
│
├── utils/              纯函数，不 import React、不做 IO
│   ├── time.ts         时间换算、睡眠折叠映射（minutesToTop / topToMinutes / blockRenderRect / foldedGrid / futureWindow）
│   ├── courseSchedule.ts 周次、单双周、节假日、当日课程
│   ├── holidays.ts     内置节假日表（2026 精确 / 2027 推定）
│   ├── ddl.ts          剩余时间、一周与三天阈值、过期收起
│   ├── ddlLinks.ts     关联项生成/切换/去重、展示文案
│   ├── backlog.ts      距今折算、历时文案、一周宽限、排序
│   ├── taskTree.ts     标准文本 ⇄ 层级 ⇄ 末级并列、完成状态回填
│   ├── markdown.ts     Markdown → HTML（先转义后套标签）
│   ├── extract.ts      识别文本 → 时间/地点/要求/邮箱
│   ├── search.ts       全局内容搜索
│   └── avatarCrop.ts   裁剪几何、canvas 输出、图片压缩
│
├── db/
│   ├── index.ts        业务 CRUD（内存 store）、软删除、id 分配
│   └── legacy.ts       旧 Dexie 库（仅迁移）
│
├── services/
│   ├── store.ts        权威存储：内存投影 + 指纹增量写 + 双后端 + 迁移 + 权限守卫
│   ├── storage.ts      兼容 facade（旧导出名）
│   ├── ocr.ts          OCR 桥（原生 ML Kit；Web 端不可用）
│   ├── swUpdate.ts     PWA 更新检测（新版本接管 → 提示刷新）
│   └── snapshot.ts     启动快照（IndexedDB 缓存，按日期集合判定是否可复用）
│
├── contexts/BackButtonContext.tsx   Android 返回键
│
├── hooks/              13 个数据 Hook（见 §8）
│
├── components/         16 个 tsx（见 §9）
│
└── pages/              13 个页面
```

```
android/app/src/main/java/com/dailynote/app/
├── MainActivity.java            注册两个插件
├── DailyNoteStoragePlugin.java  「所有文件访问」权限桥
└── MlkitOcrPlugin.java          中文 OCR
```

---

## 4. 分层

```
pages/  →  components/ · hooks/ · utils/ · types/
hooks/  →  db/ · types/            （usePreferences 只碰 localStorage）
db/     →  services/store.ts · utils/taskTree.ts
store/  →  db/legacy（迁移）· types/
utils/  →  types/
```

规则：单向依赖，禁止反向；`utils/` 不 import React；`store.ts` 不依赖 hooks/pages。
不引入：状态管理库、后端 API、CSS-in-JS、组件库。

---

## 5. 数据模型

持久化 15 张表。字段定义见 `src/types/index.ts`。

| 表 | 文件 | 形态 | 关键字段 |
| --- | --- | --- | --- |
| dailyPlans | `days/<date>/plan.json` | 单对象 | `date, timeBlocks[]` |
| reflections | `days/<date>/reflections.json` | 数组 | `date, period, problem, cause, solution` |
| harvests | `days/<date>/harvests.json` | 数组 | `date, period, subject, content` |
| taskItems | `days/<date>/tasks.json` | 数组 | `id:string, title, done, date, sortOrder` |
| longTermGoals | `goals.json` | 数组 | `title, category, tasks[]` |
| fixedRoutines | `routines.json` | 数组 | `name, timeBlocks[], isActive` |
| taskTemplates | `templates.json` | 数组 | `name, items[]` |
| courses | `courses.json` | 数组 | `dayOfWeek:number[], weekType, startWeek, weekCount` |
| semester | `semester.json` | 单记录（id=1） | `startDate:string\|null, specialDates[]` |
| ideas | `ideas.json` | 数组 | `text, date, source?`（灵感的展示入口在收获页与任务面板） |
| ddls | `ddls.json` | 数组 | `name, deadlineDate, deadlineTime, location, notes, images[], links[]`；`dismissedAt>0` = 已解除威胁（褪色 30 秒后隐藏） |
| important | `important.json` | 数组 | 同 ddls（`links` 不使用） |
| backlog | `backlog.json` | 数组 | `title, startMode, startAt, startText, blocker, status` |
| taskBoard | `taskboard.json` | 单记录（id=1） | `nodes:TaskNode[], order:string[]` |
| linkGroups | `linkGroups.json` | 数组 | `name, items:LinkGroupItem[]`（自定义关联分组；内置「课程」组不落库） |
| trashItems | `trash.json` | 数组 | `originalTable, originalId, originalData, deletedAt` |

约定：
- `TimeBlock.focusScore / efficiencyScore`：0–10，0 = 未评分。
- `TaskItem.id` 为字符串；其余表主键 `number`；`TrashItem.originalId` 为 `number|string`。
- `TaskNode` 只有末级节点的 `done` 有意义；末级用完整链 `a/b/c` 标识。
- `DdlLink` 存的是**快照**（`kind, id, label, groupName`）：课程/分组被删后 DDL 仍显示当时的名字。
- `todayStr()` 为 UTC 日期；本地日期用 `utils/ddl` 与 `localDateStr`。

---

## 6. 存储

`services/store.ts` 是唯一持久化实现（约 1185 行）。

### 6.1 布局

```
Documents/<dir>/
├── days/<YYYY-MM-DD>/{plan,reflections,harvests,tasks}.json
├── goals.json  routines.json  templates.json  courses.json
├── semester.json  ddls.json  important.json  backlog.json
├── taskboard.json  linkGroups.json  trash.json
└── dailynote-backup-<时间戳>.json     （导出存档，不参与读取）
```

Web 端以同一相对路径为 IndexedDB KV 键（库 `dailynote_kv`）。

### 6.2 写入

| 环节 | 行为 |
| --- | --- |
| 变更入口 | `mutate(fn, {writeOrder})`：前后指纹对比，只写变脏文件 |
| 入队 | 入队瞬间捕获 `{目录, 待写文件}`；单条 promise 链串行 |
| 顺序 | 先写新增侧（回收站），后写移除侧（原表）；还原相反 |
| 失败 | 记录 `getLastPersistError()` 并返回 `false`，不 throw |
| 编码 | 原生 `writeFile` 必须 `encoding: UTF8`（缺省按 base64 解码 → 乱码） |
| 冲刷 | `flush()`；Boot 在 `visibilitychange` / `pause` 时调用 |

### 6.3 启动（快照优先）

启动时不再逐文件全量读取，而是优先复用上一次的快照（IndexedDB dailynote_snapshot）：

| 步骤 | 行为 |
| --- | --- |
| 1 | 旧单文件 dailynote-data.json 存在 → 走迁移路径（必须读它） |
| 2 | 列一次 days/ 目录名 + 根目录文件名（只有名称，不读内容） |
| 3 | 日期集合与快照一致 → **直接用快照数据**，零文件读取 |
| 4 | 日期集合变化（新增/删除某天）→ 全量读取并刷新快照 |
| 5 | 每次写盘后 400ms 防抖刷新快照；lush() 时立即落盘 |
| 6 | 「备份与恢复 → 重新扫描存储目录」丢弃快照，按磁盘现状重读 |

局限：外部直接改动某天的文件内容（文件名不变）不会被自动发现，需点「重新扫描存储目录」。

### 6.4 启动流程

1. `storageAccessBlocked()` 为真 → 返回 `INIT_STORAGE_BLOCKED(-2)`，不触碰内存 store。
2. 读后端：旧单文件 `dailynote-data.json` 存在时优先，忽略新布局。
3. 并入旧 Dexie（按 natural key，更新者胜）。
4. 重建 id 计数器；回收站自愈（原表已存在则丢弃副本）。
5. 有迁移或自愈 → `persist()`；成功后删除旧数据源。
6. 返回值：`-1` 首次使用；`>0` 恢复条数。

### 6.5 回收站

- 软删除：`deepClone` 入 `trashItems` 再移出原表；30 天过期（删除入口与打开回收站时清理）。
- `originalTable` 12 种：longTermGoals、reflections、harvests、fixedRoutines、taskItems、taskTemplates、courses、ddls、important、backlog、linkGroups、timeBlocks。
- `timeBlocks`：原数据存 `{date, ...block}`，还原时 push 回当天计划。

### 6.6 导入导出

- 导出：单 JSON 备份包（`version:1`）。
- 导入：剥 BOM → 校验（空 / 非 JSON / 损坏 / 缺 `version`+`dailyPlans`）→ 纯合并（存在则更新，永不删除）。
- 兼容：15 张表缺字段均兜底空数组；`courses` 额外归一化 `dayOfWeek`。

---

## 7. 运行时

Boot 四阶段：`loading` → `setup`（首次选目录）→ `storagePermission`（授权引导）→ `ready`。

```
UI → hooks → db/index.ts（内存 CRUD）→ mutate → store.ts → 文件 / KV
```

- 无全局状态库；每页自持 Hook 状态。
- 更新策略：修改类先 setState 后写库；创建/删除类先写库后 setState。
- 跨页通知：`window` 事件 `dailynote-ddl-changed`、`dailynote-important-changed`、`dailynote-backlog-changed`、`dailynote-task-changed`、`dailynote-open-tasks`。

---

## 8. Hooks

| Hook | 返回 |
| --- | --- |
| useDailyPlan(date) | plan, loading, addBlock, addFullBlock, updateBlock, removeBlock, importFromRoutine, reload |
| useTaskBoard() | nodes, leaves, undone, loading, saveTree, toggle, remove, reorder, reload |
| useTaskBadge() | count |
| useTaskList(date) | items, loading, addItem, toggleItem, removeItem, reload |
| useTaskTemplates() | templates, loading, addTemplate, updateTemplate, removeTemplate, reload |
| useGoals() | goals, loading, addGoal, updateGoal, removeGoal, addTask, toggleTask, removeTask, reload |
| useReflections(date) | reflections, loading, addOrUpdate, remove, getByPeriod, reload（另导出 useAllReflections） |
| useHarvests(date) | harvests, loading, addOrUpdate, remove, getByPeriod, reload（另导出 useAllHarvests） |
| useBacklog() | items, loading, addItem, updateItem, changeStatus, removeItem, reload |
| useBacklogBadge() | count |
| useDdlBadge() | count（剩余 < 7 天） |
| useImportantBadge() | count（剩余 < 3 天且未收起） |
| useTrash() | items, loading, restore, permDelete, clearAll, reload |
| useLinkGroups() | groups, loading, addGroup, removeGroup, addItem, removeItem, reload（DDL 关联的自定义分组） |
| usePreferences() | prefs（含 `futureOnly` 只看未来）、updatePrefs、resetPrefs |

---

## 9. 组件

| 组件 | 行 | 职责 | 使用方 |
| --- | --- | --- | --- |
| DeadlineListPage | 689 | 截止事项列表页（DDL 与重要的事共用，文案参数化；`allowLinks` 控制是否有关联） | DdlPage、ImportantPage |
| LinkPicker | 234 | 关联内容选择器：内置「课程」组（本学期有效课程，随课程表同步）+ 自定义分组增删 | DeadlineListPage |
| TaskBall | 390 | 任务悬浮球（可拖动）+ 清单面板 + 层级/文本填写；勾掉最后一条未完成时弹庆祝 | App |
| CelebrationDialog | 150 | 清单全部完成的庆祝弹窗（内联 SVG 插画 + 随机走心文案 + 纸屑动画） | TaskBall |
| FullscreenSchedule | 306 | 全屏日程网格 | DailyPlan |
| AvatarCropper | 297 | 头像裁剪 | SettingsPage |
| CourseEditModal | 233 | 课程新建/编辑 | CoursesPage、WeekViewPage |
| TimeBlockCard | 157 | 零引用 | — |
| DayNavigator | 140 | 月历日期选择器 | DailyPlan、Reflection、Harvest、FullscreenSchedule |
| PreferencePanel | 124 | 偏好底部面板 | DailyPlan |
| SearchOverlay | 110 | 全局搜索浮层 | SideNav |
| SideNav | 110 | 展开式左侧导航（搜索 + 三组 + 设置） | App |
| FullscreenEditor | 75 | 全屏编辑器 | Harvest |
| Lightbox | 70 | 图片大图查看 | DeadlineListPage |
| ConfirmDialog | 40 | 应用内确认/提示（替代 confirm/alert） | 多页 |
| TabBar | 31 | 底部三标签 | App |

---

## 10. 页面

| 页面 | 关键点 |
| --- | --- |
| DailyPlan | 粘性头部（日期/周条/统计/工具）、FAB 新建、点空白新建、点块编辑或验收、睡眠折叠、只看未来（折叠当前小时之前）、课程块只读、支持 `?date=&new=&block=` |
| CoursesPage | 列表/课表双视图、学期与特殊日期、折叠不重要时段（24px 条） |
| WeekViewPage | 7 列周日程、课程按周过滤、点空白/点块跳日计划编辑、睡眠折叠 |
| DdlPage / ImportantPage | 共用 DeadlineListPage：地点、Markdown 备注（编辑/预览）、图片查看（Lightbox）、图片识别（识别全部备注图片）、解除威胁；**关联内容只有 DDL 有**（`allowLinks`，重要的事关闭）；重要的事三天气泡 + 过期一天收起 |
| BacklogPage | 阻塞中/可推进/已解决/已终止；起始三态（距今/日期/文字）；历时排序；一周宽限气泡 |
| LongTermGoals | 新建目标、子任务、进度、分类标签（无编辑、无筛选） |
| Reflection / Harvest | 三段式反思；收获 #标签；均支持 `?date=` |
| Trash / BackupRestore / SettingsPage / SetupPage | 回收站；导入导出与路径；头像主题偏好；首次目录选择 |

识别结果核对（`planExtraction`，`utils/extract.ts`）：

| 情况 | 行为 |
| --- | --- |
| 表单/备注里没有 | `fill`，点「填入」写入 |
| 已有完全相同的值 | `skip`，自动跳过，不重复填 |
| 已有不同的值 | `conflict`，选「保留原值 / 用识别值」，默认保留原值 |
| 任一行 | 可直接编辑，或点 ✕ 删掉该行 |
| 多张图给同一字段不同值 | 行内列出「图与图不同」的候选，点选采用哪个 |

---

## 11. 样式

`App.css` 变量：`--color-*`（bg/surface/primary/text/border/success/warning/danger/heatmap1–4）、`--radius-*`(8/12/16/20)、`--shadow-sm/md/lg`、`--font-*`(0.75–1.5rem)、`--nav-w: 76px`、`--safe-top/bottom`。深色主题覆盖颜色与阴影。

| z-index | 用途 |
| --- | --- |
| 1–10 | 页面内局部（网格表头、块、列线） |
| 20 | 日程粘性头部 `.dp-head` |
| 50 | FAB |
| 90 | SideNav |
| 100 | TabBar |
| 120 | TaskBall |
| 150 | 新版本提示条 `.app-update-bar` |
| 200 | `.modal-overlay`（编辑弹窗、列表弹窗） |
| 300 | 全屏日程、全屏编辑器、SearchOverlay |
| 310 | 日计划编辑面板、课程详情 |
| 320 | PreferencePanel |
| 330 | 关联内容选择器 LinkPicker |
| 400 | 验收弹窗、头像裁剪、ConfirmDialog |
| 500 | Lightbox |
| 600 | 庆祝弹窗 CelebrationDialog |

---

## 12. 测试

`npx vitest run`：26 文件 / 645 用例。

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| 时间网格点击映射/clickMapping | 207 | 像素↔时间正反映射、密度、滚动补偿 |
| 数据存储/store | 53 | CRUD、persist、迁移、自愈、导出、课程/DDL 存储 |
| 课程表/courseSchedule | 32 | 周次、单双周、节假日、当日课程 |
| 数据导入导出/jsonImport | 23 | 解析、BOM、乱码拒绝、错误分级、往返 |
| 任务/taskTree | 23 | 文本⇄层级、完整链、状态回填、删除、排序 |
| 遗留问题/backlog | 20 | CRUD、回收站、持久化、历时与宽限 |
| 搜索/search | 19 | 内容命中、路由、不命中界面文案与日期、DDL 阈值 |
| 任务清单/taskList | 18 | 创建、切换、排序、日期隔离 |
| 时间网格点击映射/foldedGrid | 18 | 多段折叠几何与块渲染 |
| 时间网格点击映射/futureWindow | 19 | 只看未来：折叠起点、映射与反算、跨起点块、边界与密度 |
| 任务/celebration | 7 | 全部完成庆祝的判定（最后一条才弹） |
| 偏好设置/avatarCrop | 17 | 缩放、钳制、裁剪矩形 |
| 灵感/ideas | 6 | ideas.json 往返、排序、更新、回收站还原、导出导入 |
| 识别/extract | 41 | 全角、补年份、相对日期、地点防误判、要求/邮箱、去重与冲突、图与图冲突、状态栏时钟与界面噪声回归 |
| 重要的事/important | 16 | CRUD、回收站、持久化、三天阈值、过期收起 |
| 时间网格点击映射/blockRenderRect | 16 | 睡眠折叠下的块矩形 |
| 偏好设置/preferences | 15 | 默认值、存取、主题 |
| DDL清单/ddlTime | 20 | 剩余分钟、23:59 默认、文案边界、解除威胁的分组与倒计时 |
| 课程表/effectiveCourses | 12 | 有效课程：学期前提、周期边界、单双周、排序 |
| DDL清单/ddlLinks | 15 | 关联项生成/切换/去重/展示文案 |
| DDL清单/linkGroups | 8 | 关联分组 CRUD、回收站、落盘、导入导出、DDL 关联快照 |
| 任务清单/taskTemplate | 13 | 模板 CRUD、软删除、持久化、套用 |
| DDL清单/markdownAndLocation | 10 | Markdown 语法、XSS 转义、地点往返 |
| 数据存储/storageAccess | 8 | 权限守卫、阻塞时零写入 |
| 数据存储/nativeWriteEncoding | 3 | 原生写入 utf8 与往返 |
| 数据存储/startupSnapshot | 6 | 快照命中、目录变化失效、rescan 读入外部改动、换目录不复用 |
| **合计** | **645** | 26 个文件 |

环境：无 `vitest.config.*`，`vite.config.ts` 无 `test` 段；`tsconfig.json` 的 `include:["src"]` 意味着 `tsc` 不检查 `test/`。

---

## 13. 构建

| 命令 | 行为 |
| --- | --- |
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | `tsc --noEmit` + `vite build`（PWA，`base=/`） |
| `npm run build:android` | `tsc` + `vite build`（`CAPACITOR=true`、`base=./`、无 PWA）+ `cap sync` |
| `npm run build:apk` | 同上 + `gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run cap:assets` | 生成安卓图标 |

- 模式由环境变量 `CAPACITOR` 决定，非 `--mode`。
- APK 仅打包 `arm64-v8a` / `armeabi-v7a`（`packaging.jniLibs.excludes` 去 x86/x86_64），约 24.6 MB。
- `scripts/build-apk.ps1` 硬编码本机 `JAVA_HOME` / `ANDROID_SDK_ROOT`，仅 Windows。
- CI：`.github/workflows/build-apk.yml` 推送构建 debug APK，不跑测试。

---

## 14. 约束

1. 磁盘只由 `store.ts` 触碰；UI 与 CRUD 只读写内存 store。
2. 每次变更立即落盘，无防抖窗口。
3. 权限阻塞时禁止任何写操作。
4. 删除一律软删除；`originalTable` 与 `restoreFromTrash` 分支必须同步。
5. 新增表必须同时改：`StorageData`/`StoreShape`、`CATEGORY_FILES`、`NumericTable`、`nextId`/`resetNextId`、`clearStore`、`countData`、`applyData`、`snapshot`、`fingerprint`/`Fp`、`buildWriteSetFromStore`、`buildWriteSetDirty`、`DEFAULT_WRITE_ORDER`、`mergeIntoStore`、`mergeLegacy`、`liveArr`、`parseStorageData`、`readNewStructure`、`hasAny`、搜索、回收站标签。

---

## 15. 已知债务

| 项 | 说明 |
| --- | --- |
| taskItems 数据层 | 任务清单改由 taskBoard 承载，`taskItems` 已无 UI 消费（保留旧数据） |
| TimeBlockCard | 零引用 |
| recharts | 已无引用（宏观视图页已删），仍留在 `package.json` |
| 作息模板 | `fixedRoutines` 无创建入口 |
| id 计数器 | `resetNextId` 只扫活表，跨重启可能复用已删 id |
| `persist()` | `deletes` 恒空，不清理孤儿文件 |
| `todayStr()` | UTC 语义，凌晨 0–8 点会算成前一天 |
| 分数备注 | `types` 注释写 1–10，实际 0–10 |
| icon-192 | `index.html` 引用不存在的 `icons/icon-192.png` |
| 有效课程 | 课程没有「所属学期」字段：只按学期开学时间 + 课程周次判断。若课程表里仍留着上学期的课、且其周次与本周重合，它仍会被算作有效 |
| NDK | 未安装；端侧 VLM（LFM2.5-VL-450M）路线因此未接入 |
