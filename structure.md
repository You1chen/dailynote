# DailyNote 结构说明

| 项 | 值 |
| --- | --- |
| 应用版本 | 1.3.0（`versionName 1.3.0` / `versionCode 6`） |
| 技术栈 | React 18.3 · TypeScript 5.5 · Vite 5.4 · Capacitor 8.4 · Vitest 4.1 |
| 规模 | `src/` 120 文件；`test/` 48 个测试文件 / 799 用例 |
| 形态 | Web/PWA（IndexedDB）· Android APK（公共 Documents） |
| 数据 | 无后端、无账号；用户目录 JSON 为唯一数据源 |
| 相关文档 | 变更记录 `PROGRESS.md`；开发规则 `principle.txt` |

---

## 1. 依赖

| 依赖 | 用途 |
| --- | --- |
| react / react-dom 18.3 | UI |
| react-router-dom 6.26 | `HashRouter`，14 条路由 |
| @capacitor/core·cli·android 8.4 | 原生容器 |
| @capacitor/filesystem 8.1 | 文件读写（必须显式 `encoding: UTF8`） |
| @capacitor/app 8.1 | 返回键、前后台、版本号 |
| com.google.mlkit:text-recognition-chinese 16.0.1 | 中文 OCR（原生，模型随包） |
| date-fns 3.6 / lucide-react | 日期、图标 |
| dexie 4.0 | 仅旧库一次性迁移 |
| vitest 4.1 + fake-indexeddb | 测试 |

---

## 2. 路由

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `/` | DailyPlan | 时间网格、时间块 CRUD、验收、课程块只读；顶部可打开今日结算 |
| `/goals` | LongTermGoals | 长期目标摘要；不显示或创建愿望，也没有花园入口；目标地图与全屏树编辑 |
| `/garden/*` | GardenGate + GardenPage | 独立隐藏页：只有搜索「秘密花园 」才进入；解锁后是倾述、愿望与门内设置；离开、切后台或刷新立即清除内存密钥并卸载明文；门内隐藏外壳导航与底栏 |
| `/backlog` | BacklogPage | 遗留问题（状态、历时、气泡） |
| `/reflection` | Reflection | 三段式反思 |
| `/harvest` | Harvest | 每日收获 |
| `/ddl` | DdlPage | 截止事项（地点、Markdown 备注、图片、关联课程/自定义分组） |
| `/important` | ImportantPage | 与 DDL 同构但**无关联**；三天内气泡；过期一天收起 |
| `/courses` | CoursesPage | 课程 CRUD、学期、特殊日期、列表/课表双视图 |
| `/week` | WeekViewPage | 周日程（课程过滤 + 当天任务块） |
| `/trash` | Trash | 回收站 |
| `/backup` | BackupRestore | 导入导出、存储路径 |
| `/settings` | SettingsPage | 四组设置入口：个人与外观、日程与时间、课程、数据与备份；`?section=` 进入详情；不出现花园线索 |
| `/settlement` | Settlement | 按今日实际交互汇总的全屏 Canvas 分页海报，零项隐藏、文字明细可展开 |

无路由页面：`SetupPage`（Boot 阶段渲染）。任务清单无路由，由 `TaskBall` 承载。

---

## 3. 目录

```
src/
├── main.tsx            Boot：loading / setup / storagePermission / ready
├── App.tsx             外壳：主题 + SideNav + Routes + TabBar + TaskBall；花园路由隐藏侧栏与底栏
├── App.css             CSS 变量、重置、通用类
│
├── types/index.ts      领域数据模型 + genId / todayStr / appendTemplateItems / PERIODS
│   └── storage.ts      跨存储/查询复用的 StoreShape、StorageData、AnyStoreTable
│
├── utils/              纯函数，不 import React、不做 IO
│   ├── time.ts         时间换算、睡眠折叠映射（minutesToTop / topToMinutes / blockRenderRect / foldedGrid / futureWindow）
│   ├── courseSchedule.ts 周次、单双周、节假日、当日课程
│   ├── holidays.ts     内置节假日表（2026 精确 / 2027 推定）
│   ├── ddl.ts          剩余时间、一周与三天阈值、过期收起
│   ├── ddlLinks.ts     关联项生成/切换/去重、展示文案
│   ├── backlog.ts      距今折算、历时文案、一周宽限、排序
│   ├── taskTree.ts     标准文本 ⇄ 层级 ⇄ 末级并列、完成状态回填、行内插入与空行过滤
│   ├── mindmap.ts      目标脑图世界坐标布局（双翼、避重叠、边界、命中检测）
│   ├── goalTree.ts     长期目标树：标准文本互转、严格等权递归进度、状态保留、旧扁平任务投影
│   ├── markdown.ts     Markdown → HTML（先转义后套标签）
│   ├── extract.ts      识别文本 → 时间/地点/要求/邮箱
│   ├── search.ts       全局内容搜索（跳过花园愿望与倾述）
│   ├── gardenEntry.ts  隐藏入口：仅输入恰为「秘密花园 」时返回入口与设置命中
│   ├── avatarCrop.ts   裁剪几何、canvas 输出、图片压缩
│   ├── settlement.ts   实际交互事件检测、按日净进度汇总、海报数据映射
│   ├── gardenLock.ts   旧版花园数字密码摘要（仅迁移验证，成功后删除）
│   └── settlementPoster.ts Canvas 海报布局/分页/绘制（单页像素上限）
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
│   ├── gardenSecurity.ts 秘密花园混合加密、密钥信封、迁移、解锁/改密、明文导出与快照守卫
│   └── snapshot.ts     启动快照（IndexedDB 缓存，按日期集合判定是否可复用）
│
├── contexts/BackButtonContext.tsx   Android 返回键
│
├── hooks/              13 个数据 Hook（见 §8）
│
├── components/         24 个 tsx（见 §9）
│
└── pages/              15 个页面
```

```
android/app/src/main/java/com/dailynote/app/
├── MainActivity.java            注册两个插件；Android 15+ 将 systemBars/displayCutout 内边距应用到内容根视图
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

持久化 16 张表。字段定义见 `src/types/index.ts`；花园密钥信封见 `src/types/garden.ts`。

| 表 | 文件 | 形态 | 关键字段 |
| --- | --- | --- | --- |
| dailyPlans | `days/<date>/plan.json` | 单对象 | `date, timeBlocks[]` |
| reflections | `days/<date>/reflections.json` | 数组 | `date, period, problem, cause, solution` |
| harvests | `days/<date>/harvests.json` | 数组 | `date, period, subject, content` |
| taskItems | `days/<date>/tasks.json` | 数组 | `id:string, title, done, date, sortOrder` |
| longTermGoals | `goals.json` | 数组 | `title, category, tasks[]`；`kind: wish` = 花园内容，`gardenEntry` 区分愿望与倾述（只在密文内）；已加密条目只留 `id, kind, createdAt, updatedAt` 与 `encrypted` 信封，正文与 `gardenEntry` 全部在密文中 |
| gardenKeys | `garden-keys.json` | 数组 | `keyId, version, publicKey, salt, iterations, iv, privateKey, updatedAt`：RSA 公钥 + 口令加密的 PKCS8 私钥信封；随备份迁移 |
| fixedRoutines | `routines.json` | 数组 | `name, timeBlocks[], isActive` |
| taskTemplates | `templates.json` | 数组 | `name, items[]` |
| courses | `courses.json` | 数组 | `dayOfWeek:number[], weekType, startWeek, weekCount, semesterStartDate?` |
| semester | `semester.json` | 单记录（id=1） | `startDate:string\|null, specialDates[]` |
| ideas | `ideas.json` | 数组 | 杂念：`kind`(wish/chore/idea)、`title?`、`text`、`date`、`tags?`；缺 `kind` 视为 idea |
| ddls | `ddls.json` | 数组 | `name, deadlineDate, deadlineTime, location, notes, images[], links[]`；`dismissedAt>0` = 已解除威胁（褪色 30 秒后隐藏） |
| important | `important.json` | 数组 | 同 ddls（`links` 不使用） |
| backlog | `backlog.json` | 数组 | `title, startMode, startAt, startText, blocker, status` |
| taskBoard | `taskboard.json` | 单记录（id=1） | `nodes:TaskNode[], order:string[]`；末级节点可带 `shelved`（搁置）与 `doneAt`（完成后 30 秒隐去） |
| linkGroups | `linkGroups.json` | 数组 | `name, items:LinkGroupItem[]`（自定义关联分组；内置「课程」组不落库） |
| trashItems | `trash.json` | 数组 | `originalTable, originalId, originalData, deletedAt` |
| activityEvents | `days/<date>/activity.json` | 按日数组 | 结算用实际交互：`id, date, occurredAt, category, action, entityId, title, from, to, parentId?, parentTitle?`；花园里程碑的旧标题在迁移时转入 `encrypted`，公开字段改为中性文案 |

约定：
- `TimeBlock.focusScore / efficiencyScore`：0–10，0 = 未评分。
- `LongTermGoal.nodes` 存在（含空数组）即长期目标的唯一权威；只有旧数据 `nodes === undefined` 时才把 `tasks` 逐项投影为一级节点，不双写、不回填。大愿望仍只用 `tasks` 保存里程碑。
- `GoalNode.completed` 只有叶节点生效；父节点进度等于直接子节点进度的算术平均，逐层递归。旧 `weight` 保留但不参与计算；显示最多三位小数，未完成不会舍入到 100%。目标名称为地图根，`nodes` 是其直接子节点，`description` 用于附件线索。
- 目标文本使用 TODO 的 `- 标题` + Tab 格式；格式错误/层级跳跃提示行号而不丢弃。节点优先按完整路径与重复序号匹配，改名在可靠的同父位置匹配；保留 ID、完成记录及旧元数据，不清理已完成目标。
- `TaskItem.id` 为字符串；其余表主键 `number`；`TrashItem.originalId` 为 `number|string`。
- `TaskNode` 只有末级节点的 `done` 有意义；末级用完整链 `a/b/c` 标识。
- `DdlLink` 存的是**快照**（`kind, id, label, groupName`）：课程/分组被删后 DDL 仍显示当时的名字。
- `ActivityEvent` 有两类来源：操作时由 `mutate` 检测产生（`id` 为随机 UUID），以及启动/导入时按真实时间戳扫描产生（`id` 以 `recovered:` 开头）。日期取设备本地日历；`from/to` 为 0–1 的进度或布尔转换，新建/删除为 `null`。撤销重做按实体累加净变化，跨日先撤后做不会重复计数；同父节点下的成对增删视为改名，不计新建/删除。
- 扫描只采信能证明「什么时候发生」的字段：TODO 叶子的 `doneAt`、DDL 的 `dismissedAt`、灵感的 `createdAt`（含回收站中可解析的记录）。计划块完成、目标节点推进、大愿望里程碑、TODO 新建都没有完成/创建时间，不推算，也不用 `updatedAt` 冒充。扫描按「类别+动作+实体+日期」与实时事件对齐：同一件事两边都有时保留实时事件，重复启动与重复导入都幂等。
- `todayStr()` 为设备本地日历日期；全屏日程同用它判断今天，凌晨不再偏到前一天。
- `Course.semesterStartDate?` 保存所属学期开学日期。旧课程（含回收站）首次加载时补当前学期，未设置学期的在首次设置时补；切换学期不重绑；导入旧备份按备份自身学期补齐。
- **秘密花园加密**：每条愿望或倾述生成独立 AES-256-GCM 内容密钥加密全部内容（含 `nodes`、`gardenEntry` 与未知自定义字段），再用该 `keyId` 对应 RSA-OAEP-3072 公钥包裹内容密钥。私钥 PKCS8 由 PBKDF2-SHA256（310000 次）派生密钥以 AES-GCM 封装，只存密文信封；解锁后的私钥仅驻留内存。`gardenKeys` 按 `keyId` 合并，数字主键冲突不覆盖新信封；导入不同口令的备份可各自保留密钥，未持有对应口令的内容隐藏且禁止覆盖。更改口令只重包私钥，不改任何愿望或倾述密文。
- 旧数字密码迁移前必须先通过原摘要校验；迁移成功后删除旧 `dailynote_garden_lock`。旧明文愿望、回收站愿望与历史活动标题在一次持久化写入中转为密文；失败则恢复内存原值并保留旧验证信息。存在未迁移明文时禁止导出备份并跳过新快照缓存，避免明文被缓存或带出。已导出到应用外部的旧备份无法追溯改写，只能由用户自行销毁。
- **隐藏入口**：花园不挂在目标页、公开设置或侧栏；只有全局搜索框的原始值恰为 `秘密花园 `（末尾一个半角空格；不去空格，不接受全角空格、制表符、多余空格或其他文字）时，才返回「秘密花园」与「花园设置」两条入口。入口是发现手势，不是认证；真正的内容保护仍靠密码短语与加密。
- **倾述**：与愿望共用加密表，`kind: wish`、`gardenEntry: confession` 只存在密文内；公开壳、备份明文、全局搜索、公开回收站都看不到标题或正文。倾述不要求标题、没有截止日期、里程碑或完成状态，按创建时间倒序回看；收起后 30 天内只在门内设置里恢复。
- **公开隔离**：`/goals` 只取非 wish 条目；`useTrash` 与公开回收站过滤 wish；「清空回收站」只清公开内容，花园条目保留给门内处理；全局内容搜索直接跳过 wish。

---

## 6. 存储

`services/store.ts` 是唯一持久化实现（约 1185 行）。

### 6.1 布局

```
Documents/<dir>/
├── days/<YYYY-MM-DD>/{plan,reflections,harvests,tasks,activity}.json
│     activity.json = 那天实际发生过的交互（结算数据源）
├── goals.json  routines.json  templates.json  courses.json
├── semester.json  ddls.json  important.json  backlog.json
├── taskboard.json  linkGroups.json  trash.json  garden-keys.json
└── dailynote-backup-<时间戳>.json     （导出存档，不参与读取）
```

Web 端以同一相对路径为 IndexedDB KV 键（库 `dailynote_kv`）。跨模块共享的 `StoreShape` / `StorageData` / `AnyStoreTable` 定义在 `types/storage.ts`，纯类型不反向依赖存储实现。

### 6.2 写入

| 环节 | 行为 |
| --- | --- |
| 变更入口 | `mutate(fn, {writeOrder, activityIntent, skipActivity})`：前后指纹对比，只写变脏文件；同时按前后 store 差异生成当日交互事件 |
| 入队 | 入队瞬间捕获 `{目录, 待写文件}`；单条 promise 链串行 |
| 全量保存 | 包含 ideas.json 与 activity.json；成功写完所有文件后，仅删除 days/YYYY-MM-DD 下不在当前数据中的 plan/reflections/harvests/tasks/activity.json，保留自定义文件和备份 |
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
| 3 | 日期和根分类文件名集合与快照一致 → **直接用快照数据**，零文件读取 |
| 4 | 日期或根分类文件名集合变化（新增/删除）→ 全量读取并刷新快照 |
| 5 | 运行期每次写盘后 400ms 防抖刷新快照；`flush()` 会等待快照写完成 |
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
- `originalTable` 13 种：longTermGoals、reflections、harvests、fixedRoutines、taskItems、taskTemplates、courses、ddls、important、backlog、ideas、linkGroups、timeBlocks。
- `timeBlocks`：原数据存 `{date, ...block}`，还原时 push 回当天计划。

### 6.6 导入导出

- 导出：单 JSON 备份包（`version:1`）。
- 导入：剥 BOM → 校验（空 / 非 JSON / 损坏 / 缺 `version`+`dailyPlans`）→ 纯合并（存在则更新，永不删除）。
- 兼容：16 张表缺字段均兜底空数组；`courses` 额外归一化 `dayOfWeek`。
- 交互记录按不可变事件 ID 去重合并：同一份备份反复导入不会重复计数；旧备份没有 `activityEvents` 时视为空，不伪造历史。

---

## 7. 运行时

Boot 四阶段：`loading` → `setup`（首次选目录）→ `storagePermission`（授权引导）→ `ready`。

```
UI → hooks → db/index.ts（内存 CRUD）→ mutate → store.ts → 文件 / KV
```

- 无全局状态库；每页自持 Hook 状态。
- 更新策略：修改类先 setState 后写库；创建/删除类先写库后 setState。
- 跨页通知：`window` 事件 `dailynote-ddl-changed`、`dailynote-important-changed`、`dailynote-backlog-changed`、`dailynote-task-changed`、`dailynote-ideas-changed`、`dailynote-activity-changed`、`dailynote-open-tasks`。杂念的增删改与回收站还原都会广播 `dailynote-ideas-changed`，各页 `useIdeas` 实例立即重读，不等页面重新挂载；`mutate` 产生新交互记录时广播 `dailynote-activity-changed`，打开着的结算页随之重绘。

---

## 8. Hooks

| Hook | 返回 |
| --- | --- |
| useDailyPlan(date) | plan, loading, addBlock, addFullBlock, updateBlock, removeBlock, importFromRoutine, reload |
| useTaskBoard() | nodes, leaves, undone, loading, saveTree, toggle, remove, reorder, reload |
| useTaskBadge() | count |
| useGoals() | goals, loading, addGoal, addWish, setWishStatus, updateGoal, removeGoal, addTask, toggleTask, removeTask, reload；更新返回是否落盘成功；只返回当前已解锁密钥可解的花园内容，保存时再加密 |
| useGardenEntries() | entries（仅倾述）、loading、error、reload、save、archive；保存时写入加密愿望表，可无标题 |
| useReflections(date) | reflections, loading, addOrUpdate, remove, getByPeriod, reload（另导出 useAllReflections） |
| useHarvests(date) | harvests, loading, addOrUpdate, remove, getByPeriod, reload（另导出 useAllHarvests） |
| useBacklog() | items, loading, addItem, updateItem, changeStatus, removeItem, reload |
| useIdeas() | ideas, byKind, countByDate, addMind, updateIdea, removeIdea, reload；监听 `dailynote-ideas-changed` |
| useBacklogBadge() | count |
| useDdlBadge() | count（剩余 < 7 天） |
| useImportantBadge() | count（剩余 < 3 天且未收起） |
| useTrash() | items, loading, restore, permDelete, clearAll, reload |
| useLinkGroups() | groups, loading, addGroup, removeGroup, addItem, removeItem, reload（DDL 关联的自定义分组） |
| usePreferences() | prefs（含 `futureOnly` 只看未来、课程时间组合）、updatePrefs、resetPrefs；更新广播到同页面消费者，从最新持久化值合并 |

---

## 9. 组件

| 组件 | 行 | 职责 | 使用方 |
| --- | --- | --- | --- |
| DeadlineListPage | 689 | 截止事项列表页（DDL 与重要的事共用，文案参数化；`allowLinks` 控制是否有关联） | DdlPage、ImportantPage |
| LinkPicker | 234 | 关联内容选择器：内置「课程」组（本学期有效课程，随课程表同步）+ 自定义分组增删 | DeadlineListPage |
| TaskBall | 390 | 任务悬浮球（可拖动）+ 清单面板 + 层级/文本填写；勾掉最后一条未完成时弹庆祝 | App |
| CelebrationDialog | 150 | 清单全部完成的庆祝弹窗（内联 SVG 插画 + 随机走心文案 + 纸屑动画） | TaskBall |
| GoalPlanEditor | 202 | 三行目标编辑 + 独立全屏层级/文本内容编辑（四键和完成）、草稿保护；完成记录不清理 | LongTermGoals |
| GoalMap | 77 | 全屏目标地图：双翼脑图 + 钻取、面包屑回退、叶勾选、折叠文字目录；共用 GoalPlanEditor.css | LongTermGoals |
| PlanMindmap | 205 | Canvas2D 双翼脑图：中心节点 + 左右交替分支、彩色连线、进度条、拖动/双指缩放/适配视图；点分支钻取、点末级完成 | GoalMap |
| MindSheet | 425 | 杂念底部面板：小愿望 / 琐事 / 灵感三型，页头按当前类型显示；灵感的 `…` 进入可改标题、详情、标签的独立编辑页 | DailyPlan、Harvest、TaskBall |
| FullscreenSchedule | 306 | 全屏日程网格 | DailyPlan |
| AvatarCropper | 297 | 头像裁剪 | SettingsPage |
| GardenGate | 102 | 花园解锁/首次加密：验证旧数字密码、迁移、切后台或离开即清空内存密钥并卸载明文；改密后提示用新口令重进 | App `/garden/*` |
| GardenSecuritySettings | 46 | 花园加密状态、更改口令（成功后清空输入并上锁） | GardenPage `/garden/settings` |
| GardenWishes | 500 | 门内愿望：摘要/展开、里程碑、状态与编辑表单 | GardenPage |
| GardenConfessionEditor | 74 | 倾述书写面：可无标题、只保存正文、未保存离开确认 | GardenPage |
| CourseEditModal | 233 | 课程新建/编辑 | CoursesPage、WeekViewPage |
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
| WeekViewPage | 七天同屏，计划/课程块竖排前五个 Unicode 字符，完整名称保留；点空白/任务块进入对应日期编辑（等待目标计划加载后消费查询参数），课程打开课程编辑；睡眠折叠 |
| DdlPage / ImportantPage | 共用 DeadlineListPage：地点、Markdown 备注（编辑/预览）、图片查看（Lightbox）、图片识别（识别全部备注图片）、解除威胁；**关联内容只有 DDL 有**（`allowLinks`，重要的事关闭）；重要的事三天气泡 + 过期一天收起 |
| BacklogPage | 阻塞中/可推进/已解决/已终止；起始三态（距今/日期/文字）；历时排序；一周宽限气泡 |
| LongTermGoals | 只做长期目标：摘要点击进入全屏目标地图；新建/编辑为三行页面（名称、全屏 TODO/Markdown 树内容、附件线索）；地图从目标根进入一级节点并逐层钻取，每个节点显示等权递归完成度；不显示愿望，也没有花园入口 |
| GardenPage | 独立隐藏花园：门内欢迎、倾述题名/正文编辑与回看、愿望页签、门内设置（改口令、恢复收起内容）；无侧栏/底栏；底部可回门内设置 |
| Reflection / Harvest | 三段式反思；收获 #标签；均支持 `?date=` |
| Settlement | 全屏结算：按 TODO / DDL / 每日计划 / 长期目标 / 大愿望里程碑 / 杂念分门别类，只渲染非零项；数据来自 `activity.json`，`buildSettlement` 按实体累加当日净变化；支持 `?date=` 指定日期（计划页把当前选中日期带过来），顶部日期可改选，非今天显示「当日结算」；Canvas 海报优先长图、超长自动分页（每页 ≤4096px / 400 万像素）、文字测量裁剪、可滚动查看并附文字明细；Android 返回键回到对应日期的计划页 |
| Trash / BackupRestore / SettingsPage / SetupPage | 回收站（不含花园内容）；导入导出与路径；四组偏好；首次目录选择 |

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
| 1500 | 全屏结算海报 Settlement |

---

## 12. 测试

`npm test`：48 文件 / 799 用例。

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| 时间网格点击映射/clickMapping | 207 | 像素↔时间正反映射、密度、滚动补偿 |
| 数据存储/store | 53 | CRUD、persist、迁移、自愈、导出、课程/DDL 存储 |
| 课程表/courseSchedule | 36 | 周次、单双周、节假日、当日课程 |
| 数据导入导出/jsonImport | 23 | 解析、BOM、乱码拒绝、错误分级、往返 |
| 任务/taskTree | 32 | 文本⇄层级、完整链、状态回填、删除、排序、行后插入与空行过滤 |
| 遗留问题/backlog | 20 | CRUD、回收站、持久化、历时与宽限 |
| 搜索/search | 22 | 内容命中、路由、不命中界面文案与日期、DDL 阈值、目标树深层节点与大愿望文案 |
| 任务清单/taskList | 18 | 创建、切换、排序、日期隔离 |
| 时间网格点击映射/foldedGrid | 18 | 多段折叠几何与块渲染 |
| 时间网格点击映射/futureWindow | 19 | 只看未来：折叠起点、映射与反算、跨起点块、边界与密度 |
| 任务/celebration | 7 | 全部完成庆祝的判定（最后一条才弹） |
| 偏好设置/avatarCrop | 17 | 缩放、钳制、裁剪矩形 |
| 灵感/ideas | 11 | ideas.json 往返、排序、更新、回收站还原、导出导入、杂念变更事件 |
| 识别/extract | 41 | 全角、补年份、相对日期、地点防误判、要求/邮箱、去重与冲突、图与图冲突、状态栏时钟与界面噪声回归 |
| 重要的事/important | 16 | CRUD、回收站、持久化、三天阈值、过期收起 |
| 时间网格点击映射/blockRenderRect | 16 | 睡眠折叠下的块矩形 |
| 偏好设置/preferences | 15 | 默认值、存取、主题 |
| DDL清单/ddlTime | 20 | 剩余分钟、23:59 默认、文案边界、解除威胁的分组与倒计时 |
| 课程表/effectiveCourses | 15 | 有效课程：学期前提、周期边界、单双周、排序 |
| DDL清单/ddlLinks | 15 | 关联项生成/切换/去重/展示文案 |
| DDL清单/linkGroups | 8 | 关联分组 CRUD、回收站、落盘、导入导出、DDL 关联快照 |
| 任务清单/taskTemplate | 13 | 模板 CRUD、软删除、持久化、套用 |
| DDL清单/markdownAndLocation | 10 | Markdown 语法、XSS 转义、地点往返 |
| 数据存储/readIsolation | 3 | db 返回深副本，调用方改对象不会绕过 mutate |
| 数据存储/storeSchema | 3 | 注册表覆盖全部表、文件与写序唯一、数字主键齐全、交互记录按日表排除 |
| 数据存储/storageAccess | 8 | 权限守卫、阻塞时零写入 |
| 数据存储/nativeWriteEncoding | 3 | 原生写入 utf8 与往返 |
| 数据存储/startupSnapshot | 7 | 快照命中、日期/分类文件名变化失效、外部内容重扫、换目录不复用 |
| 数据存储/knownDebt | 9 | 回收站 ID、杂念全量写、孤儿文件安全清理、课程归属迁移/导入/还原、仓库备份往返 |
| 偏好设置/localDate | 5 | 本地凌晨、跨年、晚间日期；另在洛杉矶时区进程验证 |
| 课程表/courseEditSemester | 4 | 新建当前学期、编辑保留归属、无学期兼容、旧课兼容 |
| 课程表/coursesPageSemester | 3 | 当前课表过滤、历史课空态、列表保留历史归属 |
| 长期/wish | 10 | 大愿望字段往返、与目标共存、旧数据无 kind、里程碑、状态落盘、回收站还原、编辑保留原 ID |
| 长期/goalTree | 27 | 西湖三分支递归等权进度、每层完成度、空树、旧任务投影、`nodes: []` 权威、文本格式校验、改名/重排保留节点状态 |
| 长期/goalsPage | 6 | 目标页无花园线索；门内愿望收起/展开、摘要编辑、空里程碑状态 |
| hiddenGarden | 2 | 精确尾随空格才显示两条入口；倾述加密、备份、公开搜索/回收站隔离、收起与恢复 |
| gardenEncryption | 4 | 旧密码迁移、独立密钥信封、取消解锁、大文本往返与改密不改密文 |
| dailyPlanNavigation | 3 | 跨日期 `?block=` 等待计划加载后消费，不被旧计划提前清掉 |
| weekViewNavigation | 4 | 前五个 Unicode 字符、鼠标与键盘打开正确日期详情 |
| 偏好设置/preferencesSync | 2 | 偏好更新从最新持久化值合并并广播到其他消费者 |
| 长期/gardenTrashPrivacy | 1 | 公开回收站即使收到花园条目也不渲染标题，普通条目照常显示 |
| 长期/goalEditor | 6 | 三行编辑、全屏层级/文本编辑、格式错误、完成状态、草稿保护、保存失败重试、目标地图钻取/回退 |
| 长期/mindmap | 3 | 双翼左右分布、卡片不重叠与边界、空树命中 |
| 数据存储/settlement | 10 | 本地日期、事件唯一 ID、改名不误计增删、净进度、杂念完成与普通删除、DDL/里程碑、日期 JSON/备份往返、零值隐藏、花园不进入公开结算 |
| settlementPoster | 14 | 长海报优先与分页、三种宽度、459 条不越界、文字测量裁剪、空状态、空/非法页码 |
| **全量** | **799** | **48 个文件** |

环境：`npm test` 使用 vitest.config.mjs + native 配置加载器 + threads 池；测试独立于应用 PWA 构建配置。上表列主要测试文件，合计为整轮实际结果。

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
- `scripts/build-apk.ps1` 为 Windows 脚本，使用外部 JAVA_HOME/PATH 与 ANDROID_SDK_ROOT/ANDROID_HOME 或 android/local.properties，不覆盖本机工具链；Gradle 使用 --no-daemon。
- CI：`.github/workflows/build-apk.yml` 先 npm test，再直接执行 tsc / Vite / cap sync android，最后构建 debug APK；Ubuntu 不再调用 Windows PowerShell 脚本，测试改动也触发。

---

## 14. 约束

1. 磁盘只由 `store.ts` 触碰；UI 与 CRUD 只读写内存 store。
2. 数据文件变更立即进入串行写队列；运行期快照刷新采用 400ms 防抖，`flush()` 会等待快照写入完成。
3. 权限阻塞时禁止任何写操作。
4. 删除一律软删除；`originalTable` 与 `restoreFromTrash` 分支必须同步。
5. 持久化分类表的文件名、写入顺序、数字主键和空 store 由 `services/storeSchema.ts` 统一注册；新增表仍需同步更新领域类型、解析/合并、搜索和回收站语义。

---

## 15. 兼容保留与剩余限制

2026-10-28 已修复：本地日期、回收站 ID 占用、全量保存孤儿日期文件清理、杂念全量写入、课程学期归属、分数注释、图标引用；已删除 TimeBlockCard、未消费的 useTaskList/useTaskTemplates Hook 和 recharts 依赖。

| 项 | 当前策略 / 限制 |
| --- | --- |
| 旧任务/模板/作息数据 | 保留 taskItems、taskTemplates、fixedRoutines 的读写、备份与回收站兼容；不新增创建功能。日计划仅有历史作息数据时显示导入按钮，不再引导去不存在的创建入口。历史时间块清单仍可编辑、勾选并按子项判定完成，不自动重写时间范围。 |
| ID | 重建扫描活表和回收站，同会话不降低计数；已永久删除且回收站不再保留的历史 ID 没有跨安装高水位记录。 |
| 快照 | 仍按日期集合复用，同名文件内容被外部修改后须手动重新扫描。 |
| 文件写入 | 有串行队列和跨文件写序，但没有文件级原子替换或跨文件事务。 |
| 旧课程归属 | 无法从旧数据推断真实历史学期，首次升级按当时设置的学期归属；此后切换不重绑。列表保留历史课，课表、日/周视图和 DDL 有效课程按当前归属过滤。 |
| 测试类型 | 应用 tsc 检查 src；新增测试单独通过类型检查，全部历史测试尚未纳入严格类型检查。 |
| Android | 仍需公共 Documents 的所有文件访问权限；本轮 APK 构建通过，未做真机安装验收。 |
| NDK / VLM | 属于延期能力，不为清债安装工具链或下载/接入新模型；现有离线 ML Kit 保持使用。 |

## 2026-11 知识地图补充

- 课程内嵌知识地图，不新增独立路由；`CoursesPage` 的课程卡打开 `KnowledgeMapPanel`。
- `StoreShape.knowledgeMaps` 对应 Android `knowledge-maps.json` 与 Web IndexedDB；一个课程 `courseId` 只绑定一张地图。课程删除不级联删除地图。
- `KnowledgeMapPanel` 负责树视图、默认折叠、节点状态、Markdown 重建、末端笔记、思维导图预览和 Markdown 下载；纯解析与笔记触发规则在 `utils/knowledgeMap.ts`。
- `KnowledgeNode.status` 是独立的 `todo/debt/learned`，不计算父子进度；切到 `learned` 时提供一次轻音效和闪光。
- 知识笔记使用 `KnowledgeNote.blocks` 保存；行末三个或更多 ASCII 半角空格表示 checklist，文本不进入全局隐私内容之外的特殊表；方框正文被 `utils/search.ts` 索引，点击搜索结果带 `knowledgeCourse`/`knowledgeNode` 查询参数回课程面板。
- `utils/knowledgeNoteRender.ts` 使用 KaTeX 阅读态渲染；用户原文仍保存，普通文本先 HTML 转义，公式失败时回退为转义原文。
- 思维导图预览是知识树的具象化视图，叶节点笔记摘要挂在分支下；下载格式为包含层级与笔记的 Markdown，可用于其他文本/思维导图工具的再加工。

## Android 系统栏安全区（2026-11-14）

- `targetSdk 36` 下 Android 15+ 强制 edge-to-edge，WebView 会绘制到状态栏和导航栏下面。
- `MainActivity` 在 `SDK_INT >= 35` 时监听内容根视图的 `systemBars()` 与 `displayCutout()` Insets，并把 left/top/right/bottom 设为根视图 padding；旧系统保持原有窗口布局，避免重复内缩。
- CSS 统一使用 `--safe-top/right/bottom/left` 变量（默认取 `env(safe-area-inset-*)`，兼顾 iOS 与 Web）；Android 原生 inset 生效时由 `main.tsx` 将四个变量置 0，避免原生 padding 与 CSS env 双层留白。
- 该处理是窗口级，只保留一层系统栏留白；卡片页面仍固定视口、不产生纵向长页面。

## 2026-11-14 卡片收集器与知识树引用

- 卡片本体独立于知识树：`knowledge-cards.json` 是单例卡片库（`KnowledgeCardLibrary.records`），每张卡片的内容是有序的 `KnowledgeCardContent[]`，类型只有文字、图片、录音三种，不再有独立备注字段。
- 反思页提供「卡片收集器」入口；先在收集器创建、编辑卡片，再把卡片关联到某个课程知识树的末端节点。知识节点只保存 `cardIds: string[]`，因此移动卡片只改知识树引用，不会移动或复制卡片内容。
- 卡片在收集器中可再次「关联 / 移动」到其他末端节点；一个卡片可被多个节点引用，删除节点只删除引用，删除卡片才删除本体并清理全部引用。
- 旧数据迁移：启动时 `initializeKnowledgeCards()` 把旧 `node.cards`、`node.note.blocks` 转为独立卡片记录（图片在前、旧文字在后，勾选标记保留为文字），成功写盘后才移除旧字段；纯迁移函数见 `utils/knowledgeMigration.ts`。
- 卡片编辑器（`KnowledgeCardEditor`）单页只显示一条内容，左右滑动或箭头切换；`+` 点击添加文字，长按开始录音，图片按钮走压缩上传。录音使用 MediaRecorder，导出由 `utils/knowledgeCards.ts` 写入 `Music/DailyNote`（Android ExternalStorage，失败回退 Documents；Web 下载），目录可在收集器调整。
- 知识树编辑器仍保留节点重命名、长按/更多菜单、多选、删除、复制、合并、移动；合并与移动按 `cardIds` 处理引用顺序。

## 2026-11-14 收集器列表规则

- 卡片收集器用日期菜单切换有卡片的日期；同一天默认倒序，可切换升序；内部支持标题/文字/录音文件名关键词筛选。
- `groupCardsByDate`、`dateGroupLabel` 位于 `utils/knowledgeCards.ts`，日期使用设备本地日历。
- `DayNavigator` 的 `marks` 支持 `markTone`；反思页用绿色角标统计各日反思数，选中日期也保持绿色；收获页灵感沿用默认色。

### 卡片内容评论（2026-11-14）

- `KnowledgeComment { id, text, images, createdAt, updatedAt }` 挂在 `KnowledgeCardContent.comments`，不是卡片级；内容删除时评论自然级联删除。
- `KnowledgeCardEditor` 在每条内容右下角渲染评论悬浮球，数字为评论数；`KnowledgeCardComments` 负责文字/图片发表、编辑、删除与图片全屏。
- `cardSearchText` 同时匹配评论文字，收集器关键词筛选可以命中评论。

## 2026-11-16 启动快照匹配

- 快照 `files` 可能是全部类别文件名，而磁盘只存在实际写过的文件；匹配时只要求磁盘现有类别文件被快照覆盖，`filesCover` 负责这一判断。
- 启动只读一次快照；花园明文检查在快照读取后做，发现明文即丢弃快照并全量读。
- 写入仍由 `mutate` 指纹差异决定，只写变脏文件；启动读取与写入增量是两条独立路径。

## 漫步
/wander 为只读回顾页。wanderDeck 整理卡片与灵感、洗牌和日期筛选；Walk 管理筛选与原文对话框；WalkMotion 用稳定卡位与连续位移处理手势。

### 漫步的编辑层（2026-11-18）

- `Walk` 的详情 `<dialog>` 上再点一次正文或点铅笔，打开 `WalkEdit` 全屏层并清空详情。
- 知识卡片直接复用 `KnowledgeCardEditor`；灵感由 `WalkEdit` 内部表单编辑标题/正文，保存后写回 `saveIdea`。
- `WalkEdit`/卡片编辑器注册返回键；关闭编辑层后仍停留在 `/wander` 的当前卡堆。

## 卡片类型
KnowledgeCard.type 缺省按知识展示；KnowledgeCardLibrary.customTypes 保存自定义词条。CardTypeMenu 通过串行事务增删词条，删除词条不更改卡片。评论确认与时间戳由 KnowledgeCardComments 管理。

## 反思入口收束
Reflection 仅包含日期导航、灵感与卡片收集器；MindSheet 承载灵感增删改、标签与返回；useIdeas 提供计数广播。Harvest 页面已删除，旧路由只重定向；reflections/harvests 表保留导入导出兼容。
