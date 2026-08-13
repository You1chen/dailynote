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
- `npx vitest run` **311/311 通过**（298 既有 + 13 新增）；`npm run build`（tsc --noEmit + vite build）通过。
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

- `npx tsc --noEmit` 通过；`npx vitest run` **311/311 通过**（既有测试直接构造 TimeBlock 字面量，不受默认值影响）。

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

- `npx tsc --noEmit` 通过；`npx vitest run` **311/311 通过**。

### 涉及文件

```
修改：src/pages/DailyPlan.tsx、src/pages/DailyPlan.css、structure.md
```

## 2026-08-12 — 清单型即时任务：占位时间 + 勾完即完成，不验收不评分

### 需求

清单型即时任务（⚡即时 + 📋清单模式）是轻量任务：没有固定时间段却在时间表看不到；无需验收、无需专注/效率评分。方案：新建时默认 `start=now, end=now+10min` 占位（保证时间表可见）；当全部子任务被勾选时，结束时间改为**最后一项勾选的时刻**，任务即视为完成（不用走验收弹窗）。

### 实现

`src/pages/DailyPlan.tsx`：
- 模块级辅助：`CHECKLIST_PLACEHOLDER_MIN=10`、`isChecklistTask`（有子任务清单 = 轻量任务）、`allChecklistDone`、`formatHM`。
- 占位：清单模式下未全部勾选时强制 `endTime = startTime + 10min`（打开/切换模式时 effect + 即时任务 30s 刷新 effect 同步）；完成时不再改时间。
- 完成时刻：清单勾选 toggle 里记录「由未全勾 → 全勾」的 `Date.now()` 到 `checklistDoneAtRef`；保存时若全勾 → `completed=true`、`endTime=最后勾选时刻`（重开已完成的块再保存不覆盖已记录的 endTime）；未全勾 → `completed=false`、`endTime=start+10min` 恢复占位。
- 轻量化：清单任务编辑面板**不显示「验收」按钮**，时间块上**不显示评分标签**（进度条已表达状态）。

### 验证

- `npx tsc --noEmit` 通过；`npx vitest run` **311/311 通过**；vite 热更新无报错。

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

- 新增 `test/时间网格点击映射/blockRenderRect.test.ts` 16 个测试（import 真实源码函数）：折叠/不折叠、跨夜/不跨夜、夜场景回归（23:36-23:46 贴底部非 null）、边界时刻（23:00/00:00/23:50-00:10）、非法时间。`npx vitest run` **327/327 通过**；`npm run build`（tsc + vite build）通过。
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

- `npx vitest run` **327/327 通过**；`npm run build`（tsc + vite build）通过。
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

- `npx vitest run` **328/328 通过**（新增 1 个模板往返测试）。

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

- `npx vitest run` **345/345 通过**（新增 17 个裁剪数学测试，含 100 组随机模糊）；`npm run build`（tsc + vite build）通过。
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

- `npx vitest run` 345/345 通过；`npm run build` 通过。
- 真实浏览器端到端（system Edge，临时 playwright-core 已卸载、临时脚本已删）：新建默认 08:00 → 切即时保留 08:00（不再变当前时刻）→ 切回预规划保留 → 手动设 15:00 双向切换均保留 → 关闭后重新添加（全局即时模式）仍默认当前时刻（创建默认值不受影响）→ 越过 30 秒 ticker 周期后保留的手动时间 09:30 未被自动重置。8/8 断言通过。

### 涉及文件

```
修改：src/pages/DailyPlan.tsx、structure.md
```
