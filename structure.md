# DailyNote 项目结构文档

> 计划·反思·收获 — 三位一体的日程管理系统
> 技术栈：React 18 + TypeScript + Vite + Capacitor (Android) + Dexie.js (IndexedDB)

---

## 目录树

```
dailynote/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── capacitor.config.ts
├── .gitignore
│
├── public/
│   └── icons/icon.svg                        # PWA/App 图标源
│
├── resources/
│   └── icon.png                              # svg2png.mjs 生成的安卓图标
│
├── scripts/
│   ├── svg2png.mjs                           # SVG → PNG 图标转换
│   ├── setup-keystore.sh                     # Android 签名密钥生成
│   └── build-apk.ps1                         # PowerShell APK 一键构建脚本
│
├── .github/
│   └── workflows/
│       └── build-apk.yml                     # GitHub Actions CI
│
├── android/                                  # Capacitor Android 原生项目（含自定义 DailyNoteStoragePlugin：「所有文件访问」权限桥）
│
├── test/
│   ├── 时间网格点击映射/clickMapping.test.ts  # 207 tests
│   ├── 数据导入导出/jsonImport.test.ts        # 23 tests
│   ├── 偏好设置/preferences.test.ts          # 15 tests
│   ├── 偏好设置/avatarCrop.test.ts           # 17 tests
│   ├── 任务清单/taskList.test.ts             # 18 tests
│   ├── 任务清单/taskTemplate.test.ts         # 13 tests
│   ├── 数据存储/store.test.ts                # 52 tests
│   ├── 课程表/courseSchedule.test.ts         # 32 tests
│   └── DDL清单/ddlTime.test.ts               # 13 tests
│
└── src/
    ├── main.tsx                              # React 挂载入口（Boot 四阶段 loading/setup/storagePermission/ready → SetupPage 或 App）
    ├── App.tsx                               # 根组件：路由 + TabBar + SideNav + 主题应用
    ├── App.css                               # 全局样式、CSS 变量、深色主题、通用工具类
    ├── vite-env.d.ts
    │
    ├── types/
    │   └── index.ts                          # 所有数据模型类型 & genId/todayStr & normalizeCourseDayOfWeek
    │
    ├── utils/
    │   ├── time.ts                           # 时间工具函数（toMinutes, sleep判断, blockRenderRect 块渲染矩形, foldedGrid 多段折叠网格）
    │   ├── avatarCrop.ts                     # 头像裁剪纯函数（cover/钳制/缩放/裁剪矩形 + canvas 输出）+ 备注图片压缩（DDL）
    │   ├── ddl.ts                            # DDL 截止时间纯函数（minutesUntilDeadline / ddlRemainText）
    │   ├── holidays.ts                       # 内置法定节假日表（2026 精确/2027 部分推定，需逐年更新）
    │   └── courseSchedule.ts                 # 课程表日程计算纯函数（周次/单双周/节假日/当日课程）
    │
    ├── db/
    │   ├── index.ts                          # 内存 CRUD（file-authoritative，签名兼容旧版）
    │   └── legacy.ts                         # 旧版 Dexie 库（仅升级时一次性迁移）
    │
    ├── services/
    │   ├── store.ts                          # 权威存储：内存 store + 立即写回 + 双后端 + 一次性迁移
    │   └── storage.ts                        # 兼容 facade（旧导出名转发到 store.ts）
    │
    ├── contexts/
    │   └── BackButtonContext.tsx              # Android 返回键全局上下文
    │
    ├── hooks/
    │   ├── useDailyPlan.ts                   # 每日计划数据
    │   ├── useGoals.ts                       # 长期目标数据
    │   ├── useReflections.ts                 # 反思数据
    │   ├── useHarvests.ts                    # 收获数据
    │   ├── useTaskList.ts                    # 任务清单数据
    │   ├── useTaskTemplates.ts               # 任务清单模板数据
    │   ├── useStats.ts                       # 统计数据计算
    │   ├── useTrash.ts                       # 回收站数据
    │   └── usePreferences.ts                # 用户偏好（localStorage，含主题/用户名/头像）
    │
    ├── components/
    │   ├── TabBar.tsx / .css                 # 底部三标签导航栏
    │   ├── SideNav.tsx / .css                # 左侧导航栏（菜单 + 设置按钮）
    │   ├── SideMenu.tsx / .css               # 左侧滑出菜单面板
    │   ├── DayNavigator.tsx / .css           # 月历日期选择器（支持 compact 模式）
    │   ├── CalendarHeatmap.tsx / .css        # GitHub 风格打卡热力图
    │   ├── FullscreenEditor.tsx / .css       # 全屏编辑器（收获/反思页使用）
    │   ├── FullscreenSchedule.tsx / .css     # 全屏日程视图（Portal 渲染）
    │   ├── CourseEditModal.tsx / .css        # 课程新建/编辑弹窗（课程表页与周视图共用）
    │   ├── AvatarCropper.tsx / .css          # 头像裁剪弹窗（Portal、拖动/捏合/滚轮缩放、圆形遮罩）
    │   ├── PreferencePanel.tsx / .css        # 偏好设置底部面板
    │   ├── TimeBlockCard.tsx / .css          # 时间块折叠卡片（历史遗留）
    │   └── TrendChart.tsx                    # Recharts 趋势折线图
    │
    └── pages/
        ├── DailyPlan.tsx / .css              # 首页：日计划时间网格 + 即时规划 + 清单模式 + 课程块只读展示
        ├── SettingsPage.tsx / .css           # 设置：头像（emoji 或图片裁剪）/用户名/主题/偏好
        ├── CoursesPage.tsx / .css            # 课程表：周课表 CRUD（星期多选/单双周/周数）+ 学期设置 + 特殊日期 + 列表/课表双视图
        ├── WeekViewPage.tsx / .css           # 周视图：独立通用周日程（课程按周同步 + 当天计划任务块，任意周导航）
        ├── TaskListPage.tsx / .css           # 任务清单：按日浏览、添加/勾选/删除
        ├── DdlPage.tsx / .css                # DDL 截止清单：名称+分钟级截止+多图长备注，删除进回收站
        ├── LongTermGoals.tsx / .css          # 长期目标 & 子任务拆解 & 作息模板
        ├── Reflection.tsx / .css             # 反思记录
        ├── Harvest.tsx / .css                # 每日收获
        ├── Dashboard.tsx / .css              # 宏观视图
        ├── Trash.tsx / .css                  # 回收站
        ├── BackupRestore.tsx / .css          # 数据备份与恢复
        └── SetupPage.tsx / .css              # 首次使用设置向导
```

---

## 一、项目概述

DailyNote 是一款**面向个人日程管理与复盘**的移动端应用（PWA + Android APK）。核心理念为"计划 → 执行 → 反思 → 收获"的闭环：

| 模块               | 功能                                                                                                               | 路由            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------- |
| **每日计划** | 24h 时间网格，睡眠时段折叠，全屏视图，即时/预规划双模式，清单子任务                                                | `/`           |
| **任务清单** | 按日待办列表，添加/勾选/删除，待完成与已完成分组                                                                   | `/tasks`      |
| **课程表**   | 周课表（星期多选、单双周、周数）、开学时间、特殊日期（放假/补课）、列表/二维课表双视图；当天有课直接显示在日程网格 | `/courses`    |
| **周视图**   | 独立通用周日程（任意周导航）：课程按具体周忠实过滤同步 + 当天计划任务块只读展示 + 节假日角标                       | `/week`       |
| **DDL 截止清单** | 收录带截止时间的事项：名称、截止日期+时间（精确到分钟）、备注（长文字 + 最多 9 张压缩图片）；按截止升序、过期红色徽章；删除进回收站 | `/ddl`     |
| **长期目标** | 目标分类、子任务拆解、进度追踪、作息模板                                                                           | `/goals`      |
| **反思**     | 上午/下午/晚上三段式反思（问题→原因→改进）                                                                       | `/reflection` |
| **收获**     | 每日知识收获，支持`#标签` 分类                                                                                   | `/harvest`    |
| **宏观视图** | 统计卡片、热力图、趋势图、高频词                                                                                   | `/dashboard`  |
| **回收站**   | 30天软删除、还原、永久删除                                                                                         | `/trash`      |
| **备份恢复** | 文件导入导出、存储路径设置                                                                                         | `/backup`     |
| **设置**     | 主题（浅色/深色/跟随系统）、头像、用户名、默认偏好                                                                 | `/settings`   |

---

## 二、数据库架构

### 权威存储（file-authoritative）

**数据唯一来源**：用户指定目录里的 JSON 文件（**按日期文件夹 + 类型文件组织**，不再是单一数据文件），不在应用沙箱（IndexedDB）里。运行时内存 store 只是文件的实时投影，每次变更立即写回。

**存储布局**（分门别类，可维护性好）：

```
Documents/<dir>/
├─ days/                      ← 每天一个文件夹
│  ├─ <YYYY-MM-DD>/
│  │  ├─ plan.json            ← 当天计划（单个对象，含时间块）
│  │  ├─ reflections.json     ← 当天反思（数组）
│  │  ├─ harvests.json        ← 当天收获（数组）
│  │  └─ tasks.json           ← 当天任务清单（数组）
│  └─ …
├─ goals.json                 ← 长期目标（数组）
├─ routines.json              ← 固定作息模板（数组）
├─ templates.json             ← 任务清单模板（数组）
├─ courses.json               ← 课程表课程（数组）
├─ semester.json              ← 学期设置（单记录数组，id 恒 1）
├─ ddls.json                  ← DDL 截止清单（数组）
└─ trash.json                 ← 回收站（数组）
```

```
用户目录文件（唯一数据源）←── 立即增量写回 ── 内存 store（实时投影）── 查询 ── UI
        ↑
 启动时 initStore() 读入 + 一次性迁移（旧单文件→新布局、旧 Dexie→文件，成功后删除旧数据源）
```

- **模块**：[services/store.ts](src/services/store.ts) 维护内存 store、持久化队列（**只写变脏的文件**，入队时捕获 `{dir, 待写文件列表}` 快照）、双后端（Capacitor 文件 / Web IndexedDB KV）、路径管理、一次性迁移、加载自愈、**Android 存储权限守卫**（`storageAccessBlocked` 被阻塞时 `initStore` 返回 -2 且不碰内存 store）。
- **CRUD**：[db/index.ts](src/db/index.ts) 所有读写直接作用于内存 store，每次变更立即写回对应文件（无防抖窗口；改当天只写当天文件）。
- **旧 Dexie 库**：[db/legacy.ts](src/db/legacy.ts) 仅用于升级时一次性读取/删除，运行时不再使用。

**数据格式**：`StorageData`（version 1，含 `trashItems` 可选字段，旧文件向后兼容）。导入/导出的备份包仍是单 JSON（可移植），运行期存储是分文件布局。

**关键设计**：

- **增量写**：`mutate()` 先对每张表做指纹快照，变更后对比，只写被改到的文件（日期表按日期分桶；某天变空则删除该文件）
- **跨文件写序**：删除类操作先写"新增"侧（回收站）再写"移除"侧（原表）；还原类操作相反。崩溃中断也不会丢数据
- **加载自愈**：回收站条目若其原数据已在原表存在（删除/还原半提交），加载时丢弃该副本，数据不丢
- 所有删除操作**软删除**：深拷贝 `originalData` 到 `trashItems`，再删原表
- 每表**单调递增 id 计数器**（不复用已删除 id，杜绝与回收站还原撞 id）
- `restoreFromTrash` 按 `originalTable` 分发还原（longTermGoals, reflections, harvests, fixedRoutines, taskItems, taskTemplates, courses, ddls, timeBlocks）
- 时间块还原特殊处理：存入 `date + blockData`，还原时找到对应 `DailyPlan` 并 push 回去
- 每次写回收站自动清理超过 30 天的记录
- **卸载重装恢复**：重新指定同一目录 → `initStore()` 从该目录恢复全部数据（含回收站）

---

## 三、类型系统 [src/types/index.ts](src/types/index.ts)

| 接口               | 关键字段                                                                                                                                              | 说明                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ChecklistItem`  | `id, text, done`                                                                                                                                    | 时间块内的子清单项                                                                                              |
| `TimeBlock`      | `id, startTime, endTime, taskTitle, plannedContent, checklist?, actualExecution, focusScore(0-10), efficiencyScore(0-10), completed, notes`         | 一天中某个时间段的任务。`checklist` 为清单模式子任务，可选；专注/效率是**验收后得分**，默认 0（未评分） |
| `DailyPlan`      | `id?, date, timeBlocks[], createdAt, updatedAt`                                                                                                     | 每日计划                                                                                                        |
| `TaskItem`       | `id, title, completed, date, sortOrder, createdAt, updatedAt`                                                                                       | 任务清单项（全局按日隔离）                                                                                      |
| `LongTermGoal`   | `id?, title, description, category, tasks(GoalTask[]), createdAt, updatedAt`                                                                        | 长期目标                                                                                                        |
| `GoalTask`       | `id, title, completed, createdAt`                                                                                                                   | 子任务                                                                                                          |
| `Reflection`     | `id?, date, period, problem, cause, solution, relatedTaskTitle, resolved`                                                                           | 反思记录                                                                                                        |
| `Harvest`        | `id?, date, period, subject, content, createdAt`                                                                                                    | 每日收获                                                                                                        |
| `FixedRoutine`   | `id?, name, timeBlocks(RoutineBlock[]), isActive, createdAt`                                                                                        | 作息模板                                                                                                        |
| `TaskTemplate`   | `id?, name, items(ChecklistItem[]), createdAt, updatedAt`                                                                                           | 任务清单模板（可复用的可勾选清单）                                                                              |
| `TrashItem`      | `id?, originalTable, originalId, originalData, title, deletedAt`                                                                                    | 回收站项                                                                                                        |
| `DayStats`       | `date, avgFocus, avgEfficiency, completionRate, totalBlocks, completedBlocks`                                                                       | 统计（非持久化）                                                                                                |
| `Course`         | `id?, name, teacher, location, dayOfWeek(number[]，可多选), startTime, endTime, weekType(all/odd/even), startWeek, weekCount, createdAt, updatedAt` | 课程（每周固定时间上课，删除进回收站）                                                                          |
| `SpecialDate`    | `id, date, kind(holiday/makeup)`                                                                                                                    | 手动特殊日期：放假（抑制课程）或补课（按正常上课日对待，覆盖内置节假日）                                        |
| `SemesterRecord` | `id(恒为1), startDate(string\|null), specialDates[], updatedAt`                                                                                      | 学期设置（单记录数组表，不可删除）                                                                              |
| `DdlItem`        | `id?, name, deadlineDate("YYYY-MM-DD"), deadlineTime("HH:mm"), notes, images(dataURL[]，≤9张), createdAt, updatedAt`                                  | DDL 截止事件（删除进回收站）                                                                                    |

工具函数：`genId()`、`todayStr()`、`PERIODS`（上午/下午/晚上常量）、`normalizeCourseDayOfWeek()`（旧数据单数字 dayOfWeek 兼容归一化为数组）、`minutesUntilDeadline()` / `ddlRemainText()`（src/utils/ddl.ts，本地时间语义）。

---

## 四、数据流转

```
用户操作 → Page 组件 → Hook (useXxx) → db/index.ts（内存 CRUD）→ services/store.ts（权威内存 store）
                                                                      ↓ 每次变更立即写回
                                                 用户目录文件（Capacitor）/ IndexedDB KV（Web）
```

- **无后端 / 无 API**：数据的唯一来源是用户指定目录的分文件 JSON（file-authoritative），内存 store 是实时投影，每次变更只写被改到的文件（无防抖窗口）
- **无全局状态库**：每个页面通过自定义 Hook 管理自己的数据状态
- **Web 端**：以 IndexedDB KV（key = 相对路径，与原生文件一一对应）充当"文件"的等价物；支持手动导出/导入
- **一次性迁移**：升级时从旧 Dexie 库并入（按 natural key、更新者胜），持久化成功后删除旧库；旧版单文件 `dailynote-data.json`（Web 为 `dailynote-data` 键）迁移到新布局后删除
- **偏好设置**：独立于业务数据，存储在 `localStorage` 中（`dailynote_preferences`）
- **导入策略**：纯合并（按 natural key 匹配，存在则更新，不存在则新增，永不删除已有数据，保留时间戳）

---

## 五、偏好系统 [src/hooks/usePreferences.ts](src/hooks/usePreferences.ts)

使用 `localStorage`（key: `dailynote_preferences`）：

```ts
interface UserPreferences {
  // 网格偏好
  sleepStart: string;       // 默认 "23:00"
  sleepEnd: string;         // 默认 "07:00"
  hideSleepHours: boolean;  // 默认 true
  defaultDuration: number;  // 默认 60（分钟）
  hourHeight: number;       // 默认 64（px/小时）
  // 外观
  theme: 'light' | 'dark' | 'system';  // 默认 "system"
  // 用户信息
  username: string;         // 默认 ""
  avatar: string;           // 默认 "👤"（emoji）
}
```

Hook 返回 `{ prefs, updatePrefs, resetPrefs }`。修改时实时写 localStorage，支持跨标签页同步（`storage` 事件）。

### 主题系统

- 浅色主题：`:root` CSS 变量
- 深色主题：`[data-theme="dark"]` 覆盖所有颜色变量
- 跟随系统：监听 `matchMedia('(prefers-color-scheme: dark)')` 动态切换
- 通过 `document.documentElement.dataset.theme` 控制

---

## 六、自定义 Hooks

| Hook                     | 文件                | 返回                                                                                         |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------------------- |
| `useDailyPlan(date)`   | useDailyPlan.ts     | `plan, loading, addFullBlock, updateBlock, removeBlock, importFromRoutine, reload`         |
| `useTaskList(date)`    | useTaskList.ts      | `items, loading, addItem, toggleItem, removeItem, reload`                                  |
| `useTaskTemplates()`   | useTaskTemplates.ts | `templates, loading, addTemplate, updateTemplate, removeTemplate, reload`                  |
| `useGoals()`           | useGoals.ts         | `goals, loading, addGoal, updateGoal, removeGoal, addTask, toggleTask, removeTask, reload` |
| `useReflections(date)` | useReflections.ts   | `reflections, loading, addOrUpdate, remove, getByPeriod, reload`                           |
| `useHarvests(date)`    | useHarvests.ts      | `harvests, loading, addOrUpdate, remove, getByPeriod, reload`                              |
| `useStats()`           | useStats.ts         | `dayStats, totalReflections, totalHarvests, streak, getRecentDays, monthlyAvgEfficiency`   |
| `useTrash()`           | useTrash.ts         | `items, loading, restore, permDelete, clearAll, reload`                                    |
| `usePreferences()`     | usePreferences.ts   | `prefs, updatePrefs, resetPrefs`                                                           |

**特点**：

- **乐观更新**：先 `setState` 再 `await` DB 写操作
- **日期驱动**：`useDailyPlan`、`useReflections`、`useHarvests`、`useTaskList` 接受 `date` 参数，日期切换自动重新加载
- `useStats` 无参数：一次加载全部数据到内存，通过切片方法查询

---

## 七、组件层

| 组件                         | 用途                                                                                | 使用者                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **TabBar**             | 底部三标签导航（计划/反思/收获）                                                    | App.tsx                                                          |
| **SideNav**            | 左侧导航栏：菜单按钮 + 设置按钮（56px 宽）                                          | App.tsx                                                          |
| **SideMenu**           | 左侧滑出菜单：长期目标/任务清单/DDL/课程表/周视图/宏观视图/回收站/备份恢复         | App.tsx                                                          |
| **CourseEditModal**    | 课程新建/编辑弹窗（表单校验 + saveCourse；导出 DAY_LABELS/WEEK_TYPE_LABELS）        | CoursesPage, WeekViewPage                                        |
| **DayNavigator**       | 月历日期选择器，支持`compact` 模式                                                | DailyPlan, Reflection, Harvest, FullscreenSchedule, TaskListPage |
| **CalendarHeatmap**    | 84天热力图                                                                          | Dashboard                                                        |
| **FullscreenEditor**   | 全屏编辑器（标题+正文分离）                                                         | Harvest                                                          |
| **FullscreenSchedule** | 全屏日程视图（Portal 到 body，z=300；可选`courses`/`onCourseClick` 只读课程块） | DailyPlan                                                        |
| **PreferencePanel**    | 偏好设置底部面板（z=320）                                                           | DailyPlan                                                        |
| **TimeBlockCard**      | 可折叠时间块卡片（历史遗留）                                                        | 未直接引用                                                       |
| **TrendChart**         | Recharts 折线图（专注/效率/完成率）                                                 | Dashboard                                                        |

---

## 八、页面层

### DailyPlan.tsx — 每日计划（首页 `/`）

**核心功能**：

- **时间网格视图**：可配置小时高度（48/64/80px），10分钟虚线刻度
- **睡眠时段折叠**：当 `hideSleepHours=true` 时，睡眠时段折叠为一条提示条
- **全屏视图**：Portal 全屏渲染（z=300），编辑面板和偏好面板 z-index 更高浮在上方
- **规划模式**：
  - `📅 预规划`：手动选开始时间，默认 08:00
  - `⚡ 即时`：新建时开始时间锁定当前时刻（每30秒刷新），增加任务形式子选项
  - **模式切换保留时间**：即时↔预规划切换不再重置开始/结束时间（切换前手动设的时间保留，切换后冻结不再随每30秒自动更新）
    - `📦 整块内容`：传统时间块，plannedContent 为 textarea
    - `📋 清单模式`：plannedContent 替换为可追加/勾选/删除的子任务清单，时间块上显示进度条；可从「任务清单模板」一键**套用**（追加到当前清单，新条目重新生成 id、done=false）。**清单型即时任务**：默认占位 `start=now, end=now+10min`（未勾完前保证时间表可见；起止落入折叠睡眠时段时贴对应边界显示，不再被丢弃）；编辑面板显示开始时间，可手动微调（微调后冻结，不再随当前时刻每30秒更新）；全部子任务勾完即视为完成（`completed=true`、`endTime=最后勾选时刻`）；轻量任务**不验收、不评分**（无验收按钮、时间块不显示评分标签）
- **时间设置**：起止时间 或 起止+时长 两种方式
- **验收弹窗**：已存在的时间块编辑面板点「验收」打开**独立弹窗**（仅填写实际执行情况 + 专注/效率打分(0-10) + 备注，不显示计划内容），保存后 `completed=true` 视为任务完成；**初次编辑（新建）不可验收**、**清单型即时任务不可验收**；已验收块可「撤销验收」恢复
- **点击空白**：创建新时间块（默认时长由偏好决定，取整到 5 分钟）
- **点击时间块**：编辑/验收/删除；时间块上显示 `专X 效Y`，未验收显示「未验收」，验收后整块删除线+变淡
- **当前时间红线**：仅今天显示，睡眠时段自动隐藏
- **从模板导入**：从作息模板批量导入
- **课程块（只读展示）**：挂载时加载课程表+学期设置，按当天日期实时计算（星期多选/周次/单双周/法定节假日+手动特殊日期全过滤），渲染在任务块下层（z=2，重叠时任务块在上），点击弹课程详情弹窗（只读，不写当天计划、不参与统计）；工具栏 📅 按钮直达课程表页；全屏视图同样显示

### CoursesPage.tsx — 课程表（`/courses`）

- **列表 / 课表双视图**：页面内「视图」chips 切换——列表视图 = 课程管理与结构展示（课程状态 + 第 X–Y 周跨度）；课表视图 = 二维模板网格（只含课程，隐藏学期设置）
- **学期设置**：开学时间（`type=date`，保存即写 semester.json；未设置时提示课程不会显示）；手动特殊日期列表（放假/补课，同一天重复添加替换类型，删除有确认）
- **课程列表**：按周日→周六分组（多星期课程在每个所选星期分组中出现），卡片显示 `时间 课程名 · 地点 · 第X-Y周 · 每周/单周/双周`
- **课程表视图（二维模板网格）**：星期 × 时间（0–24h，`blockRenderRect` 几何 + 偏好小时高度），显示**全部课程**（模板语义，不按周过滤）；单/双周课程块带「单/双」角标，tooltip 含第 X–Y 周；点课程块弹编辑弹窗（共享 CourseEditModal），空白格不新建；**默认折叠**凌晨 0:00–7:00 / 午休 12:00–13:00 / 深夜 22:00–24:00 三段为折叠条（`foldedGrid` 多段折叠几何，仅展示不点击，chip「折叠不重要时段」可展开回完整 0–24h，组件状态不持久化）
- **新建/编辑弹窗（共享 CourseEditModal）**：课程名（必填）/教师/地点、星期 chips（**可多选**，至少保留一个）、起止时间（校验结束>开始）、单双周 chips、起始周/持续周数（clamp 1-30）；删除走回收站

### WeekViewPage.tsx — 周视图（`/week`）

与课程表页**解耦**的独立通用周日程：忠实同步课程安排，但不只有课程，时间跨度也不限于学校周。

- **任意周导航**：‹ 上一周 / 标题（点击回本周）/ 下一周 ›，周日→周六 7 列，默认当前周
- **课程块**：逐列 `computeDayCourses(courses, semester, dateStr)` —— 星期多选/周次区间/单双周/节假日/手动补课全过滤，按具体周忠实反映；点击弹共享 CourseEditModal 编辑
- **任务块**：各天 `getPlanByDate` 的当天计划时间块只读展示（主色调，z=3 高于课程块，无点击）
- **表头**：星期 + `M/d` + 「第 X 周」（有学期时）+ 「放假」角标（`isDayHoliday`，无学期时内置表仍生效）
- 无空白格新建；无学期设置时课程列全空（与日视图一致），任务块仍显示

### SettingsPage.tsx — 设置（`/settings`）

- 👤 个人信息：头像选择器（24个emoji）+ 用户名输入
- 🎨 外观：浅色/深色/跟随系统 三选一
- 📐 默认偏好：睡眠时间、隐藏开关、默认时长、网格密度
- 恢复默认设置按钮

### TaskListPage.tsx — 任务清单（`/tasks`）

- 按日浏览（DayNavigator 日期选择器）
- 顶部输入框 + 添加按钮
- 待完成 / 已完成 分组
- 已完成组可折叠
- 勾选切换状态、悬停删除
- 页头「模板」按钮 → 任务清单模板管理面板：新建/重命名/删除模板，逐项可勾选、编辑、增删（编辑文本 onBlur 提交）

### DdlPage.tsx — DDL 截止清单（`/ddl`）

- **列表按截止时间升序**（已过期自然在前）：卡片 = 名称 + `2026年8月13日 18:30` 截止 + 剩余徽章（`minutesUntilDeadline`，过期红色 `ddl-badge--expired`）+ 备注预览（两行截断）+ 🖼N 图片数；点击卡片编辑
- **新建/编辑弹窗（页面内联）**：名称（必填，≤30字）、截止日期/时间（`type=date/time`，必填，精确到分钟）、备注 textarea（无长度限制，可任意长）、备注图片（最多 9 张，`fileToCompressedDataURL` 等比压缩 JPEG ≤1280px；处理中禁用保存防丢图）
- **删除**：确认后进回收站（originalTable=ddls，标题 `DDL - 名称`）；Android 返回键先关弹窗再退页
- 无日程集成/通知/完成勾选（宁少勿多）

### LongTermGoals.tsx — 长期目标（`/goals`）

创建/编辑目标、子任务拆解、进度条、分类筛选。

### Reflection.tsx — 反思（`/reflection`）

上午/下午/晚上三段式，问题→原因→改进，左色条卡片。

### Harvest.tsx — 收获（`/harvest`）

`#标签` 自动提取与高亮，首行短标题识别。

### Dashboard.tsx — 宏观视图（`/dashboard`）

4 统计卡片 + 热力图 + 趋势折线图 ×2 + 高频关键词。

### Trash.tsx — 回收站（`/trash`）

软删除记录列表，还原/永久删除/清空，30天自动清理。

### BackupRestore.tsx — 备份恢复（`/backup`）

文件导入导出、存储路径配置。

### SetupPage.tsx — 设置向导

首次使用时配置存储路径。

---

## 九、全局样式系统 [src/App.css](src/App.css)

CSS 变量体系：

| 类别   | 变量                     | 浅色默认值                 | 深色默认值       |
| ------ | ------------------------ | -------------------------- | ---------------- |
| 背景   | `--color-bg`           | `#f5f5f7`                | `#0f0f1a`      |
| 卡片   | `--color-surface`      | `#ffffff`                | `#1a1a2e`      |
| 主色   | `--color-primary`      | `#4f46e5`                | `#818cf8`      |
| 成功   | `--color-success`      | `#10b981`                | `#34d399`      |
| 警告   | `--color-warning`      | `#f59e0b`                | `#fbbf24`      |
| 危险   | `--color-danger`       | `#ef4444`                | `#f87171`      |
| 热力图 | `--color-heatmap-1~4`  | indigo 四级                | 深色 indigo 四级 |
| 圆角   | `--radius-sm/md/lg/xl` | 8/12/16/20px               | 同               |
| 阴影   | `--shadow-sm/md/lg`    | 浅灰三级                   | 深黑三级         |
| 字号   | `--font-xs~2xl`        | 0.75rem~1.5rem             | 同               |
| 安全区 | `--safe-top/bottom`    | `env(safe-area-inset-*)` | 同               |

**Z-index 层级**：

```
 50   FAB 按钮
 90   SideNav（左侧栏）
100   TabBar（底部栏）
200   课程新建/编辑弹窗 CourseEditModal
250   SideMenu 遮罩面板
300   全屏日程 FullscreenSchedule
310   编辑 Bottom Sheet、课程详情弹窗
320   偏好面板 PreferencePanel
```

---

## 十、依赖关系图

```
main.tsx
 └─ App.tsx
     ├─ BackButtonProvider
     │   └─ HashRouter
     │       ├─ SideNav → SideMenu
     │       ├─ TabBar
     │       └─ Routes
     │           ├─ "/" → DailyPlanPage
     │           │        ├─ DayNavigator
     │           │        ├─ FullscreenSchedule → Portal(body)
     │           │        ├─ PreferencePanel
     │           │        ├─ useDailyPlan → db
     │           │        ├─ usePreferences → localStorage
     │           │        └─ useRegisterBackHandler
     │           ├─ "/tasks" → TaskListPage
     │           │             ├─ DayNavigator
     │           │             ├─ useTaskList → db
     │           │             └─ useRegisterBackHandler
     │           ├─ "/ddl" → DdlPage
     │           │             ├─ getAllDdls / saveDdl / deleteDdl → db
     │           │             ├─ minutesUntilDeadline / ddlRemainText → utils/ddl
     │           │             ├─ fileToCompressedDataURL → utils/avatarCrop
     │           │             └─ useRegisterBackHandler
     │           ├─ "/courses" → CoursesPage
     │           │               ├─ CourseEditModal → saveCourse → db
     │           │               ├─ getAllCourses / getSemester → db
     │           │               └─ useRegisterBackHandler
     │           ├─ "/week" → WeekViewPage
     │           │               ├─ CourseEditModal → saveCourse → db
     │           │               ├─ getAllCourses / getSemester / getPlanByDate → db
     │           │               └─ useRegisterBackHandler
     │           ├─ "/goals" → LongTermGoalsPage
     │           ├─ "/reflection" → ReflectionPage
     │           ├─ "/harvest" → HarvestPage
     │           ├─ "/dashboard" → DashboardPage
     │           ├─ "/trash" → TrashPage
     │           ├─ "/backup" → BackupRestorePage
     │           └─ "/settings" → SettingsPage
     │                            └─ usePreferences → localStorage
     │
     └─ App.css（全局样式 + 深色主题）
```

统一数据流：

```
db/index.ts (Dexie CRUD) → hooks/useXxx.ts (React state + callbacks) → pages/XxxPage.tsx (UI)
                                                        ↑
                                              usePreferences → localStorage
```

---

## 十一、文件持久化 [src/services/store.ts](src/services/store.ts)

**架构**：用户目录文件（唯一数据源） ←→ 内存 store（实时投影） ←→ React UI

| 函数                          | 用途                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initStore()`               | 启动时读用户目录（新布局）→ 旧单文件迁移 + 旧 Dexie 迁移 → 加载自愈 → 返回恢复条数                                                              |
| `persist()`                 | 全量写：把当前内存状态分布写入所有文件（入队时捕获`{dir, 文件列表}` 快照，串行执行）                                                             |
| `mutate(fn, {writeOrder?})` | 同步改 store →**增量写**（指纹对比，只写变脏文件；跨文件操作可指定写序）                                                                    |
| `flush()`                   | 等待所有挂起写入完成（切后台/退到桌面时兜底）                                                                                                      |
| `importJSONIntoStore()`     | 解析备份包 JSON → 纯合并入内存 → 立即写文件                                                                                                      |
| `exportBackupFile()`        | 导出备份文件：Web 触发浏览器下载；Android 写入`Documents/<dir>/dailynote-backup-<时间戳>.json`（仅存档，不作为运行期存储）                       |
| `isCapacitor()`             | 平台判定：仅原生（`isNativePlatform()===true`）返回 true。不能只看 `window.Capacitor` 是否存在——Web 端静态引入 `@capacitor/app` 也会挂上它 |
| `listSubdirs()`             | 列出`Documents/` 下的子目录供「浏览已有目录」点选（Android 真实读取；Web 无真实目录返回空数组）                                                  |
| `storageAccessBlocked()`    | Android 11+ 且未授予「所有文件访问」→ true（此时公共 Documents 读写必被系统拒绝）                                                                    |
| `requestAllFilesAccess()`   | 跳转系统设置请求「所有文件访问」（原生插件 DailyNoteStorage；用户返回后 Boot 自动重新检测）                                                          |
| `INIT_STORAGE_BLOCKED`      | initStore 被权限阻塞时的返回哨兵（-2），Boot 据此显示授权引导页                                                                                       |
| `changeStoragePath()`       | 更改存储位置：新位置有数据则恢复，无数据则把当前数据搬过去                                                                                         |
| `normalizePath()`           | 规范化并校验路径（拒绝`..`、绝对路径、非法字符）                                                                                                 |

**后端**：Capacitor → 用户目录分文件 JSON（`days/<日期>/*.json` + `goals/routines/templates/courses/semester/ddls/trash.json`）；Web → IndexedDB KV（key = 相对路径，与原生文件一一对应）。

**导入策略**：纯合并。按 natural key 匹配（dailyPlans 按 date，其余按 id），存在则更新，不存在则新增，永不删除已有数据，并保留文件内的时间戳（不重置 createdAt/updatedAt）。`taskItems`/`taskTemplates`/`ddls` 支持旧版 JSON 缺失的向后兼容（parseStorageData 兜底为空数组）。

---

## 十二、测试

| 文件                                              |    测试数    | 内容                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | :-----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/时间网格点击映射/clickMapping.test.ts`    |      207      | 睡眠折叠下的像素→时间正反映射，跨夜/不跨夜/不同密度，真实点击坐标换算层回归                                                                                                                                                                                                                          |
| `test/时间网格点击映射/blockRenderRect.test.ts` |      16      | 时间块渲染矩形：睡眠折叠时段内的块贴边界可见（⚡即时任务夜场景回归）、跨夜/不跨夜、边界时刻、非法时间                                                                                                                                                                                                 |
| `test/时间网格点击映射/foldedGrid.test.ts`      |      18      | 多段折叠网格（课程表视图）：三段折叠条几何/分钟映射、跨折叠段块、整段内贴条 20px、边界时刻、跨夜、密度参数、乱序输入、非法时间                                                                                                                                                                        |
| `test/数据导入导出/jsonImport.test.ts`          |      23      | JSON 解析、BOM 处理、乱码拒绝、微信缓存检测、round-trip                                                                                                                                                                                                                                               |
| `test/偏好设置/preferences.test.ts`             |      15      | 默认值、localStorage 存取、旧版兼容、主题应用逻辑                                                                                                                                                                                                                                                     |
| `test/偏好设置/avatarCrop.test.ts`              |      17      | 头像裁剪纯函数：cover 缩放、平移钳制、围绕点缩放像素不动、裁剪矩形映射（含随机模糊）                                                                                                                                                                                                                  |
| `test/任务清单/taskList.test.ts`                |      18      | 创建、完成切换、排序、统计、日期隔离、边界情况                                                                                                                                                                                                                                                        |
| `test/数据存储/store.test.ts`                   |      52      | 内存 CRUD 语义、id 单调性、回收站深拷贝、persist 快照队列、路径/导入、一次性迁移、新布局分布、增量写、旧单文件迁移、加载自愈、导出备份（含模板导出→导入往返）、课程表存储（CRUD 往返、semester 恒 1、回收站还原原 id、导出导入含 courses+semester、仅课程数据目录回归、旧版单数字 dayOfWeek 归一化）、DDL 存储（CRUD 往返升序、同日同时刻 id 兜底、images/长备注往返、回收站还原原 id、id 不复用、导出导入、仅 ddls.json 目录回归） |
| `test/DDL清单/ddlTime.test.ts`                 |      13      | minutesUntilDeadline（未来/过期/恰为截止/跨零点/格式与范围非法→null）、ddlRemainText（分钟/小时/天边界、0→已过期）                                                                                                                       |
| `test/任务清单/taskTemplate.test.ts`            |      13      | 模板 CRUD/更新、软删除进回收站与还原、templates.json 持久化、增量写、旧备份导入兼容、空目录判定、回收站自愈、appendTemplateItems 纯函数                                                                                                                                                               |
| `test/课程表/courseSchedule.test.ts`            |      32      | weekdayOf/mondayOf、weekIndex（周一/周中开学、早于开学、跨年）、isCourseActiveOnWeek（单双周+区间边界）、内置节假日表（2026/2027、无重复）、isDayHoliday（手动>内置、补课覆盖）、computeDayCourses（星期多选/周次/节假日/排序/多天课程）、dayOfWeek 旧数据归一化                                      |
| `test/数据存储/storageAccess.test.ts`         |       8      | Android 存储权限守卫：11+ 未授权阻塞/已授权放行、Android 10 不阻塞、Web 不阻塞、阻塞时 initStore 返回 -2 且零写入、授权后恢复                                                                                                                                                                         |
| **总计**                                    | **432** |                                                                                                                                                                                                                                                                                                       |

运行：`npx vitest run`（偶尔需先 `rm -rf node_modules/.vite node_modules/.vitest` 清缓存）

---

## 十三、构建

| 命令                      | 作用                                             |
| ------------------------- | ------------------------------------------------ |
| `npm run dev`           | Vite 开发服务器                                  |
| `npm run build`         | 类型检查 + Vite 构建（Web PWA）                  |
| `npm run build:android` | PowerShell 脚本：Web 构建 + Cap sync（跳过 APK） |
| `npm run build:apk`     | PowerShell 脚本：全流程 → APK                   |

- Web 模式：`base=/`，启用 PWA 插件
- Capacitor 模式（`CAPACITOR=true`）：`base=./`，禁用 PWA
