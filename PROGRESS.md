# DailyNote 开发进度

> 每次功能/修复完成后记录（只能追加，不删旧内容），并打上日期。

## 2026-08-12 — 新增「任务清单模板」

### 需求

模板 = 可勾选的任务清单（复用 `ChecklistItem`）。需要一个自定义模板的地方（放在任务清单页 `/tasks` 页头，「模板」按钮打开管理面板），并在编辑即时任务（DailyPlan「⚡ 即时」+「📋 清单模式」）时直接套用。套用行为：**追加**到当前清单末尾（新条目重新生成 id、done 强制 false，不改动模板本身）。

### 实现

- **数据模型** `src/types/index.ts`：新增 `TaskTemplate { id?, name, items: ChecklistItem[], createdAt, updatedAt }`；纯函数 `appendTemplateItems(current, templateItems)` 深拷贝追加。
- **存储层** `src/services/store.ts`：新增 `taskTemplates` 表，落盘到 `templates.json`。全触点同步：`StorageData/StoreShape`、`NumericTable`、`nextId/resetNextId`、`CATEGORY_FILES`、`readNewStructure`（空目录判定含 templates.json）、`hasAny`、`fingerprint`/`Fp`/`buildWriteSetDirty`（增量写）、`mergeIntoStore`/`mergeLegacy`（numeric 表）、`parseStorageData`（旧备份兜底空数组）、`DEFAULT_WRITE_ORDER`、`liveArr`。
- **CRUD** `src/db/index.ts`：`getAllTaskTemplates` / `saveTaskTemplate`（无 id 则 allocId，带 id 即更新）/ `deleteTaskTemplate`（软删除深拷贝进回收站，`originalTable: 'taskTemplates'`，title `任务模板 - {name}`）；`TRASH_TARGET` + `restoreFromTrash` switch + 回收站自愈支持模板。`src/pages/Trash.tsx` 表格标签加 `任务清单模板`。
- **Hook** `src/hooks/useTaskTemplates.ts`：`{ templates, loading, addTemplate, updateTemplate, removeTemplate, reload }`，乐观更新。
- **管理 UI** `src/pages/TaskListPage.tsx/.css`：页头模板按钮（lucide `ClipboardList`）；底部弹层管理面板——新建模板、名称内联编辑、展开/收起、条目勾选/编辑/删除、添加子任务。编辑文本 onBlur/Enter 提交，避免每键一次文件写。
- **套用模板** `src/pages/DailyPlan.tsx/.css`：清单模式「套用模板」按钮 → 内联模板选择器（必须内联在 bs-sheet 内，bs-overlay z-index 310 高于 modal 的 200）→ `appendTemplateItems` 追加到当前清单。无模板时 alert 引导去「任务清单」页创建。

### 验证

- 新增 `test/任务清单/taskTemplate.test.ts` 13 个测试：CRUD/更新、软删除与还原、templates.json 持久化与增量写、旧备份导入兼容、空目录判定、回收站自愈、appendTemplateItems 纯函数。
- `n`npx vitest run` **311/311 通过**（298 既有 + 13 新增）；`npm run build`（tsc --noEmit + vite build）通过。
- 临时脚本 `test/demo_export.mjs`、`test/gen_json.mjs` 已删除（未被 src 引用）。

### 涉及文件

```
修改：src/types/index.ts、src/services/store.ts、src/db/index.ts、src/pages/Trash.tsx、src/pages/TaskListPage.tsx/.css、src/pages/DailyPlan.tsx/.css、structure.md
新增：src/hooks/useTaskTemplates.ts、test/任务清单/taskTemplate.test.ts
删除：test/demo_export.mjs、test/gen_json.mjs（临时脚本）
```

## 2026-08-12 — 时间块「规划 / 验收」阶段分离

### 需求

专注度、效率、实际执行情况、备注是**后验**数据，制定计划时不应出现。改为：编辑面板加显式「📝 计划 / ✅ 验收」阶段切换；计划阶段隐藏验收区；新块默认 0 分（未评分），验收时才打分和备注。

### 实现

- `src/pages/DailyPlan.tsx`：新增 `editPhase('plan'|'review')` 状态，每次打开编辑器重置为「计划」；面板顶部加阶段切换；实际执行情况/专注度/效率/备注仅在「验收」阶段渲染；所有新建块默认 `focusScore/efficiencyScore = 0`；保存与输入 onBlur 钳制允许 0；时间块上分数为 0 时显示「未验收」。
- `src/hooks/useDailyPlan.ts`：`addBlock`/`importFromRoutine` 默认分改 0。
- `src/hooks/useStats.ts`：专注/效率均值只统计已评分（>0）的块，未验收块不拉低均值。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **311/311 通过**（既有测试直接构造 TimeBlock 字面量，不受默认值影响）。

### 涉及文件

```
修改：src/pages/DailyPlan.tsx、src/hooks/useDailyPlan.ts、src/hooks/useStats.ts、structure.md
```

## 2026-08-12 — 验收改为独立弹窗（代替面板内阶段切换）

### 需求

验收与编辑彻底分离：不再用编辑面板里的「规划/验收」切换，改为**独立弹窗**。弹窗只填验收项（实际执行情况 + 专注/效率打分 + 备注），不显示计划内容；保存后 `completed=true` 才算完成任务，时间块删除线 + 整体变淡。初次编辑（新建块）不允许验收。

### 实现

- `src/pages/DailyPlan.tsx`：移除 `editPhase` 切换及面板内验收字段（实际执行/打分/备注不再出现在编辑面板）；新增 `acceptingBlock` 状态与独立验收弹窗（`accept-overlay` z=400，居中弹窗，与底部编辑面板视觉区分）；编辑面板页脚「标记完成」改为「验收」按钮（仅已存在块显示，`editingBlock.id` 存在才开放）；`handleAcceptBlock` 钳制分数后写 `completed=true` 并关闭两面板；已验收块在弹窗内可「撤销验收」（`completed=false`）；返回键优先关闭验收弹窗；`Circle` 图标导入移除。
- `src/pages/DailyPlan.css`：`.accept-overlay`/`.accept-modal` 弹窗样式 + 弹入动画；`.time-block--done` 整块内容 `opacity:0.55` 变淡（标题保留删除线）。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **311/311 通过**。

### 涉及文件

```
修改：src/pages/DailyPlan.tsx、src/pages/DailyPlan.css、structure.md
```

## 2026-08-12 — 清单型即时任务：占位时间 + 勾完即完成，不验收不

### 需求

清单型即时任务（⚡即时 + 📋清单模式）是轻量任务：没有固定时间段却在时间表看不到；无需验收、无需专注/效率评分。方案：新建时默认 `start=now, end=now+10min` 占位（保证时间表可见）；当全部子任务被勾选时，结束时间改为**最后一项勾选的时刻**，任务即视为完成（不用走验收弹窗）。

### 实现

`src/pages/DailyPlan.tsx`：

- 模块级辅助：`CHECKLIST_PLACEHOLDER_MIN=10`、`isChecklistTask`（有子任务清单 = 轻量任务）、`allChecklistDone`、`formatHM`。
- 占位：清单模式下未全部勾选时强制 `endTime = startTime + 10min`（打开/切换模式时 effect + 即时任务 30s 刷新 effect 同步）；完成时不再改时间。
- 完成时刻：清单勾选 toggle 里记录「由未全勾 → 全勾」的 `Date.now()` 到 `checklistDoneAtRef`；保存时若全勾 → `completed=true`、`endTime=最后勾选时刻`（重开已完成的块再保存不覆盖已记录的 endTime）；未全勾 → `completed=false`、`endTime=start+10min` 恢复占位。
- 轻量化：清单任务编辑面板**不显示「验收」按钮**，时间块上**不显示评分标签**（进度条已表达状态）。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **311/311 通过**；vite 热更新无报错。

### 涉及文件

```
修改：src/pages/DailyPlan.tsx、structure.md
```

## 2026-08-13 — 修复：⚡即时任务落在睡眠折叠时段时在日程视图中完全不可见

### 需求

⚡即时 + 📋清单模式 创建的任务在日程视图中「根本显示不出来」：时间块已保存，但主网格和全屏日程都不渲染。此前尝试「10 分钟占位」未解决。

### 根因（浏览器真实复现确认）

睡眠折叠（默认 23:00-07:00，hideSleepHours=true）下，`minutesToTop()` 对折叠时段内的分钟返回 -1，而时间块渲染用 `if (top < 0 || btm < 0) return null` 直接丢弃。即时任务 `startTime=now`，夜晚（如 23:36）创建时起止都落在折叠窗口内 → 块被丢弃。10 分钟占位无效的原因：起止都在折叠窗口里。副因：`getNowRounded()` 在 23:58-23:59 取整进位成 1440 → "00:00" 跨日。

### 实现

- `src/utils/time.ts`：新增 `blockRenderRect(startTime, endTime, 几何参数)` 纯函数——分钟→网格 top 映射 + 折叠窗口贴边：跨夜时 23:00-24:00 贴网格底部、00:00-07:00 贴折叠条下方（非跨夜一律贴折叠条下方），整块落在折叠时段时给 20px 最小高度收进网格内；时间非法返回 null。块上时间标签仍显示真实起止。
- `src/pages/DailyPlan.tsx`、`src/components/FullscreenSchedule.tsx`：时间块渲染改用 `blockRenderRect`（原映射/丢弃逻辑删除）；`getNowRounded()` 取整封顶 1435（23:55），避免进位跨日；全屏视图自动滚动：当前时刻在折叠时段内时滚到贴边所在边界（23:00-24:00 滚底部，其余滚顶部），保证新保存的即时任务开全屏即见。

### 验证

- 新增 `test/时间网格点击映射/blockRenderRect.test.ts` 16 个测试（import 真实源码函数）：折叠/不折叠、跨夜/不跨夜、夜场景回归（23:36-23:46 贴底部非 null）、边界时刻（23:00/00:00/23:50-00:10）、非法时间。`n`npx vitest run` **327/327 通过**；`npm run build`（tsc + vite build）通过。
- 真实浏览器端到端复现（Edge + 伪造时钟，临时脚本用完已删）：修复前 23:36 保存后主网格/全屏均为 0 块；修复后 23:36、01:00、23:58、23:40 勾完 四个场景两个视图均渲染且位于滚动视口内（visiblePx=20），日间场景（10:30）位置无回归。

### 涉及文件

```
修改：src/utils/time.ts、src/pages/DailyPlan.tsx、src/components/FullscreenSchedule.tsx、structure.md
新增：test/时间网格点击映射/blockRenderRect.test.ts
```

## 2026-08-13 — 即时清单模式编辑面板：开始时间可见、可微调（微调后冻结）

### 需求

编辑⚡即时任务时，📋清单模式完全不显示开始时间（时间设置区只对预规划/整块模式渲染），看不到也改不了，很别扭。要求：清单模式也显示开始时间，并允许手动微调。

### 实现

`src/pages/DailyPlan.tsx`：

- 即时+清单模式新增「开始时间」输入（含 ⚡即时 徽标与动态提示语），微调时占位 endTime 跟随（=新开始+10min；已全部勾完则保持完成时刻不变），清空输入不落状态（避免非法时间）。
- 新增 `manualStartRef`：手动微调后冻结，每 30 秒 ticker 不再覆盖开始/结束时间；提示语切换为「已手动微调，不再随时间更新」。
- 冻结标记在打开编辑器的一切入口复位（网格点击、全屏点击、添加按钮、点击已有时间块、切换⚡即时、编辑块 id 变化），保证新任务重新跟随当前时刻。

### 验证

- `n`npx vitest run` **327/327 通过**；`npm run build`（tsc + vite build）通过。
- 真实浏览器端到端（Edge + 伪造时钟 23:36，临时脚本用完已删）：清单模式显示开始时间且可微调；微调 23:25 后快进 45 秒输入仍为 23:25（冻结生效），保存后网格标签 23:25-23:35；不微调时快进 6 分钟输入更新为新时刻（既有行为不回归）；整块模式只读锁定输入不受影响。

### 涉及文件

```
修改：src/pages/DailyPlan.tsx、structure.md
```

## 2026-08-13 — 审计：模板功能的存储/读写/导入导出是否跟上

### 需求

任务清单模板是后续增加的功能，检查数据存储、读写、导入导出各层是否都已覆盖（有没有漏掉的表枚举、文档、测试）。

### 结论（审计结果）

核心链路已跟上，无功能缺口：store.ts 全部表枚举（StorageData/指纹/增量写/合并/自愈/快照/计数器）、db/index.ts（CRUD+软删除+还原）、legacy（模板无旧表属正常，mergeLegacy 以 `?? []` 兜底）、facade、Trash 标签均含 taskTemplates；templates.json 读写与空目录判定已有测试。

发现并修复的缺口：

1. 文档：store.ts 头部布局注释、备份页两处存储布局说明（`BackupRestore.tsx`）漏掉 templates.json → 补上。
2. 测试：无「导出→导入」模板往返验证（换手机场景）→ `store.test.ts` 新增往返测试（导出备份含模板，重置后导入完整恢复）。
3. 测试 schema 复刻：`jsonImport.test.ts` 本地 StorageData 接口与样例缺 taskItems/taskTemplates → 同步。
4. 附带（与模板无关的旧问题）：`Trash.tsx` 的 TABLE_LABELS 漏 taskItems，回收站显示原始字符串 → 补标签「任务清单项」。
5. structure.md 测试表 store.test.ts 行计数陈旧（28 vs 实际 35）→ 更正为 36。

### 验证

- `n`npx vitest run` **328/328 通过**（新增 1 个模板往返测试）。

### 涉及文件

```
修改：src/services/store.ts（注释）、src/pages/BackupRestore.tsx（布局说明）、src/pages/Trash.tsx（标签）
修改：test/数据存储/store.test.ts（+1 测试）、test/数据导入导出/jsonImport.test.ts（schema 同步）、structure.md（测试计数）
```

## 2026-08-13 — 头像支持导入任意图片并引导裁剪（放大缩小、移动）

### 需求

头像不应限于预设 emoji：导入任意图片后引导用户截取一部分，支持放大缩小和移动。App 主要跑 Android（Capacitor WebView），必须支持触屏（单指拖动 + 双指捏合）。

### 实现

- `src/utils/avatarCrop.ts`（新）：裁剪纯函数，左上角坐标系——fitCoverScale（cover 最小缩放）、clampPan（图片边缘不露进视口）、zoomAround（围绕视口点缩放、该点像素不动）、cropSourceRect（视口区域→原图坐标）；renderAvatarToDataURL（canvas 输出 256×256 白底 JPEG q0.85 dataURL）、downscaleImage（>4096px 巨图一次性降采样防 WebView OOM）。
- `src/components/AvatarCropper.tsx / .css`（新）：Portal 裁剪弹窗。手势全程 ref 直写 img style（零 React 重渲染）；单指/鼠标拖动（pointer capture）、双指捏合（指距比缩放 + 跟手中点）、滚轮（原生非被动监听）、± 按钮与滑杆（1×–4× of cover）。圆形 box-shadow 遮罩提示成品形状。取消/Android 返回键/Escape/背景滚动锁定。加载失败显示错误态。
- `src/pages/SettingsPage.tsx / .css`：头像选择器新增全宽「📷 从图片导入」入口（隐藏 file input，选中后打开裁剪弹窗）；头像按钮在 avatar 为 data:image 时渲染圆形 img；emoji 选择器保留（恢复默认设置仍回 👤）。
- `src/hooks/usePreferences.ts`：仅注释更新（avatar = emoji 或 data:image 图片，约 20-55KB）。
- 无新依赖（不用 react-easy-crop）；EXIF 方向由浏览器解码时自动应用，无需处理。

### 验证

- `n`npx vitest run` **345/345 通过**（新增 17 个裁剪数学测试，含 100 组随机模糊）；`npm run build`（tsc + vite build）通过。
- 真实浏览器端到端（system Edge + 手机视口 390×844 + 触屏模拟，临时 playwright-core 已卸载、临时脚本已删）：首次向导跳过 → 导入 400×600 PNG → 初始居中（x=0, y=-70 ✓）、CDP 触摸拖动（y -70→-30，x 保持钳制 ✓）、滚轮缩放（0.700→0.805 ✓）、± 按钮 ✓ → 确定后 localStorage avatar 为 data:image/jpeg（长度正常）、设置页渲染图片头像 ✓、emoji 选择器回归 ✓。

### 涉及文件

```
新增：src/utils/avatarCrop.ts、src/components/AvatarCropper.tsx / .css、test/偏好设置/avatarCrop.test.ts
修改：src/pages/SettingsPage.tsx / .css、src/hooks/usePreferences.ts（注释）、structure.md
```

## 2026-08-13 — 修复：规划模式切换时时间被重置（小 bug）

### 需求

在编辑面板从即时切到预规划（或反向）时，时间会被重置为 08:00 或当前时刻；应保留当前时间状态不重置。

### 实现

- `src/pages/DailyPlan.tsx`：删除两个模式切换按钮里的时间覆盖逻辑（预规划按钮原本对未保存新块重置 08:00-09:00，即时按钮原本重置为当前时刻）。
- 切到「⚡ 即时」时置 `manualStartRef.current = true` 冻结每 30 秒的自动跟随——否则 ticker 会在 30 秒内把保留的时间覆盖回当前时刻（新建即时块时由各创建入口置 false，仍从当前时刻开始并跟随）。
- 即时整块模式的提示文案改为随冻结状态变化（与清单模式一致）：冻结后显示「已手动微调，不再随时间更新」。
- `structure.md`：规划模式条目补充「模式切换保留时间」说明。

### 验证

- `n`npx vitest run` 345/345 通过；`npm run build` 通过。
- 真实浏览器端到端（system Edge，临时 playwright-core 已卸载、临时脚本已删）：新建默认 08:00 → 切即时保留 08:00（不再变当前时刻）→ 切回预规划保留 → 手动设 15:00 双向切换均保留 → 关闭后重新添加（全局即时模式）仍默认当前时刻（创建默认值不受影响）→ 越过 30 秒 ticker 周期后保留的手动时间 09:30 未被自动重置。8/8 断言通过。

### 涉及文件

```
修改：src/pages/DailyPlan.tsx、structure.md
```

## 2026-08-13 — 课程表功能

### 需求

加入课程表：记录周课表、开学时间、法定节假日、单双周差异、每门课的上课周数；课程表做好后，当天确实有课时直接体现在日程表上。另：课程星期支持多选（同一门课周一+周二都有课只需创建一次，无需重复建两门）。

与用户确认的两项决策：

- 节假日 = 内置中国法定节假日表（2026 精确、2027 部分推定，注释注明需逐年更新）+ 课程表页手动添加特殊日期（放假/补课）覆盖或补充。
- 课程块 = 只读展示：渲染时按课表+日期实时计算，不写入当天 plan.json、不参与验收/统计；点击弹课程详情，修改请到课程表页。

补课语义（已确认的限制）：`makeup` 只表示「该日期按正常上课日对待」（解除节假日抑制），不做「周六补周五的课」的星期映射。

### 实现

- **类型**（src/types/index.ts）：`Course`（dayOfWeek 为 `number[]` 可多选，0=周日）、`SpecialDate`（放假/补课）、`SemesterRecord`（id 恒 1 单记录）；`normalizeCourseDayOfWeek()` 兼容旧版单数字 dayOfWeek。
- **纯逻辑**：`src/utils/holidays.ts`（内置节假日表 + 查询）；`src/utils/courseSchedule.ts`（weekdayOf/mondayOf、weekIndex 开学所在周=第 1 周且周一对齐、isCourseActiveOnWeek 单双周+区间、isDayHoliday 手动>内置、computeDayCourses 星期多选+周次+节假日全过滤并按开始时间排序）。全部本地日期解析，纯函数可测。
- **存储**：courses（数字 id、删除进回收站、还原保留原 id）与 semester（恒 1、不可删除）两张新表走 CATEGORY_FILES 模式（courses.json/semester.json），写入顺序进 DEFAULT_WRITE_ORDER、空目录判定纳入两表；导出/导入备份自动携带。
- **归一化防线**：parseStorageData（导入路径）、readNewStructure（文件/KV 读取路径）、saveCourse（写入）、restoreFromTrash（还原）四处对 dayOfWeek 统一 `normalizeCourseDayOfWeek`。
- **课程表页**（src/pages/CoursesPage.tsx / .css，路由 /courses）：学期设置（开学时间 + 手动特殊日期放假/补课增删）；课程按周日→周六分组（多星期课程在每个所选星期分组出现）；新建/编辑弹窗支持星期 chips 多选（至少保留一个）、时间校验、单双周、起始周/持续周数；复用设置页表单样式。
- **入口**：SideMenu 加「课程表」（任务清单与宏观视图之间）；DailyPlan 工具栏加 📅 按钮直达。
- **日程表渲染**（DailyPlan.tsx）：挂载加载课程+学期，`computeDayCourses` 实时计算当日课程块（琥珀色，z-index 2，任务块 z-index 3 重叠时任务在上）；网格点击守卫 `closest('.course-block')` 防穿透；点击弹只读课程详情弹窗（含当前第 X 周）；全屏视图同样显示并可点击（FullscreenSchedule 加 courses/onCourseClick 可选 props）。
- **课程详情弹窗 z-index 310**：修复全屏视图下弹窗被 fs-overlay（300）遮挡的问题（原 300 同级被 Portal 到 body 的 overlay 盖住）。
- **标签同步**：Trash.tsx 表格标签加「课程」；BackupRestore.tsx 布局说明补 courses.json、semester.json。

### 验证

- `n`npx vitest run` 386/386 通过（新增 test/课程表/courseSchedule.test.ts 32 项 + store.test.ts 追加课程表存储 9 项 + jsonImport.test.ts 同步）；`npm run build` 通过。
- 真实浏览器端到端（system Edge，临时 playwright-core 已卸载、临时脚本已删）13/13 项通过：页面打开、设学期、多天课程创建一次出现在两个分组、当天课程块显示课程名/时间/地点、只读详情弹窗（不打开编辑面板）、无课日不显示、多天课程周一/周四均显示、节假日抑制+移除恢复、全屏视图课程块+详情弹窗、删除→回收站→还原、任务块与课程块重叠时任务在上。

### 涉及文件

```
新增：src/utils/holidays.ts、src/utils/courseSchedule.ts、src/pages/CoursesPage.tsx / .css、test/课程表/courseSchedule.test.ts
修改：src/types/index.ts、src/services/store.ts、src/db/index.ts、src/pages/DailyPlan.tsx / .css、src/components/FullscreenSchedule.tsx / .css、src/components/SideMenu.tsx、src/App.tsx、src/pages/Trash.tsx、src/pages/BackupRestore.tsx、test/数据存储/store.test.ts、test/数据导入导出/jsonImport.test.ts、structure.md
```

## 2026-08-13 — 课程表页二维课表视图 + 独立周视图

### 需求

课程表补上二维视图，并做好与周视图的解耦（用户两次澄清的绑定设计）：

- 课程表页（/courses）内部有「视图」切换按钮，两个视图都必须在课程表页里：列表视图（课程管理 + 第 X–Y 周结构信息）与课表视图（二维模板网格，只含课程，必须单独做，不允许只留一维列表）。
- 课程表视图 = 课程的立体结构：只有课程状态，时间跨度覆盖全学期（模板语义，不按具体周过滤，单双周靠角标提示）。
- 周视图 = 独立的通用周日程：忠实同步课程安排（按具体周过滤，单双周/周次/节假日生效），但不只有课程（当天计划任务块同样显示）、时间跨度不限于学校周（任意周导航）。
- 交互仅限点击课程块弹编辑弹窗；两个视图的空白格都不做新建。

### 实现

- **共享编辑弹窗（解耦核心）**：新增 src/components/CourseEditModal.tsx / .css，把 CoursesPage 的弹窗逻辑原样迁出（课程名/教师/地点/星期多选 chips/起止时间校验/单双周/周数范围），导出 DAY_LABELS、WEEK_TYPE_LABELS 供两页复用；Props `{ course, onClose, onSaved }`（null=新建），内部直接 saveCourse。
- **课程表页双视图**（CoursesPage.tsx / .css）：`viewMode: 'list' | 'grid'`（默认列表），页面内「列表 / 课表」chips 与「添加课程」并排；课表视图隐藏学期设置，只显示二维模板网格——星期 × 时间（0–24h，blockRenderRect 几何 + 偏好小时高度）、显示全部课程、单/双周块带「单/双」角标、tooltip 含第 X–Y 周、点块弹共享编辑弹窗、空白格无处理；固定高度容器 + 网格内部滚动（横向 min-width 408px = 44 时间列 + 7×52）。
- **周视图页**（新增 src/pages/WeekViewPage.tsx / .css，路由 /week）：`weekStart` 状态 + 任意周导航（‹ 上一周 / 标题点击回本周 / 下一周 ›）；课程块逐列 `computeDayCourses(courses, semester, dateStr)` 按具体周忠实过滤；任务块来自各天 getPlanByDate 只读展示（主色调，z=3 高于课程块 z=2，无点击）；表头 sticky：星期 + M/d + 第 X 周（有学期时）+ 放假角标（无学期时内置表仍生效）；无空白格新建；无学期时课程列全空但任务块仍显示。
- **入口**：App.tsx 加 /week 路由；SideMenu 菜单「课程表」与「宏观视图」之间加「周视图」条目。
- **架构解耦**：WeekViewPage 仅通过 db 调用 + 共享 CourseEditModal 读取课程数据，不依赖 CoursesPage 任何内部状态；课程表视图（模板）与周视图（按周过滤）语义刻意区分。

### 验证

- `npm run build` 通过；`n`npx vitest run` 386/386 全绿（无新纯逻辑，未新增单测）。
- 真实浏览器端到端（system Edge，临时 playwright-core 已卸载、临时脚本已删）29/29 项通过：课程表页列表/课表切换、模板网格两门课全显示（含单周课）、单/双角标、tooltip 周数跨度、列 x 位置、点块编辑改名同步、空白格无弹窗、新建弹窗取消、周视图默认本周第 1 周课程块与任务块、点课程块编辑、任务块只读、空白格无弹窗、下一周单周课消失/上一周恢复、7 次下一周到假期周（4 个放假角标 + 周四无课）、标题点击回本周。
- 手工冒烟：移动端宽度横向滚动、时间列 sticky、深色模式配色正常。

### 涉及文件

```
新增：src/pages/WeekViewPage.tsx / .css、src/components/CourseEditModal.tsx / .css
修改：src/pages/CoursesPage.tsx / .css（视图切换 + 课表网格 + 弹窗迁出）、src/App.tsx、src/components/SideMenu.tsx、structure.md
```

## 2026-08-13 — 课程表视图折叠不重要时段

### 需求

课表视图（课程表页的二维网格）把不重要时段折叠起来：「0到7点，12到13点，22点到0点，可以折叠起来，根本就不重要」；澄清范围仅限课程表的视图（不涉及周视图/日视图）。

### 实现

- **多段折叠几何**（src/utils/time.ts 新增 `foldedGrid(folds, hourHeight, barHeight)`，不动 blockRenderRect 及其调用方）：返回 `{ gridHeight, barTops, mapMinute, rect }`——每个已结束折叠段扣除时长并累加折叠条偏移；rect 贴边/最小 20px 语义与 blockRenderRect 对齐（起点落入折叠段贴该条下方、终点贴该条顶部、整段内贴条下方 20px、末段贴网格底部）；折叠段要求非重叠、不跨夜，内部按开始时间排序。
- **课表视图**（CoursesPage.tsx / .css）：`UNIMPORTANT_FOLDS` 凌晨 0:00–7:00 / 午休 12:00–13:00 / 深夜 22:00–24:00 三段，`foldUnimportant` 组件状态**默认折叠**（不持久化）；折叠态走 foldedGrid（小时行跳过整点落入折叠段的小时，剩 14 行；3 条 `.ct-fold-bar` 折叠条仅展示不点击，z=4 高于课程块、低于 sticky 表头；网格上方 chip「折叠不重要时段」切换），展开态走原有 blockRenderRect 全 0–24h 路径（零回归面）；折叠态在列表↔课表切换间保留。

### 验证

- `n`npx vitest run` 404/404 通过（新增 test/时间网格点击映射/foldedGrid.test.ts 18 项：三段几何、分钟映射、跨段块、整段贴条 20px、边界时刻、跨夜、密度参数、乱序输入、非法时间）；`npm run build` 通过。
- 真实浏览器端到端（system Edge，临时 playwright-core 已卸载、临时脚本已删）19/19 项通过：默认折叠 3 条折叠条文案正确、14 行小时标签（07..11 + 13..21）、08:00 块 top=122 高 106.7、午课块贴午休条下方 top=402 高 20、晚课块止于深夜条顶高 64、chip 展开回 24h 块恢复全高、再折叠、列表↔课表切换保留折叠态、点课程块弹共享编辑弹窗、空白格无弹窗。
- 手工冒烟：移动端宽度横向滚动、折叠态滚动折叠条不盖 sticky 表头、深色模式配色正常。

### 涉及文件

```
修改：src/utils/time.ts（foldedGrid）、src/pages/CoursesPage.tsx / .css（折叠 chip + 折叠条 + 折叠态几何）、structure.md
新增：test/时间网格点击映射/foldedGrid.test.ts
```

## 2026-08-13 — DDL 截止清单

### 需求

「加入新功能——"ddl"，里面可以专门收录一些含有ddl的事件，有ddl事件的名称，有截止时间精确到分钟，有备注，备注可以涵盖若干张图片或文字内容，可以足够长」。

独立页面「DDL」（SideMenu 入口，路由 /ddl），只做收录：名称、截止日期+时间（精确到分钟）、备注（长文字 + 最多 9 张压缩图片）。宁少勿多：不做日程集成、不做通知、不做完成勾选；TabBar 不动。

### 实现

- **类型与存储**：src/types/index.ts 加 `DdlItem`（name / deadlineDate "YYYY-MM-DD" / deadlineTime "HH:mm" / notes / images≤9 / createdAt / updatedAt）；store.ts 完整镜像 courses 管道 21 点（CATEGORY_FILES 联合类型、StorageData/StoreShape、NumericTable、nextId/resetNextId、clearStore/countData、parseStorageData 旧备份缺字段兜底、hasAny、readNewStructure 三处（含仅 ddls.json 目录不被当首次使用）、DEFAULT_WRITE_ORDER、snapshot/全量写/指纹/增量写、mergeIntoStore/mergeLegacy、liveArr（回收站自愈依赖）、applyData）；db/index.ts 加 getAllDdls（截止时间升序：日期→时间→id）、saveDdl、deleteDdl（回收站标题 `DDL - 名称`、writeOrder 先写回收站）、TRASH_TARGET + restoreFromTrash `case 'ddls'`（重复 id 守卫）。
- **图片压缩**（src/utils/avatarCrop.ts 追加，模块顶层保持 DOM-free）：`compressImageToDataURL`（等比 fit 非方形，naturalWidth 取原始尺寸，JPEG q0.8，maxDim 1280）+ `fileToCompressedDataURL`（FileReader→Image，>4096px 先走现有 downscaleImage）；9 张 × 约 100-300KB ≈ 单条最多约 3MB，可接受。
- **截止时间纯函数**（新增 src/utils/ddl.ts）：`minutesUntilDeadline`（本地零点解析，格式+范围校验非法→null，floor 到分钟，负值=过期；**不用 UTC 的 todayStr()**，UTC+8 晚间会差一天）+ `ddlRemainText`（≤0→已过期、<60→剩 X 分钟、<1440→剩 X 小时、否则剩 X 天）。
- **页面**（新增 src/pages/DdlPage.tsx / .css，路由 /ddl，SideMenu「任务清单」后加 CalendarClock 条目）：列表卡片 = 名称 + `2026年8月13日 18:30` 截止 + 剩余徽章（过期红色）+ 备注两行预览 + 🖼N；页面内联弹窗（名称必填≤30字、date/time 必填、备注无长度限制、64px 缩略图网格 + 移除、隐藏 file input 选择后立即重置 value 允许重复选同一文件、压缩期间 busyImages 禁用保存防丢图）；删除 confirm 后进回收站；Android 返回键先关弹窗再退页。
- 回收站标签 `ddls: 'DDL'`；备份说明两处文件清单加 ddls.json。

### 验证

- `npm run build` 通过；`n`npx vitest run` **424/424** 全绿（新增 test/DDL清单/ddlTime.test.ts 13 项 + test/数据存储/store.test.ts「DDL 存储」7 项：升序往返、同日同时刻 id 兜底、images/长备注往返、回收站还原原 id、id 不复用、导出→重置→导入往返、仅 ddls.json 目录回归）。
- 真实浏览器端到端（system Edge，临时 playwright-core 已卸载、临时脚本已删）全部通过：种子 3 条（已过期/今日带图/三天后）列表升序过期在前、已过期红色徽章、备注预览、🖼1；新建（长多行备注）出现在列表且时间格式正确；编辑改名改时间同步；1×1 PNG setInputFiles → 压缩缩略图出现 → 保存 → reload 后图片仍在（ddls.json 往返）；删除确认进回收站（DDL 标签）→ 还原后列表与图片恢复；空名称保存报「请输入名称」；全程无页面 JS 错误。
- 手工冒烟：移动端宽度、深色模式配色正常。

### 涉及文件

```
新增：src/pages/DdlPage.tsx / .css、src/utils/ddl.ts、test/DDL清单/ddlTime.test.ts
修改：src/types/index.ts（DdlItem）、src/services/store.ts（ddls 管道 21 点）、src/db/index.ts（CRUD+回收站）、src/utils/avatarCrop.ts（图片压缩）、src/App.tsx（/ddl 路由）、src/components/SideMenu.tsx（DDL 条目）、src/pages/Trash.tsx（DDL 标签）、src/pages/BackupRestore.tsx（备份说明）、test/数据存储/store.test.ts（DDL 存储 7 项）、test/数据导入导出/jsonImport.test.ts（ddls 字段）、structure.md
```

## 2026-08-13 — 修复：Android 重装后不读公共 Documents 里的旧 JSON（存储权限）

### 需求

用户报告：卸载重装 App 后选回同一目录，应用不读取盘上已有 JSON（文件夹里数据还在，但软件不读）。

### 根因（APK 合并清单 + Capacitor 8 插件源码核实）

- 合并后 APK 的 AndroidManifest 只声明了 `INTERNET`（targetSdk 36），**没有任何存储权限**。
- Capacitor 8 Filesystem 的 `Directory.Documents` 在 Android 上映射到公共 Documents（`Environment.getExternalStoragePublicDirectory`，ionfilesystem-android 1.1.0 反编译确认），读写走原生 `java.io.File`。
- Android 11+ 沙盒存储拒绝应用对公共 Documents 里非媒体文件的直接读写（需「所有文件访问」MANAGE_EXTERNAL_STORAGE）；Capacitor 8 插件在 Android 13+ 上不再请求任何存储权限（`isStoragePermissionGranted` 恒 true），11-12 请求的 READ_EXTERNAL_STORAGE 又未在 manifest 声明（自动拒绝）。
- 后果链：initStore 读取全部失败（readdir 抛错→空、readFile→null）→ `readNewStructure` 返回 null → 应用按「无数据」启动；更危险的是此后任何写入会把空数组写回磁盘**覆盖 goals.json 等分类文件**；写入失败也只静默记录 `lastPersistError`（仅备份页可见）。

### 实现

- **原生插件** `android/.../DailyNoteStoragePlugin.java`（Java，MainActivity 注册）：`getStorageStatus`（apiLevel + 是否已授「所有文件访问」）、`requestAllFilesAccess`（跳转系统设置 App 专属页，部分 ROM 回退总开关页）。
- **store.ts**：注册同名 JS 插件桥（`@capacitor/core` registerPlugin，Web/测试环境安全）；新增 `storageAccessStatus / storageAccessBlocked / requestAllFilesAccess`；`initStore` 被阻塞时返回 `INIT_STORAGE_BLOCKED(-2)` 且**不动内存 store**（不误判空数据、不写回覆盖）；`changeStoragePath` 被阻塞时直接报错（防止把空数据写往新位置覆盖磁盘）。
- **main.tsx Boot**：新增 `storagePermission` 阶段——被阻塞时显示授权引导页（「去开启权限」/「已开启，重新检测」），从系统设置返回后经 `visibilitychange` + `appStateChange` 自动重新检测并加载数据。
- **AndroidManifest.xml**：加 `MANAGE_EXTERNAL_STORAGE`；`READ_EXTERNAL_STORAGE(maxSdk 32)` / `WRITE_EXTERNAL_STORAGE(maxSdk 29)` 供 Android 10-12 运行时权限对话框（10 由 Capacitor 插件自动请求）。
- 版本号 1.2（versionCode 3）。

### 验证

- 新增 `test/数据存储/storageAccess.test.ts` 8 个测试（vi.mock 模拟原生插件）：11+ 未授权阻塞/已授权放行、Android 10 不阻塞、Web 不阻塞、被阻塞时 initStore 返回 -2 且零写入、授权后恢复。`n`npx vitest run` **432/432 通过**（424 既有 + 8 新增）。
- `n`npm run build:apk` 全流程成功（tsc + vite + cap sync + gradle，Java 插件编译通过）；合并后 manifest 确认含 MANAGE_EXTERNAL_STORAGE、versionCode 3。
- 待真机验证：用户安装新 APK → 授权引导页 → 开启「所有文件访问」→ 自动恢复数据。

### 涉及文件

```
新增：android/app/src/main/java/com/dailynote/app/DailyNoteStoragePlugin.java、test/数据存储/storageAccess.test.ts
修改：android/app/src/main/AndroidManifest.xml（权限）、android/app/src/main/java/com/dailynote/app/MainActivity.java（注册插件）、android/app/build.gradle（版本 1.2/3）、src/services/store.ts（权限桥+守卫）、src/services/storage.ts（facade 转发）、src/main.tsx（授权引导页）、structure.md
```

## 2026-08-13 — 修复（续）：真机仍不可读的根因确认 + 导入错误细分 + 启动页版本号

### 需求

用户反馈权限修复后手机上「依然不可读」：浏览器（IndexedDB）正常；手机编辑会写成 JSON，但卸载重装后指定同一目录读不回数据；且导出后再导入提示「无效的数据文件格式」。

### 根因

1. **Android 11+ 沙盒存储的「归属权」规则**（外部资料核实）：未授予「所有文件访问」时，裸 File API 只能访问**本次安装**创建的文件。卸载重装后新安装的 UID 不再拥有旧文件——读旧文件 EACCES、listFiles/readdir 看不到别人的文件、但**新建文件仍可写**。这正好解释「能写新 JSON、读不回旧 JSON」：用户实测的 APK 没有走授权流程（旧 APK 无授权引导页；或新版未授权——新版未授权会被引导页拦住进不了应用，能进入且无数据 = 旧 APK）。
2. ionfilesystem-android 1.1.0 反编译核实：`listDirectory`（File.exists→isDirectory→listFiles）与 `readFile`（FileInputStream→UTF-8）同走裸 File API，无独立缺陷——未授权时两者一起被系统拒绝，与写入无关。
3. 导入报错是笼统的「无效的数据文件格式」，实际只有两种可能：选中的不是 JSON 文本（微信缓存二进制，特征字节 0xB1 0xAB，历史已知问题）或旧版导出的备份缺 `version`/`dailyPlans` 字段。

### 实现

- **store.ts `importJSONIntoStore`**：错误细分——空内容 / 非 JSON 文本（提示可能选到微信缓存/二进制文件）/ 非有效 JSON（损坏或选错）/ 非 DailyNote 格式（缺 version/dailyPlans，提示可能为旧版备份）。
- **main.tsx Boot**：启动 loading 与授权页底部显示 `DailyNote v{App.getInfo().version}`（Android 取 APK versionName），真机排查时可直接确认手机装的是哪个版本。
- 版本号：versionCode 3→4、versionName 1.2→1.2.1；package.json / package-lock.json 同步 1.2.1。

### 验证

- `n`npx vitest run` **433/433** 通过（store.test.ts 新增「错误信息区分具体原因」1 项：空文件/空白、微信缓存特征字节、缺字段、损坏 JSON 各报对应错误）。
- `n`npm run build:apk` 全流程成功；合并后 manifest 确认 versionCode 4 / versionName 1.2.1，MANAGE_EXTERNAL_STORAGE + READ/WRITE_EXTERNAL_STORAGE 均在。
- 待真机验证步骤（1.2.1）：安装后启动页应显示 v1.2.1 → 若未授权会进入 🔓 引导页 → 去开启「所有文件访问」→ 返回自动重新检测并恢复数据；导入时直接选 Documents 里的 `dailynote-backup-*.json` 本体（勿选微信缓存文件）。

### 涉及文件

```
修改：src/services/store.ts（导入错误细分）、src/main.tsx（版本号显示）、android/app/build.gradle（版本 1.2.1/4）、package.json / package-lock.json（1.2.1）、test/数据存储/store.test.ts（+1 测试）、structure.md
```

## 2026-08-13 — 修复（再续）：手机写出的 JSON 是乱码——writeFile 缺 encoding 被当 base64

### 需求

用户反馈新线索：把手机刚写出的 json 改成 txt 查看，内容完全是乱码——问题不在读而在写。

### 根因（ionfilesystem-android 1.1.0 字节码核实）

- store.ts 的 `Filesystem.writeFile` 从首个提交起就没传 `encoding`；readFile 传了 `Encoding.UTF8`（所以读路径没错，读出的「损坏」是写入造成的）。
- Capacitor 8 Filesystem 的原生契约：**writeFile 缺省 encoding 时 data 按 base64 解码**。Kotlin 插件 `getWriteFileOptions()` → `IONFILEEncoding.fromEncodingName(null)` 返回 `Default = IONFILEEncoding$Base64`。
- `IONFILELocalFilesHelper$saveFile$2` 字节码：Base64 路径 = `getData() → substringAfter(",") → trim() → android.util.Base64.decode(...)`（Android 的 Base64.decode **宽容跳过非法字符**，不抛错）→ 把解码出的二进制写入文件；`WithCharset` 路径才是 `OutputStreamWriter(charset).write(data)` 文本写入。
- 结果链：JSON 文本被当 base64 宽容解码 → 盘上文件全是乱码二进制 → 重装后 readFile 按 UTF-8 读出乱码 → JSON.parse 失败 → 按「损坏/无数据」处理；导出备份同样乱码 → 导入报「无效的数据文件格式」。浏览器版走 IndexedDB 不经 Filesystem，所以正常——这就是「电脑可读、手机不可读」的直接原因（叠加 Android 11+ 归属权问题）。

### 实现

- store.ts 两处 `Filesystem.writeFile`（增量写盘原语 + `exportBackupFile`）显式传 `encoding: Encoding.UTF8`，并加注释说明缺省会当 base64 写出乱码。
- 版本号：versionCode 4→5、versionName 1.2.1→1.2.2；package.json / package-lock.json 同步 1.2.2（顺带修复上一轮把 package-lock 根条目格式改坏的隐患，改为 JSON 解析后写回）。

### 验证

- 新增 `test/数据存储/nativeWriteEncoding.test.ts` 3 项（vi.mock @capacitor/filesystem + 模拟原生平台）：增量写盘必须带 `encoding: 'utf8'` 且 data 是 JSON 文本本身（以 `[` 开头、可解析、中文原样）；导出备份同样带 utf8 且 data 以 `{` 开头含 version；内存文件盘模拟磁盘的完整往返（写→重置→读回一致，原生分支从此纳入端到端测试覆盖）。`n`npx vitest run` **436/436** 通过。
- `n`npm run build:apk` 全流程成功；合并后 manifest 确认 versionCode 5 / versionName 1.2.2 + MANAGE_EXTERNAL_STORAGE。
- 待真机验证（1.2.2）：写出的 json 用文本查看器应是可读 JSON；卸载重装 + 授予「所有文件访问」后能读回；导出→导入正常。注：此前被写成乱码的文件无法恢复（宽容解码有损），旧有效数据若在盘上可被恢复；浏览器版 IndexedDB 中的数据可导出→导入到手机兜底。

### 涉及文件

```
修改：src/services/store.ts（两处 writeFile 加 encoding: UTF8）、android/app/build.gradle（1.2.2/5）、package.json / package-lock.json（1.2.2）、test/数据存储/nativeWriteEncoding.test.ts（新增 2 项）、structure.md
```

## 2026-08-14 — 精简所有用户可见文案（去"某某某"式长例子与冗余说明）

### 需求

用户反馈：代码里对用户显示的文案普遍不简洁，占位符多带"例如：早读英语、做物理题…"这类长例子，部分提示段落、按钮 tooltip、错误信息也有冗余说明。要求全部改为简洁而准确的提示语言——只删冗余、保留含义，不动交互逻辑与数据结构。

### 实现

纯文案替换（`placeholder` / `title` / `alert` / `confirm` / 页面提示文字），共 16 个文件、50+ 处：

- **占位符去长例子改字段名**：`例如：早读英语、做物理题...`→`任务名称`、`例如：高数作业提交`→`事件名称`、`例如：提高英语作文分数`→`目标名称`、`如：高等数学`→`课程名`、`如：三教 302`→`上课地点`、`具体要做什么？`→`要做什么？`、`实际完成了什么？有什么偏差？`→`实际完成情况`、`其他想记录的...`→`备注`、`具体描述遇到的问题...`→`遇到的问题`、`深入分析根本原因...`→`根本原因`、`具体的、可执行的改进方案...`→`改进方案`、`可写任意长度的文字说明...`→`备注说明`、`设置你的名字...`→`你的名字`、`新模板名称，例如：早起清单`→`模板名称`、`子任务内容...`→`子任务内容`、`补充说明...`→`描述`、`输入子文件夹名称（可选）`→`子文件夹名称（可选）`、`输入新的存储目录（可选）`→`存储目录（可选）`、`添加新任务...`→`添加任务`、`手动输入关联任务`→`输入关联任务` 等。
- **按钮 tooltip**：`填写验收项并保存后视为完成`→`验收并完成`、`撤销验收，恢复为未完成`→`撤销验收`。
- **alert / confirm**：`还没有创建固定作息模板，请先去「目标」页创建。`→`请先在「目标」页创建作息模板`、`还没有任务清单模板...`→`请先在「任务清单」页创建模板`、`还原失败，可能原始数据已不存在。`→`还原失败：原始数据已不存在`。
- **表单标签**（Reflection 全屏编辑器）：`🔍 发现了什么问题？`→`🔍 问题`、`🤔 原因是什么？`→`🤔 原因`、`💡 下次怎么改进？`→`💡 改进方案`。
- **空状态 / 引导提示**：Harvest 空状态与 bodyPlaceholder 去掉重复的 #关键字 说明、`大目标 → 拆解任务 → 每日计划`、`在上方输入框添加待办`、`#关键字 自动识别为标签`。
- **设置 / 偏好提示**：`此时间段在时间网格中折叠隐藏，节省空间`→`此时间段在时间网格中折叠`、`点击网格空白处创建任务时的默认时长`→`点击空白处创建任务时的默认时长`、`同一门课在多个星期都有课时...`→`多星期有课可多选，无需重复创建`。
- **长引导段落**（main.tsx 授权页、SetupPage、BackupRestore、CoursesPage 学期提示）：保留关键信息（卸载重装不丢、恢复路径、权限开关位置），删去冗余解释。
- **导入错误信息**（store.ts）：`文件内容不是 JSON 文本（可能选到了微信缓存/二进制文件，请选择导出的 .json 备份）`→`文件内容不是 JSON 文本`；`不是 DailyNote 数据文件（缺少 version/dailyPlans 字段，可能是旧版本导出的备份）`→`不是 DailyNote 数据文件（缺少 version/dailyPlans 字段）`。保留 `不是 JSON 文本` / `不是 DailyNote 数据文件` 前缀（store.test.ts 子串断言不变，测试无需改动）。

保留不动：加载/切换状态（`正在初始化...`、`加载中...`、`切换中...`）、删除确认的"删除后可在回收站恢复"、`可留空`、`0=未评分` 等本就简洁的必要信息。

### 验证

- `n`npx vitest run` **436/436 通过**（纯文案改动，未触及任何测试断言）。
- `npm run build`（tsc --noEmit + vite build + PWA）通过。
- Grep 复核无遗留 `例如：` / `如：` 占位符（time.ts 中仅剩代码注释，非用户可见）；残留 `...` 均为加载/状态类短文案，符合简洁要求。

### 涉及文件

```
修改：src/main.tsx、src/pages/{SetupPage,BackupRestore,DailyPlan,Reflection,Harvest,LongTermGoals,TaskListPage,SettingsPage,DdlPage,CoursesPage,Trash}.tsx、src/components/{TimeBlockCard,PreferencePanel,CourseEditModal}.tsx、src/services/store.ts
```

## 2026-10-23 — 新增「遗留问题」（backlog）

### 需求

记录"现在解决不了、等以后有能力再处理"的事。重点不是记录，而是**别记完就忘**：每条写清"困难"，用一个带一周宽限的气泡提醒回看。

### 实现

- **类型** `src/types/index.ts`：新增 `BacklogItem`、`BacklogStartMode`（age/date/text）、`BacklogStatus`（blocked/ready/resolved/dropped）、`BACKLOG_STATUS_LABELS`、`BACKLOG_BLOCKER_HINTS`。
- **时间纯函数** `src/utils/backlog.ts`：`startAtFromAge`（距今 N 年 M 月 D 日 → 起点时间戳，全空＝今天，月末夹取）、`ageFromStartAt`、`elapsedText`（历时文案）、`backlogAgeText`（文字填法原样显示）、`sortBacklog`（越久越前，文字垫底）、`isBacklogDue`/`countBacklogBadge`（阻塞中 + 超过 7 天没动）。
- **存储层** `src/services/store.ts`：新增第 12 张表 `backlog` → `backlog.json`。全触点同步：`StorageData`/`StoreShape`、`CATEGORY_FILES`、`NumericTable`、`nextId`/`resetNextId`/`clearStore`/`countData`/`applyData`/`snapshot`、`readNewStructure`（含空目录判定）、`hasAny`、`fingerprint`/`Fp`/`buildWriteSetFromStore`/`buildWriteSetDirty`、`mergeIntoStore`/`mergeLegacy`、`liveArr`、`parseStorageData`（旧备份兜底空数组）、`DEFAULT_WRITE_ORDER`。
- **CRUD** `src/db/index.ts`：`getAllBacklog`/`saveBacklog`/`setBacklogStatus`/`deleteBacklog`（软删除，`originalTable='backlog'`，标题 `遗留问题 - {title}`）；`TRASH_TARGET` + `restoreFromTrash` switch + `Trash.tsx` 标签。
- **Hook** `src/hooks/useBacklog.ts`：`useBacklog`（items/addItem/updateItem/changeStatus/removeItem）与 `useBacklogBadge`（window 事件 `dailynote-backlog-changed` 同步侧栏气泡）。
- **页面** `src/pages/BacklogPage.tsx/.css`：分组 `阻塞中`（历时降序）/`可推进`/`已解决`（折叠）/`已终止`（折叠）；卡片动作 仍阻塞·可推进·终止（可推进态为 退回阻塞·已解决·终止）；底部面板含 事项/起始三选一/困难（推荐词追加）/详情。
- **路由与入口**：`App.tsx` 加 `/backlog`，`SideNav` 气泡（>9 显示 9+），`SideMenu` 菜单项带同一数字。

### 关键设计

- 起始三种填法：距今 / 具体日期 / 文字（如"小时候"）。**两种数字填法保存时都折算成起点时间戳**，否则明天看"历时"不会增长；文字填法不参与计算与排序（垫底）。
- 气泡只数"阻塞中且超过 7 天没动"的条数，刚记/刚操作的不催，不显示 0。
- 困难推荐词是**追加**到已有文本末尾并空一格，不覆盖、不是选择题。

### 验证

- 新增 `test/遗留问题/backlog.test.ts` 20 项：CRUD/id 单调、状态流转重新计时、软删除与还原、`backlog.json` 持久化、增量写、旧备份兼容、导出导入往返、距今折算/历时文案/一周宽限/排序。
- `n`npx vitest run` **456/456 通过**；`npx tsc --noEmit` 通过。

### 涉及文件

```
新增：src/utils/backlog.ts、src/hooks/useBacklog.ts、src/pages/BacklogPage.tsx/.css、test/遗留问题/backlog.test.ts
修改：src/types/index.ts、src/services/store.ts、src/db/index.ts、src/App.tsx、src/components/{SideNav,SideMenu}.tsx/.css、src/pages/Trash.tsx
```

## 2026-10-23 — 菜单分层 + 日程页重排

### 需求

左侧菜单 9 项平铺显得乱，要求按使用频率分层；日程页"每个控件都被 1px 边框圈住、时间列表被框成一个小盒子、字小"，要求重做结构而不是修边框。

### 实现

- **菜单分层** `src/components/SideMenu.tsx/.css`：`MENU_GROUPS` 四组 —— `今天`（任务清单、DDL）/`安排`（课程表、周视图）/`长期`（长期目标、遗留问题+气泡）/`数据`（宏观视图、回收站、备份与恢复）；`设置` 固定到抽屉底部；分组标题小字灰。
- **日程页骨架重排** `src/pages/DailyPlan.tsx/.css`：
  - 去掉"页面内套固定高度滚动容器"的结构，改为整页连续滚动（`.dp-page`），内容贴住左侧导航直接开始，时间轴铺满宽度，右侧留 10px。
  - 顶部改为粘性头部 `.dp-head`（日期 + ‹ › + 今天 + 一周条 + 一行统计 + 工具图标），滚动时收起让位给时间轴。
  - 月历默认收起，点日期展开、选完自动收起（仍用 `DayNavigator`）。
  - 一周条 7 天（周一→周日），当天高亮，有计划的日子显示小圆点（`getAllPlans` 载入）。
  - 概览由三张卡片改为一行：`N 块 · M 已验收 · 专注 X`。
  - 新建入口改为右下角圆形 FAB（`openNewBlock` 与空白格点击共用逻辑）。
  - 去框化：网格容器无边框/阴影、小时线极淡、半小时刻度几乎不可见、时间刻度 11px、块标题 13px、块圆角 12px。
  - 自动滚动改为整页 `window.scrollTo`（原为滚内层容器）；点击换算仍用容器 rect + scrollTop（scrollTop 恒 0，映射不变）。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **456/456 通过**；`n`npm run build:apk` 全流程成功。
- 浏览器（Vite dev）手动点选：菜单四组、月历展开/收起、一周条切日、FAB 新建、空白格新建、概览数字随块变化。

### 涉及文件

```
修改：src/components/SideMenu.tsx/.css、src/pages/DailyPlan.tsx/.css
```

## 2026-10-24 — 任务清单重构为「悬浮球 + 树 + 标准文本结构」

### 需求

任务清单从菜单移出，改成常驻悬浮球；支持层级树填写、标准文本结构直接粘贴；完成后仍可改树且保留完成状态；清单条目可拖动排序。原「任务清单」页整体删除。

### 实现

- **纯函数** `src/utils/taskTree.ts`：`parseTaskText`（`- ` + Tab）、`linesToText`/`treeToLines`/`treeToText`、`linesToTree`（层级不可跳、按完整链回填 done）、`walkLeaves`/`leavesOf`（末级并列 + order 排序）、`leafKey`/`leafLabel`/`chainText`、`countUndone`、`toggleLeafDone`、`removeLeaf`（父节点空壳清理）、`moveKey`/`normalizeOrder`。
- **类型** `TaskNode` / `TaskBoard` / `TaskLeaf`（types/index.ts）。
- **存储** 第 13 张表 `taskBoard` → `taskboard.json`（单记录数组，id 恒 1），store.ts 全触点同步。
- **CRUD** `getTaskBoard` / `saveTaskBoard` / `toggleTaskLeaf` / `removeTaskLeaf`。
- **Hook** `src/hooks/useTaskBoard.ts`：`useTaskBoard`（nodes/leaves/undone/saveTree/toggle/remove/reorder）、`useTaskBadge`（`dailynote-task-changed` 事件同步球上数字）。
- **组件** `src/components/TaskBall.tsx/.css`：可拖动悬浮球（`TODO` / 未结束数）+ 清单面板（`…` / 方框 / `✕`、拖动排序）+ 填写面板（层级四键 / 文本模式）+ 链路弹窗。
- **删除** `src/pages/TaskListPage.tsx/.css`、`/tasks` 路由、菜单「任务清单」项。

### 关键设计

- 末级判定与状态匹配都用**完整链**（`实验/电子技术实验/实验报告`），不用 `父-子`，否则同名条目会串状态。
- 完成状态在重建树时按完整链回填：改树不丢已完成状态；删掉再加回同名条目也能恢复。
- 球点开分支：没有任何任务 → 填写面板；已有任务 → 清单面板，右上「继续编辑」回到树。
- 清单顺序单独存 `order`（完整链数组），拖动只改 order，不动树结构。

### 验证

- 新增 `test/任务/taskTree.test.ts` 23 项；`n`npx vitest run` **479/479 通过**（15 个文件）。
- `n`npx tsc --noEmit` 通过；浏览器（Vite dev）点选：拖动球、TODO/数字切换、层级四键、文本粘贴、完成后清单、方框减数、`…` 链路、继续编辑保留状态。

### 涉及文件

```
新增：src/utils/taskTree.ts、src/hooks/useTaskBoard.ts、src/components/TaskBall.tsx/.css、test/任务/taskTree.test.ts
修改：src/types/index.ts、src/services/store.ts、src/db/index.ts、src/App.tsx、src/components/SideMenu.tsx
删除：src/pages/TaskListPage.tsx/.css、/tasks 路由、菜单「任务清单」
```

## 2026-10-24 — 左侧栏改常驻展开 + 层级行就地编辑

### 需求

去掉折叠用的「三」，左侧栏直接展开，否则气泡要打开菜单才看得见；层级填写里点任意一行要能直接改。

### 实现

- **左侧栏展开** `src/components/SideNav.tsx/.css`：56px 图标条 → 76px 图标+文字常驻栏，三组用细分割线分开（`DDL/课程表/周视图` ｜ `目标/遗留` ｜ `宏观/回收站/备份`），`设置` 固定底部；遗留问题的气泡直接挂在「遗留」上。
- **抽屉菜单删除** `src/components/SideMenu.tsx/.css` 整体删除，`App.tsx` 去掉 `menuOpen` 状态与返回键拦截；宽度改用 CSS 变量 `--nav-w: 76px`（`App.css`），`TabBar.css` 的居中偏移同步跟着变量走。
- **行就地编辑** `src/components/TaskBall.tsx/.css`：层级模式点任意一行 → 该行变输入框（`editing` 状态），回车/失焦提交、Esc 取消、清空则保留原样；此时四个键作用在**这一行**（缩进/缩退改该行层级，删除删该行），`第 N 层` 跟随当前行。
- **输入框可见化**：底部新增行的输入框原来是无边框透明样式，看着像普通文字，改为白底圆角带描边、聚焦变紫。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **479/479 通过**；`n`npm run build:apk` 全流程成功（4.88 MB）。
- 浏览器点选：栏内各项跳转与高亮、气泡位置、点行就地改、Esc 取消、空内容不改、四个键对当前行生效。

### 涉及文件

```
修改：src/components/SideNav.tsx/.css、src/components/TaskBall.tsx/.css、src/App.tsx、src/App.css、src/components/TabBar.css
删除：src/components/SideMenu.tsx/.css
```

## 2026-10-25 — DDL 一周内红点 + 全局内容搜索

### 需求

1. DDL 剩余时间不足一周时，侧栏 DDL 项冒红点数字。
2. 增加全局内容搜索：只搜用户自己填入的内容（不含界面文案、不含日期），结果要指明位置并能直接跳到对应页面。

### 实现

- **DDL 红点**：`src/utils/ddl.ts` 新增 `countDdlNear(ddls, now)` 与 `DDL_NEAR_MIN`（7 天，含已过期、格式非法不计）；`src/hooks/useDdlBadge.ts` 计算并监听 `dailynote-ddl-changed`；`db` 的 `saveDdl`/`deleteDdl` 末尾派发该事件；`SideNav` 的 DDL 项显示气泡。
- **全局搜索**：
  - `src/utils/search.ts` 的 `searchStore(data, q, limit)`：遍历时间块（标题/计划/实际执行/备注/清单项）、反思、收获、长期目标（含子任务）、遗留问题（标题/困难/详情/文字起始）、DDL（名称/备注）、课程（课程名/教师/地点）、任务树（节点标题）。**不索引日期、不索引界面文案**。
  - `db.searchEverything(q)` 暴露给 UI。
  - `src/components/SearchOverlay.tsx/.css`：顶部搜索框 + 结果列表（标题 + 命中片段 + 位置），点一条即跳转；日维度内容带 `?date=`，任务节点通过 `dailynote-open-tasks` 事件打开悬浮球面板。
  - `SideNav` 顶部新增「搜索」入口（放大镜图标）。
  - `DailyPlan` / `Reflection` / `Harvest` 支持 `?date=` 参数（搜索跳转时定位到那天）。

### 关键设计

- 搜索源是内存 store 的快照，不做全文索引、不加依赖；只走用户输入字段，硬编码文案天然搜不到。
- 结果为「位置 + 片段」而非只给标题，方便判断是哪一天/哪个模块。
- 任务树没有独立页面，用事件让悬浮球面板打开，避免为搜索再造一个页面。

### 验证

- 新增 `test/搜索/search.test.ts` 18 项：命中用户内容、不命中界面文案与日期、路由与位置文案、任务 `onOpen`、大小写、空查询、limit、DDL 一周计数（含过期/非法）。
- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **497/497 通过**（16 个文件）；`n`npm run build:apk` 成功（4.88 MB）。

### 涉及文件

```
新增：src/utils/search.ts、src/components/SearchOverlay.tsx/.css、src/hooks/useDdlBadge.ts、test/搜索/search.test.ts
修改：src/utils/ddl.ts、src/db/index.ts、src/components/SideNav.tsx/.css、src/components/TaskBall.tsx、src/App.tsx、src/pages/{DailyPlan,Reflection,Harvest}.tsx
```

## 2026-10-25 — 三页美化 + 周视图可编辑 + 原生对话框替换

### 需求

1. DDL / 课程表 / 周视图三页"棱角分明、到处都是框"，要按计划页那套去框化重做；周视图的网格同样是"框死"的问题。
2. DDL 删除键点击无反应；周视图点空白不能新建、点任务不能编辑；周视图缺少睡眠折叠。
3. 周视图不要自己再造一套编辑窗（重复造轮子），要和日计划一致。

### 实现

- **去框化**（DDL / 课程表 / 周视图）：`1px 描边` → 极淡阴影或纯留白；圆角统一放大（卡片 14、块 10）；字号上调一档；网格容器去掉边框/阴影/圆角并左右各出血 8px；小时线改极淡 1px；周视图新增极淡列分隔线；DDL 徽章与缩略图改填充式、无描边；课程表视图切换改胶囊底；折叠条去掉渐变块只留虚线。
- **DDL 删除无反应**：根因是 `window.confirm` 在安卓 WebView 里静默返回 false。新增 `components/ConfirmDialog.tsx`（应用内确认/提示框，支持纯提示的单按钮模式），DDL、遗留问题、课程删除、特殊日期删除、清空回收站、还原失败提示、日计划的两处 `alert` 全部改为它。
- **DDL 时间可选**：`utils/ddl.ts` 引入 `DDL_DEFAULT_TIME = '23:59'`，时间空串/空白按 23:59 参与剩余时间、红点计数与排序；表单不再强制填时间，卡片无时间时只显示日期，页面不写任何"默认 23:59"的说明。
- **周视图可编辑**：`utils/time.ts` 抽出 `minutesToTop` / `topToMinutes`（`blockRenderRect` 复用同一公式）。点空白处 → 按列定位日期、按 y 反算时间，跳转 `/?date=<日>&new=<HH:mm>`；点任务块 → `/?date=<日>&block=<id>`；日计划消费这两个参数打开自己的新建/编辑面板，用后 `replace` 清掉参数。
- **周视图睡眠折叠**：与日计划同一套（折叠条 28px、`minutesToTop` 映射、小时行跳过折叠时段、块贴边界）。
- **删掉重复轮子**：`WeekTaskSheet.tsx/.css` 删除，周视图不再自带编辑窗。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **498/498 通过**（16 个文件，新增 DDL 空时间用例）；`n`npm run build:apk` 成功（4.88 MB）。
- 代码库内已无 `window.confirm` / `alert` 调用。

### 涉及文件

```
新增：src/components/ConfirmDialog.tsx/.css
修改：src/pages/{DdlPage,CoursesPage,WeekViewPage,BacklogPage,Trash,DailyPlan}.tsx + 三个页面的 css、src/utils/{ddl,time}.ts、src/db/index.ts、src/types/index.ts
删除：src/components/WeekTaskSheet.tsx/.css
```

## 2026-10-25 — 删除「宏观视图」页

### 需求

宏观视图不再需要，整页删除。

### 实现

- 删除 `src/pages/Dashboard.tsx/.css`，移除 `/dashboard` 路由与侧栏「宏观」入口。
- 随之变成死代码的组件与 Hook 一并删除：`components/CalendarHeatmap.tsx/.css`、`components/TrendChart.tsx`、`hooks/useStats.ts`（全项目已无引用）。
- `recharts` 依赖暂时保留在 `package.json` 里（已无源码引用，不会打进包），留待下次统一清依赖。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **498/498 通过**；`n`npm run build:apk` 成功（4.86 MB，比上一版小 0.02 MB）。
- 侧栏只剩 `安排 / 长期 / 数据` 三组。

### 涉及文件

```
删除：src/pages/Dashboard.tsx/.css、src/components/{CalendarHeatmap.tsx,CalendarHeatmap.css,TrendChart.tsx}、src/hooks/useStats.ts
修改：src/App.tsx、src/components/SideNav.tsx
```

## 2026-10-25 — 新增「重要的事」页

### 需求

新增「重要的事」页面：提示即将到来的重要事项，进入 3 天内侧栏冒气泡数字；页面与 DDL 的添加页完全同构，只是文案略有不同。

### 实现

- **先抽公共页**：把原 `DdlPage` 的整页逻辑抽成 `components/DeadlineListPage.tsx`（列表 + 卡片 + 新建/编辑弹窗 + 图片上传 + 删除确认），文案与数据源参数化；`pages/DdlPage.tsx` 变薄包装，`pages/ImportantPage.tsx` 用同一组件、换文案。
- **第 14 张表** `important` → `important.json`：store 全触点（StorageData/StoreShape/CATEGORY_FILES/NumericTable/nextId/resetNextId/clearStore/countData/applyData/snapshot/fingerprint/buildWriteSet*/DEFAULT_WRITE_ORDER/mergeIntoStore/mergeLegacy/liveArr/parseStorageData/readNewStructure/hasAny）。
- **CRUD** `getAllImportant`（按日期→时间→id 升序，时间空按 23:59）、`saveImportant`、`deleteImportant`（软删除，`originalTable='important'`，标题 `重要 - 名称`）；`TRASH_TARGET` + 还原 switch + 回收站标签。
- **气泡**：`utils/ddl.ts` 加 `IMPORTANT_NEAR_MIN = 3 天` 与 `countImportantNear`；`hooks/useImportantBadge.ts` 监听 `dailynote-important-changed`；侧栏新增「重要」（在 DDL 下方）带气泡。
- 路由 `/important`。

### 验证

- 新增 `test/重要的事/important.test.ts` 11 项：CRUD 与升序、软删除还原、`important.json` 持久化、旧备份兼容、三天阈值（含过期/边界/非法/空时间）。
- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **509/509 通过**（17 个文件）；`n`npm run build:apk` 成功（5.03 MB）。

### 涉及文件

```
新增：src/components/DeadlineListPage.tsx/.css（由 DdlPage 抽出）、src/pages/ImportantPage.tsx、src/hooks/useImportantBadge.ts、test/重要的事/important.test.ts
修改：src/pages/DdlPage.tsx（变薄）、src/types/index.ts、src/services/store.ts、src/db/index.ts、src/utils/ddl.ts、src/App.tsx、src/components/SideNav.tsx、src/pages/Trash.tsx
删除：src/pages/DdlPage.css（搬进组件目录）
```

## 2026-10-25 — 重要的事：搜索接入 + 过期收起

### 需求

搜索搜不到「重要的事」（新增表没接进搜索，牵一发动全身）。另外已到达的重要事件应在过期一天后隐藏，并提供搜索之外的查看方式。

### 实现

- **搜索接入** `src/utils/search.ts`：索引 `important` 的名称与备注，位置显示「重要 · 日期 时间」，跳 `/important`。
- **过期收起** `src/utils/ddl.ts` 新增 `IMPORTANT_KEEP_AFTER_MIN = 1 天` 与 `splitDeadlineItems(items, now, hideAfterMinutes)`；`DeadlineListPage` 新增 `hideAfterMinutes` 参数，主列表只显示未收起的，其余收进底部「已过期 N 件 · 展开」（默认折叠，点开即查）。
- **气泡同口径**：`countImportantNear` 排除已收起（过期超过一天）的条目，避免"气泡有数、列表没有"。
- 时间格式非法的条目不参与收起判定（留在 visible，不因解析失败藏用户数据）。
- DDL 页不传 `hideAfterMinutes`，行为不变（过期仍显示）。

### 验证

- `test/重要的事/important.test.ts` 扩到 15 项；`test/搜索/search.test.ts` 扩到 20 项；`test/DDL清单/ddlTime.test.ts` 14 项。
- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **515/515 通过**（17 个文件）；`n`npm run build:apk` 成功（4.86 MB）。

### 涉及文件

```
修改：src/utils/search.ts、src/utils/ddl.ts、src/components/DeadlineListPage.tsx/.css、src/pages/ImportantPage.tsx、test/搜索/search.test.ts、test/重要的事/important.test.ts、test/DDL清单/ddlTime.test.ts
```

## 2026-10-25 — DDL/重要的事：地点 + Markdown 备注 + 图片查看

### 需求

1. 编辑信息要包含「地点」。
2. 备注支持 Markdown，保存后能看到渲染效果。
3. Bug：备注图片打不开（手机/电脑都点不开）。
4. 同源：重要的事同步修改。

### 实现

- **地点**：`DdlItem` 新增 `location`（`ImportantItem` 是它的别名，自动同步）；表单加「地点」输入，卡片在截止时间行显示 📍 地点；搜索也索引了地点。
- **Markdown 备注**：新增 `src/utils/markdown.ts`（零依赖）—— 支持标题/粗斜体/删除线/行内代码/代码块/有序无序列表/引用/分割线/链接，**先转义再套标记**（写 `<script>` 只会显示成文本）。
  - 编辑弹窗里备注分「编辑 / 预览」两态；
  - 卡片上的备注直接渲染 Markdown（限高截断），保存后立刻看到效果。
- **图片打不开**：原来只有缩略图、点了没任何反应。新增 `components/Lightbox.tsx`（全屏查看、多图左右切换、Esc/点背景关闭、Android 返回键优先关它）：
  - 卡片上有图时显示前 3 张缩略图 + 张数，点任一张打开大图；
  - 编辑弹窗里的缩略图也可点开大图（缩放光标提示）。
- 因为 DDL 与「重要的事」共用 `DeadlineListPage`，以上三处改动两边同时生效。

### 验证

- 新增 `test/DDL清单/markdownAndLocation.test.ts` 10 项：Markdown 各语法、XSS 转义、`markdownToPlain`、地点在 DDL/重要的事上的往返；搜索测试补地点命中。
- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **525/525 通过**（18 个文件）；`n`npm run build:apk` 成功（4.86 MB）。

### 涉及文件

```
新增：src/utils/markdown.ts、src/components/Lightbox.tsx/.css、test/DDL清单/markdownAndLocation.test.ts
修改：src/types/index.ts、src/components/DeadlineListPage.tsx/.css、src/utils/search.ts、test/搜索/search.test.ts
```

## 2026-10-25 — DDL/重要的事：图片识别自动填时间地点（ML Kit 路线）

### 需求

给备注图片做识别，自动抽出「时间」「地点」填进字段，并把「要求信息」「邮箱」等要点写进备注。原计划用 LFM2.5-VL-450M 端侧视觉模型，最终定为：**先走 ML Kit OCR + 规则（C）**，VLM（A）后续按需接入。

### 实现

- **模型调研与下载**：确认 `LiquidAI/LFM2.5-VL-450M` 有 ONNX（520–650MB）与 GGUF（Q4_K_M 218.7MB + mmproj-Q8 98.1MB）两套官方量化；huggingface 直连超时、`hf-mirror.com` 可用（实测约 4 分钟下完 317MB），权重已下到 `D:\dailynote-models\` 并校验 GGUF 魔数。本机**无 Android NDK**，原生 llama.cpp 路线需先装 NDK，因此本轮不做。
- **抽取器** `src/utils/extract.ts`：文本 → `{title, date, time, location, emails, requirements, notes}`。规则包含全角转半角、`2026年11月2日`/`11月8日`/`今天明天后天`、`下午2:30`/`14点30分`→24 小时制、带「地点：」标签优先 + 教室/楼/馆短行兜底（提示类行不误判）、要求类关键词行去项目符号、邮箱去重；备注按 `**要求**` / `**邮箱**` 两段组装。
- **原生插件** `android/.../MlkitOcrPlugin.java`（`@CapacitorPlugin(name = "MlkitOcr")`）：接收 data URL → 解码 → 超 1600px 先缩放 → `ChineseTextRecognizerOptions` 识别 → 返回整段文本 + 逐行文本与 top 坐标；`MainActivity` 注册。
- **依赖**：`com.google.mlkit:text-recognition-chinese:16.0.1`（模型随包，离线、不需要 GMS）。
- **桥接** `src/services/ocr.ts`：`ocrAvailable()` / `recognizeImage(dataUrl)`，Web 端直接抛 `not-native`。
- **界面** `DeadlineListPage`（DDL 与重要的事共用）：编辑弹窗新增「从图片识别」→ 选图 → 识别 → 「识别结果」核对面板（名称/日期/时间/地点/要求条数/邮箱）→ 「填入」只覆盖有值的字段，备注追加不覆盖；失败或 Web 端用应用内提示。
- **瘦身**：ML Kit 自带 4 个 ABI 的原生库（x86/x86_64 各 11MB），用 `packaging.jniLibs.excludes` 去掉模拟器 ABI，APK 从 **48 MB → 24.6 MB**。

### 验证

- `n`npx tsc --noEmit` 通过；`n`npx vitest run` **541/541 通过**（19 个文件，新增 `test/识别/extract.test.ts` 16 项）。
- `n`npm run build:apk` 成功；`MlkitOcrPlugin.class` 已在 javac 产物中，APK 内只含 `arm64-v8a` / `armeabi-v7a`，ML Kit 模型 25 个资源已打包。
- **未验证**：真机上的识别效果（本机无设备/模拟器），需装包实测。

### 涉及文件

```
新增：src/utils/extract.ts、src/services/ocr.ts、android/app/src/main/java/com/dailynote/app/MlkitOcrPlugin.java、test/识别/extract.test.ts
修改：android/app/build.gradle（ML Kit 依赖 + abiFilters + jniLibs excludes）、android/app/src/main/java/com/dailynote/app/MainActivity.java、src/components/DeadlineListPage.tsx/.css
## 2026-10-25 — 图片识别：逐行可改可删 + 去重/冲突请示 + 识别全部图片

### 需求

识别的信息对错混杂，要能逐条改、逐条删；已有的相同内容不要重复填，值不同要请示；识别按钮移到备注图片栏，并识别全部备注图片。

### 实现

- **可编辑核对面板**：识别结果改为逐行输入框，每行可改；✕ 删除该行；`fill` / `skip`（已存在）/ `conflict` 三态标注。
- **去重与冲突** `utils/extract.ts` 新增 `planExtraction(info, current)` 与 `parseExistingNotes(notes)`：
  - 表单值或备注里已有**完全相同**的 → `skip`，不重复填；
  - 已有**不同**的值 → `conflict`，行内给「保留原值 / 用识别值」，默认保留原值；
  - 要求条目按行去重；邮箱额外区分「已有别的邮箱」→ 冲突；
  - `parseExistingNotes` 先剔 `**要求**` 这类加粗标题再剥项目符号（否则 `*` 会被当符号吃掉）。
- **识别全部图片**：按钮移到「备注图片」标题右侧，一次识别 `form.images` 中所有图（逐张 OCR，文本合并后统一抽取）；没有图片时提示先添加。
- 填入时备注仍为追加：只写用户确认采用的要求与邮箱。

### 验证

- `test/识别/extract.test.ts` 扩到 23 项（空表单全填、相同跳过、不同冲突、邮箱相同/不同、要求去重、parseExistingNotes 剥符号）。
- 
`npx tsc --noEmit` 通过；
`npx vitest run` **548/548**（19 文件）；
`npm run build:apk` 成功（24.64 MB）。

### 涉及文件

```
修改：src/utils/extract.ts、src/components/DeadlineListPage.tsx/.css、test/识别/extract.test.ts、structure.md
## 2026-10-25 — 图片识别：状态栏时钟 / 截止行 / 界面噪声修复

### 问题（实测反馈）

1. 截图顶部的状态栏时钟 `20:02` 被当成截止时间，真正的 `截止时间：2026-11-02 23:59` 反而进了备注「要求」。
2. `截止时间：…` 这类声明行被当成要求条目。
3. OCR 到 App 自己的 DDL 页截图时，`DDL / 搜索 / 共4个截止事项 / 事件名称 / 截止时间 / 地点` 等界面文案被当成内容。
4. 没有有效信息时仍硬凑出条目。

### 实现

- **时间改为按行打分**：与「截止/时间」同行 +5、与日期同行 +3、含时间词 +2；孤立的 `HH:MM` −6（且在前三行再 −2），得分 <1 直接丢弃 → 状态栏时钟不会被采纳。
- **日期优先取「截止」行**：先按是否含截止/时间词排序，再解析；`截止时间：2026-11-02 23:59` 的日期与时间都能取到。
- **要求过滤声明行**：`截止/时间/日期/地点/deadline` 开头的行不算要求；同时排除界面文案、孤立时间/日期、地点行、含邮箱的行。
- **界面噪声黑名单**：`DDL / 搜索 / 添加 / 编辑 / 事件名称 / 截止时间 / 地点 / 名称 / 保留原值 / 用识别值 / 共N个截止事项` 等整行匹配即忽略。
- **名称判据收紧**：排除界面词、孤立时间/日期、纯数字符号、含日期的行；优先「关于/主题」与业务名词（通知/作业/报告/会议/答辩/活动/考试…）。
- 全空时组件提示「这几张图里没找到可用信息」，不再硬凑。

### 验证

- 新增 8 项回归测试（用户给的两张截图原文）：`test/识别/extract.test.ts` 扩到 36 项。
- 
`npx tsc --noEmit` 通过；
`npx vitest run` **561/561**（19 文件）；
`npm run build:apk` 成功（24.81 MB）。

### 涉及文件

```
修改：src/utils/extract.ts、test/识别/extract.test.ts、structure.md
## 2026-10-25 — 启动改为快照式增量读取

### 需求

每次启动都要扫描整个存储目录（每个日期目录读 4 个文件），天数一多就是上千次桥接调用，很慢。要像 git 一样只同步变化的部分。

### 实现

- **新增 `services/snapshot.ts`**：把上次读入/写出的整份数据存进 IndexedDB（`dailynote_snapshot`，不放进用户数据目录），记录 `root + dates + files + data`。
- **启动快路径**（`store.ts` 的 `readBackend`）：
  1. 旧单文件存在 → 仍走迁移路径（本来就要读它）。
  2. 只列一次 `days/` 与根目录的**文件名**（不读内容）。
  3. 日期集合与快照一致 → 直接用快照数据，**零文件读取**。
  4. 日期集合变化 → 全量读取并刷新快照。
- **快照刷新**：写盘成功后 400ms 防抖落盘，`flush()` 时立即落盘；「切后台」会走 flush。
- **兜底入口**：`rescanFromDisk()` 丢弃快照后全量重读，挂在「备份与恢复 → 重新扫描存储目录」。
- `_resetForTest()` 同时清快照，避免测试互相污染。

局限（已写进结构文档）：外部直接改某天的**文件内容**（名字不变）不会被自动发现，需点「重新扫描存储目录」。

### 验证

- 新增 `test/数据存储/startupSnapshot.test.ts` 6 项：快照命中不重读、日期变化失效、rescan 读入外部改动、换目录不复用、`sameNames` 顺序无关、清空后可再写。
- 
`npx tsc --noEmit` 通过；
`npx vitest run` **567/567**（20 文件）；
`npm run build:apk` 成功（24.81 MB）。

### 涉及文件

```
新增：src/services/snapshot.ts、test/数据存储/startupSnapshot.test.ts
修改：src/services/store.ts（快照快路径 + 防抖写快照 + rescanFromDisk）、src/pages/BackupRestore.tsx、structure.md
```
```
## 2026-10-25 — 图片识别：补「图与图之间」的冲突

### 需求

除「图片 vs 已有信息」的矛盾外，多张备注图片之间同一字段给出不同值时也要请示。

### 实现

- `utils/extract.ts` 新增 `mergeExtractions(list)`：每张图各自抽取后合并 —— 名称/日期/时间/地点的值去重成候选集合（>1 即为图与图冲突），要求与邮箱取并集。
- `planExtraction(info, cur, candidates)` 接收候选：候选 >1 时把全部候选挂到对应行（`candidates`），行的 `action` 仍按与表单的比较得出，因此**「图与图冲突」与「与表单冲突」可同时出现在同一行**。
- 组件 `DeadlineListPage`：OCR 改为**逐张抽取再合并**（原来是文本直接拼接、只有第一个命中生效）；核对面板每行增加「图与图不同」候选 chip，点选即采用该值。
- 顺手修：要求行剥离「要求：/注意：/须知：」这类标签前缀（原来会把标签一起当内容）。

### 验证

- `test/识别/extract.test.ts` 扩到 28 项（时间不同进候选、相同不产生候选、要求/邮箱并集去重、候选挂到行上、图冲突与表单冲突并存）。
- 
`npx tsc --noEmit` 通过；
`npx vitest run` **553/553**（19 文件）；
`npm run build:apk` 成功（24.64 MB）。

### 涉及文件

```
修改：src/utils/extract.ts、src/components/DeadlineListPage.tsx/.css、test/识别/extract.test.ts、structure.md
```

## 2026-10-26 — 计划页：红线贴边 / 只看未来 / TODO 全部完成庆祝

### 需求

1. 计划页「现在」红线位置有偏移：红点不在列表边缘，落在列表中间。
2. 计划页新增「只看未来」——把用户当前时刻之前的时间段折叠起来。
3. TODO 里所有任务完成的瞬间，自动跳出庆祝弹窗，要有图、要走心。

### 实现

- **红线偏移（根因是两套坐标叠加）**：`DailyPlan.css` 末段重排把 `.now-line` 改成 `left: 46px`，而圆点 `.now-dot` 仍是旧布局的 `margin-left: 40px`，于是圆点被推到内容区里侧 38px（实测圆点 162、任务块左边缘 124）。改为 `.now-line { left: 48px; right: 10px }` + `.now-dot { margin-left: -4px }`：圆点圆心正好压在任务块左边缘，红线尾部与块右边缘齐平（实测圆点 120–128 / 块 124，线 124–420）。
- **只看未来**：`utils/time.ts` 新增 `futureFoldStart`（折叠起点取当前小时起点，网格每小时只跳一次）与 `futureWindow`（折叠条偏移 + 分钟↔top 映射与反算 + 块矩形）。页面侧：`prefs.futureOnly` 持久化（默认关）；工具条新增 `SkipForward` 开关（只在今天显示，开启态高亮）；网格顶部折叠条「⏩ 只看未来 · 00:00–11:00 已折叠 · 点此展开」，点一下即还原；小时标签/任务块/课程块/点空白新建/当前时间线全部走同一套映射；跨折叠起点的块从折叠条下方开始渲染并保留真实起止，整块落在过去的块不渲染；开启时回到页面顶部让折叠条可见。与「隐藏睡眠」互斥（折叠条接管顶部），看别的日期不折叠。
- **庆祝弹窗**：新增 `components/CelebrationDialog.tsx/.css`——内联 SVG 笑眯眯星星（光晕/星屑/纸屑 + 轻微浮动）＋ 6 条随机走心文案 ＋ 昵称与完成件数 ＋ 纸屑飘落动画，z-index 600。判定用新增纯函数 `utils/taskTree.ts#completesAll(leaves, key)`：只有「这一下正好勾掉最后一条未完成」才弹（取消勾选、清空清单、删任务都不弹）。`TaskBall` 的勾选改走 `toggleLeaf`，先把判定算在 await 之前再写入。

### 验证

- 新增 `test/时间网格点击映射/futureWindow.test.ts` 20 项、`test/任务/celebration.test.ts` 7 项。
- `npx tsc --noEmit` 通过；`npx vitest run` **593/593**（22 文件）。
- 用无头 Chrome 跑**真实 App**（临时脚本预置 IndexedDB 数据、走启动流程）核对行为，不靠静态推断：
  - 红线：圆点 120–128、任务块 124、红线 124–420（修复前圆点 162、块 124）。
  - 只看未来：网格 856px（24 + 13×64）、小时标签 11:00–23:00、折叠条文案正确、点折叠条下方 4h 处新建得到 15:10–16:10、点折叠条展开后回到 16 个标签且 `futureOnly` 落盘为 false。
  - 切到次日：无折叠条、工具条少一个按钮（开关不显示）、标签恢复 16 个。
  - 庆祝：两条任务勾掉最后一条后 `.celebration-card` 出现，文案/件数/插画正常。
- 临时视觉验证脚本与截图 `test/_visual/` 已删除。

### 涉及文件

```
新增：src/components/CelebrationDialog.tsx/.css、test/时间网格点击映射/futureWindow.test.ts、test/任务/celebration.test.ts
修改：src/utils/time.ts、src/utils/taskTree.ts、src/hooks/usePreferences.ts、src/pages/DailyPlan.tsx/.css、src/components/TaskBall.tsx、structure.md
删除：test/_visual/（临时视觉验证脚本与截图）
```

## 2026-10-26 — DDL 关联内容：内置课程组 + 自定义分组

### 需求

创建 DDL 时可以直接关联内容。第一批能关联的是课程表里的**有效课程**（在本学期、且在课程周期之内；上学期的课不算，还没开讲的课不算）。「课程」是内置组、永远跟课程表同步；此外可以自定义别的分组。
注意：DDL 与「重要的事」共用同一个列表组件，**重要的事里必须没有关联入口**。

### 实现

- **数据模型**：`DdlLink { kind:'course'|'group', id, label, groupName? }`，存的是快照 —— 课程/分组以后被删，DDL 上仍显示当时的名字。`DdlItem.links?`；新增 `LinkGroup { name, items[] }`，即第 15 张表 `linkGroups`（`linkGroups.json`）。
- **新表全部触点**（store.ts）：`StorageData`/`StoreShape`、`CATEGORY_FILES`、`NumericTable`、`nextId`/`resetNextId`、`clearStore`、`countData`、`applyData`、`snapshot`、`fingerprint`/`Fp`、`buildWriteSetFromStore`、`buildWriteSetDirty`、`DEFAULT_WRITE_ORDER`、`mergeIntoStore`、`mergeLegacy`、`liveArr`、`parseStorageData`、`readNewStructure`、`hasAny`、`CATEGORY_NAMES`。
- **有效课程** `utils/courseSchedule.ts#effectiveCourses`：学期已设置 + 当前周在 `[startWeek, startWeek+weekCount-1]` + 单双周匹配；另加 `currentWeekOf`（面板上的「第 N 周」）。未开讲、已结课、本周不上（单双周不合）都不算。
- **关联纯函数** `utils/ddlLinks.ts`：生成（`courseLink`/`groupLink`）、`linkKey`、`toggleLink`/`hasLink`、展示（`linkText`/`linkIcon`/`courseWeeksText`）、落库前整理 `normalizeLinks`（去空名、去重、保序）。
- **存储与 Hook**：`db.getAllLinkGroups/saveLinkGroup/deleteLinkGroup`（软删除进回收站，`originalTable='linkGroups'`）+ `TRASH_TARGET`/还原分支 + 回收站标签「关联分组」；`hooks/useLinkGroups.ts`。
- **UI**：`components/LinkPicker.tsx/.css` 底部选择器 —— 「📚 课程」显示「第 N 周 · 有效 M 门」和每门课的周期/星期/时间；自定义分组可新建组、加条目、删条目、删组（走 ConfirmDialog）；底部「已选 N 项 / 完成」；Android 返回键先关选择器而不是整个表单。`DeadlineListPage` 新增 `allowLinks`：表单里多一块「关联」（`+ 关联` 打开选择器，chips 可单个取消），卡片上以 chips 展示关联；`DdlPage` 开启，`ImportantPage` 显式 `allowLinks={false}`（表单里没有关联区，保存也不写 `links`）。

### 验证

- 新增 `test/课程表/effectiveCourses.test.ts` 12 项、`test/DDL清单/ddlLinks.test.ts` 15 项、`test/DDL清单/linkGroups.test.ts` 8 项（CRUD、回收站还原、落盘重载、旧备份兼容、导入导出往返、DDL 关联快照）。
- `npx tsc --noEmit` 通过；`npx vitest run` **628/628**（25 文件）。
- 无头 Chrome 跑**真实 App**（临时脚本预置学期/课程/分组/DDL，走启动流程）核对行为：
  - 列表卡片显示 `📚 高等数学`、`🗂 实验 · 服务器 A`。
  - 选择器「第 8 周 · 有效 2 门」：高等数学、线性代数（双周课，本周第 8 周）；大学物理（第 12 周才开讲）、概率论（单周课）、已结课（第 1-6 周）全部被排除。
  - 新建分组「社团」→ 加条目「海报模板」→ 选中 → 保存后卡片显示 3 个关联；重新打开编辑回显一致。
  - 切到「重要的事」：表单字段只有 `名称,截止时间,地点,备注,备注图片`，DOM 里没有关联入口。
  - 全程无 React key 警告（第一轮发现是测试种子数据缺 `id`，已修正种子）。
- 临时脚本与截图已删除。

### 涉及文件

```
新增：src/utils/ddlLinks.ts、src/hooks/useLinkGroups.ts、src/components/LinkPicker.tsx/.css
     test/课程表/effectiveCourses.test.ts、test/DDL清单/ddlLinks.test.ts、test/DDL清单/linkGroups.test.ts
修改：src/types/index.ts、src/services/store.ts、src/db/index.ts、src/utils/courseSchedule.ts、
      src/components/DeadlineListPage.tsx/.css、src/pages/DdlPage.tsx、src/pages/ImportantPage.tsx、
      src/pages/Trash.tsx、structure.md
```

## 2026-10-26 — 旧版本卡在缓存里：加「有新版本 · 刷新」提示

### 问题

Web/PWA 重新构建后打开还是旧页面（例如新加的「DDL 关联」怎么都看不到）。原因不是构建：`/` 返回的是新 `index.html`、新 asset 也是 200；是 Service Worker 的 precache 继续把旧 `index.html` 喂给浏览器。

实证（复制一份 dist 起 preview，先把 index.html 改个标题模拟重新构建）：

| 操作 | 页面标题 |
| --- | --- |
| 普通刷新一次 | 仍是旧标题（SW 命中 precache） |
| 普通刷新两次 | 仍是旧标题（sw.js 没变时浏览器不会更新 SW） |
| 硬刷新 Ctrl+Shift+R（ignoreCache） | 新标题 ✅ |
| 清 SW + 清 caches 后刷新 | 新标题 ✅ |

### 实现

- 新增 `services/swUpdate.ts#watchServiceWorkerUpdate`：页面已在 SW 接管状态（`navigator.serviceWorker.controller` 非空）时，一旦 `controllerchange`（新版本接管）就通知上层；另外每次回到前台顺手 `registration.update()`（只查不刷新）。首次访问的 SW 安装不算更新。
- `App.tsx`：收到通知后在底部弹出 `有新版本 [刷新]` 提示条（`.app-update-bar`，z-index 150），点「刷新」重新加载。原生端没有 Service Worker，模块直接返回。

### 验证

- 构建产物里含 `app-update-bar`；无头 Chrome 打开构建版：先 reload 让页面在「已有 SW 接管」状态下加载 → 无提示条；派发 `controllerchange` → 提示条出现（文案「有新版本 刷新」）→ 点「刷新」页面确实重新加载。
- `npx tsc --noEmit` 通过；`npx vitest run` **628/628**（25 文件）；`npm run build` 通过。
- 实证用的 `dist-test/`、临时 CDP 脚本与截图已删除。

### 涉及文件

```
新增：src/services/swUpdate.ts
修改：src/App.tsx、src/App.css、structure.md
```

## 2026-10-26 — 版本 1.3.0（6）并重新打包 APK

### 内容

- 把这一天的三件事打进手机包：计划页「只看未来」、TODO 全部完成庆祝弹窗、DDL 关联内容（内置课程组 + 自定义分组）。
- `versionCode 5 → 6`、`versionName 1.2.2 → 1.3.0`（`android/app/build.gradle`、`package.json`、`package-lock.json` 根包字段、structure.md），装上后在启动页能看到版本号，便于确认换的是新包。
- `npm run build:apk` 成功：`android/app/build/outputs/apk/debug/app-debug.apk`，**24.65 MB**，`output-metadata.json` 里 versionCode 6 / versionName 1.3.0；APK 内含 `assets/public/index.html`、新 bundle、`classes.dex`、`AndroidManifest.xml`、`lib/arm64-v8a/libmlkit_google_ocr_pipeline.so`。
- 打完 APK 后重新跑了一次 `npm run build`，把 `dist/` 恢复成 Web/PWA 产物（APK 构建会把它改成 Capacitor 版本）。

### 备注

- 打包命令因为 Gradle daemon 继承了 stdout，会让外层任务一直「不结束」——APK 其实 1 分钟就产出了（11:57:44），按文件时间戳/`output-metadata.json` 判断完成即可。

## 2026-10-26 — 修复：识别结果没有填进字段，只进了备注

### 现象

图片识别后核对面板里的条目是对的（名称/日期/时间/地点/要求），但点「填入」后只有备注变了，时间、地点等控件始终为空。

### 根因

`planExtraction` 返回的行里**没有 `field` 字段**，而组件 `applyRecog` 用的是 `row.field`：

- 标量行的 `row.field` 恒为 `undefined` → 落进 `else` 分支 → 被当成邮箱写进备注；
- 组件里另有一份 `ReviewRow` 接口（自己声明了 `field`），类型上"看着有"，运行时没有 → TypeScript 也没能拦住。

### 修复

- `PlannedRow` 增加 `field`（name / deadlineDate / deadlineTime / location）与 `useValue`，标量行创建时写入。
- 新增纯函数 `collectApplied(rows)`：标量 → 表单字段，要求/邮箱 → 备注；未知类型忽略，不再兜底塞邮箱。
- 组件的 `ReviewRow` 改为直接复用 `PlannedRow`，删掉重复定义（这次漂移的根源）。
- 5 项回归测试：时间进 `deadlineTime` 且不进邮箱、冲突保留原值时不写入、skip 不写入、空值忽略。

### 验证

- 
px tsc --noEmit` 通过；
px vitest run` **633/633**（25 文件）；
pm run build:apk` 成功（24.82 MB）。
- 同步修正 `structure.md` 测试表（新增 5 个测试文件的用例数、合计 633）。

### 涉及文件

```
修改：src/utils/extract.ts、src/components/DeadlineListPage.tsx、test/识别/extract.test.ts、structure.md
```