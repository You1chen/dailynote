# 「记」开发交接与项目结构

| 项目     | 当前实现                                                                        |
| -------- | ------------------------------------------------------------------------------- |
| 应用     | 1.3.1，Android `versionCode 7`，包名 `com.ji.note`，独立签名                    |
| 前端     | React 18、TypeScript、Vite 5、React Router 6 `HashRouter`                     |
| 平台     | Web/PWA 与 Capacitor 8 Android，共用业务代码                                    |
| 数据     | 本地优先，无账号服务。Android 默认 `Documents/Ji/`，Web 使用 IndexedDB |
| 回归基线 | 51 个测试文件、763 个测试通过                                                   |

## 开发起步

推荐 Node.js 22 与 npm 10+。在项目根目录运行：

```sh
npm ci
npm run dev
npm test
npm run build
```

Web 构建输出 `dist/`，可用 `npm run preview` 预览。`CAPACITOR=true` 时使用相对资源路径并关闭 PWA 插件。

Android 使用 **JDK 21** 和 Android SDK 36，最低 API 24，目标 API 36。设置 `JAVA_HOME`，通过 `ANDROID_SDK_ROOT` 或 `android/local.properties` 指定 SDK。可复制 [local.properties.example](android/local.properties.example) 后填入本机路径。

| 操作                   | Windows                   | macOS / Linux                                            |
| ---------------------- | ------------------------- | -------------------------------------------------------- |
| Web 构建并同步 Android | `npm run build:android` | `CAPACITOR=true npm run build && npx cap sync android` |
| 调试 APK               | `npm run build:apk`     | `bash scripts/build-apk.sh`                            |
| 签名发布 APK           | `npm run build:release` | `bash scripts/build-apk.sh --release`                  |

APK 输出到 `android/app/build/outputs/apk/{debug,release}/记.apk`。发布构建需要开发者自行配置签名。已有安装的覆盖升级要求签名一致。Gradle Wrapper、原生资源及离线 OCR 依赖声明随源码交接。首次解析 Gradle 依赖需要网络，OCR 模型随 ML Kit 依赖装入 APK。详见 [README](README.md) 和 [模型说明](MODELS.md)。 [Android CI 工作流](.github/workflows/build-apk.yml) 同样使用 JDK 21。

## 入口与目录

| 位置                                                                            | 维护职责                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [main.tsx](src/main.tsx)、[startup.ts](src/services/startup.ts)                   | 启动、存储授权和数据加载。新安装默认使用标准目录，已有自定义目录继续使用 |
| [App.tsx](src/App.tsx)、[App.css](src/App.css)                                    | 路由外壳、导航与快捷卡片的过渡、全局提醒与 TODO 入口                         |
| [pages/](src/pages/)                                                             | 页面和页面级交互                                                                   |
| [components/](src/components/)                                                   | 编辑器、卡片、弹窗、导航、网格                                                     |
| [hooks/](src/hooks/)、[BackButtonContext.tsx](src/contexts/BackButtonContext.tsx) | 数据读取与跨页刷新、手势仲裁、Android 返回键分派                                   |
| [db/](src/db/)、[services/](src/services/)                                        | 业务 CRUD、读写队列、兼容迁移、快照与原生桥                                        |
| [types/](src/types/)、[utils/](src/utils/)                                        | 数据模型与领域规则，几何、任务树、课表和搜索等逻辑                                 |
| [test/](test/)                                                                   | Vitest 回归，包含模拟 IndexedDB 与原生文件桥的测试                                 |
| [android/](android/)、[scripts/](scripts/)                                        | Capacitor Android 工程、Gradle Wrapper、构建和图标生成脚本                         |

`页面与组件 → Hook → 业务 CRUD → mutate / store → Android 文件或 Web IndexedDB`。业务写入应通过 CRUD 与存储入口，保证写序与快照一致。旧 Dexie 库由 [legacy.ts](src/db/legacy.ts) 负责迁移。

## 路由与手势

| 路由                     | 页面与关键行为                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `/`                    | 日计划、时间块编辑、只读课程和警报。支持 `date`、`new`、`block` 查询参数                 |
| `/goals`               | 长期目标、地图与分层计划编辑，叶节点完成驱动递归进度                                                           |
| `/reflection`          | 「记事」，含日期选择与卡片收集器。`cards=new` 可打开新卡片                     |
| `/wander`              | 「回忆」，随机回看卡片，支持日期筛选与编辑。无卡片时提供新建入口                                         |
| `/courses`、`/week`  | 课程表与周视图。课程表固定分栏且默认隐去周末，周视图七天同屏。两处省去左侧时间标签，时间仍可在编辑或详情中查看 |
| `/ddl`、`/important` | 共用截止事项组件。DDL 支持课程与自定义分组关联。两类均支持备注、图片与 Android OCR                             |
| `/settings`            | 日程与时间、课程与时间组合、TODO、偏好恢复。`section` 选择分类，设置页隐藏 TODO 球             |
| `/trash`              | 公开回收站                                                                         |
| `/harvest`             | 旧链接兼容，重定向到 `/reflection` 并带上查询参数                                                            |

- 仅主页支持从左向右滑打开全屏导航，也只有主页渲染 TODO 悬浮球。导航内向左滑逐级返回，根层向左滑收起。导航及其分组以路由历史状态保存，返回课程表的上一级会回到「事项信息」。主页已移除底部标签。入口见 [SideNav.tsx](src/components/SideNav.tsx)、[App.tsx](src/App.tsx) 和 [useRouteBack.ts](src/hooks/useRouteBack.ts)。
- 「数据」的回收站和「规划」的目标共用 [GroupedPageHeader.tsx](src/components/GroupedPageHeader.tsx)。页头返回或从屏幕左侧向右滑会回到来时的分组，无上一条应用历史时回首页。Android 系统返回优先交给页面弹层，再走路由回退。
- 主页从右向左滑打开快捷卡片。打开与关闭跟手。快捷编辑页向右滑保存并返回，有内容但保存失败时保留草稿。卡片编辑器里的「保存」按钮保存后留在编辑器。见 [useAppSwipe.ts](src/hooks/useAppSwipe.ts) 与 [KnowledgeCardEditor.tsx](src/components/KnowledgeCardEditor.tsx)。
- 日计划及全屏日程共用 [PlanTimeGrid.tsx](src/components/PlanTimeGrid.tsx)。触屏轻扫上下滚动，点空白新建，长按空白再纵向拖选起止时间，点已有块编辑。全局横滑与网格手势互斥，避免点按穿透。新建面板标题为「计划在这个时间做什么？」，首项填写计划名称，下一项在同一行选择起止时间。点空白新建仍按用户偏好预填结束时间。表单位于 [DailyPlan.tsx](src/pages/DailyPlan.tsx)。
- 首页警报汇总 DDL、重要的提醒数，分组显示子项总和。警报支持暂停一小时、自定义时长、持续停用及恢复动效，并尊重系统减少动态效果设置。见 [HomeAlarm.tsx](src/components/HomeAlarm.tsx) 与 [navigationBadges.ts](src/utils/navigationBadges.ts)。

## 核心功能维护入口

| 功能             | 实现与数据规则                                                                                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TODO 清单        | [TaskBall.tsx](src/components/TaskBall.tsx)、[useTaskBoard.ts](src/hooks/useTaskBoard.ts)、[taskTree.ts](src/utils/taskTree.ts)。悬浮球打开执行清单，展示末级或最后两级。「…」查看完整路径。单击启停累计计时，双击完成或撤销。到期清理完成项与因此变空的父分支。向下拖过末行可移入 TODO 遗留，相关确认可在设置里关闭           |
| TODO 层级编辑    | [taskRows.ts](src/utils/taskRows.ts)、[taskRowEditing.ts](src/utils/taskRowEditing.ts)、[taskDragLayout.ts](src/utils/taskDragLayout.ts)。使用稳定节点 ID，清单排序与树层级分离。长按拖动分支，拖动其他行时保留输入框焦点。编辑面板退出时自动保存。输入中第一次点完成结束当前行，再点完成提交。末尾保留新增空行，保存时过滤空行 |
| 长期目标         | [GoalPlanEditor.tsx](src/components/GoalPlanEditor.tsx)、[GoalMap.tsx](src/components/GoalMap.tsx)、[goalTree.ts](src/utils/goalTree.ts)。`nodes` 是树的权威数据，只有旧记录缺该字段时才投影 `tasks`。叶节点完成后父进度按直接子节点等权递归计算                                                                            |
| 学期与周视图     | [courseSchedule.ts](src/utils/courseSchedule.ts)、[courseTimetable.ts](src/utils/courseTimetable.ts)、[timetableImport.ts](src/utils/timetableImport.ts)。按学期归属、周次和单双周过滤。用户设置的放假与补课仍生效，内置法定节假日表已移除。切换学期保留已有课程归属                                                            |
| 知识卡片         | [knowledgeCards.ts](src/db/knowledgeCards.ts)、[KnowledgeCardCollector.tsx](src/components/KnowledgeCardCollector.tsx)、[KnowledgeCardEditor.tsx](src/components/KnowledgeCardEditor.tsx)。卡片本体独立于知识树，内容为文字、图片、录音，评论挂在具体内容上。卡片可按日期和关键词筛选，自定义卡片类型保存在卡片库               |
| 课程知识地图     | [KnowledgeMapPanel.tsx](src/components/KnowledgeMapPanel.tsx)、[knowledgeMap.ts](src/utils/knowledgeMap.ts)。一门课程对应一张地图，末端节点以 `cardIds` 引用卡片。移动或删除知识树节点按引用处理，删除卡片本体会清理引用。旧嵌入笔记和卡片由 [knowledgeMigration.ts](src/utils/knowledgeMigration.ts) 迁移                    |

## 本地存储与升级兼容

Android 默认根目录为 `Documents/Ji/`，与旧 DailyNote 的 `Documents/DailyNote/` 分开。Web 使用 `dailynote_kv` 的同构相对路径。域类型见 [storage.ts](src/types/storage.ts)，16 张持久化表与分类文件注册见 [storeSchema.ts](src/services/storeSchema.ts)。

```text
根目录/
├── days/<YYYY-MM-DD>/{plan,reflections,harvests,tasks}.json
├── goals.json          routines.json     templates.json
├── courses.json        semester.json       ddls.json         important.json
├── taskboard.json    linkGroups.json
└── knowledge-maps.json knowledge-cards.json trash.json
```

- [store.ts](src/services/store.ts) 按前后指纹识别变更，串行写入脏文件。Android 写文本显式指定 UTF-8。写入前使旧快照失效，成功后防抖刷新 `dailynote_snapshot`。应用进入后台时冲刷队列。权限阻塞时不读写业务数据。
- 快照用日期目录与分类文件名判定可复用性。多文件更新靠写序和启动修复保持一致，文件层没有跨文件事务。
- `preferences.json` 保存日程、课程时间组合、TODO 操作确认和警报偏好。旧单文件和 Dexie 仍会在启动时迁移。退役表的已有文件留在原处。旧单文件若含退役表，迁移时会保留一份原始归档。与目标或回收站共用文件的私密记录不会出现在公开视图或搜索里。
- 原生权限与系统栏适配由 [MainActivity.java](android/app/src/main/java/com/dailynote/app/MainActivity.java) 和 [DailyNoteStoragePlugin.java](android/app/src/main/java/com/dailynote/app/DailyNoteStoragePlugin.java) 处理。中文离线识别入口见 [MlkitOcrPlugin.java](android/app/src/main/java/com/dailynote/app/MlkitOcrPlugin.java)。

## 交接与回归

源码包包含当前工作区源码、依赖锁定、Android 原生工程、资源、构建脚本和测试。[dailynote-data.json](dailynote-data.json) 是仓库测试样例，回归测试会读取它。安装依赖、同步 Capacitor 和构建 Android 后会在接收方机器重新生成缓存和产物。发布签名及本机 SDK 配置由接收方维护。

优先回归 [全局滑动](test/appSwipe.test.ts)、[日计划导航](test/dailyPlanNavigation.test.tsx)、[首页警报](test/homeAlarm.test.tsx) 及 [启动](test/startup.test.ts)。本文描述交接时实际代码。
