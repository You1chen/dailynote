// ============ 核心数据模型 ============

/** 时间块内的子清单项 */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** 时间块 —— 一天中某个时间段的任务安排 */
export interface TimeBlock {
  id: string;
  startTime: string;       // "HH:mm"
  endTime: string;         // "HH:mm"
  taskTitle: string;       // 任务名称
  plannedContent: string;  // 计划做什么（整块内容模式使用）
  checklist?: ChecklistItem[]; // 清单模式使用的子任务列表（可选，向后兼容）
  actualExecution: string; // 实际执行情况
  focusScore: number;      // 1-10 专注度
  efficiencyScore: number; // 1-10 效率
  completed: boolean;      // 是否完成
  notes: string;           // 备注
}

/** 每日计划 */
export interface DailyPlan {
  id?: number;
  date: string;            // "YYYY-MM-DD"
  timeBlocks: TimeBlock[];
  createdAt: number;       // timestamp ms
  updatedAt: number;
}

/** 子任务 */
export interface GoalTask {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

/** 长期目标 */
export interface LongTermGoal {
  id?: number;
  title: string;
  description: string;
  category: string;        // 分类（学科/技能/其他）
  tasks: GoalTask[];
  createdAt: number;
  updatedAt: number;
}

/** 反思时段 */
export type Period = 'morning' | 'afternoon' | 'evening';

/** 反思记录 */
export interface Reflection {
  id?: number;
  date: string;
  period: Period;
  problem: string;          // 发现的问题
  cause: string;            // 原因分析
  solution: string;         // 改进方案
  relatedTaskTitle: string; // 关联的任务
  resolved: boolean;
  createdAt: number;
}

/** 每日收获 */
export interface Harvest {
  id?: number;
  date: string;
  period: Period;
  subject: string;          // 科目/领域
  content: string;          // 学到的内容总结
  createdAt: number;
}

/** 作息模板中的时间块 */
export interface RoutineBlock {
  id: string;
  startTime: string;
  endTime: string;
  taskTitle: string;
  plannedContent: string;
}

/** 固定作息模板 */
export interface FixedRoutine {
  id?: number;
  name: string;
  timeBlocks: RoutineBlock[];
  isActive: boolean;
  createdAt: number;
}

/** 任务清单模板（可复用的可勾选清单） */
export interface TaskTemplate {
  id?: number;
  name: string;
  items: ChecklistItem[];  // 每一项可勾选
  createdAt: number;
  updatedAt: number;
}

/** 任务清单项（每日即时任务，非时间块） */
export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  date: string;            // "YYYY-MM-DD"
  sortOrder: number;       // 排序用
  createdAt: number;
  updatedAt: number;
}

// ============ 课程表 ============

/** 课程（每周固定时间上课） */
export interface Course {
  id?: number;
  name: string;            // 课程名
  teacher: string;         // 教师（可空）
  location: string;        // 上课地点（可空）
  dayOfWeek: number[];     // 0-6，0=周日，可多选（同一门课多个星期只建一次）
  startTime: string;       // "HH:mm"
  endTime: string;         // "HH:mm"
  weekType: 'all' | 'odd' | 'even'; // 每周 / 单周 / 双周
  startWeek: number;       // 起始周（1 起，相对开学时间）
  weekCount: number;       // 持续周数
  createdAt: number;
  updatedAt: number;
}

/** 课程星期归一化：兼容旧数据（曾为单个数字），统一为数组；缺失时兜底周日 */
export function normalizeCourseDayOfWeek(c: Course): Course {
  const days = Array.isArray(c.dayOfWeek)
    ? c.dayOfWeek
    : [typeof c.dayOfWeek === 'number' ? c.dayOfWeek : 0];
  return { ...c, dayOfWeek: days };
}

/** 手动特殊日期：放假（抑制课程）或补课（按正常上课日对待） */
export interface SpecialDate {
  id: number;
  date: string;            // "YYYY-MM-DD"
  kind: 'holiday' | 'makeup';
}

/** 学期设置（单记录数组表，id 恒为 1） */
export interface SemesterRecord {
  id: number;              // 恒为 1
  startDate: string | null; // 开学时间 "YYYY-MM-DD"；null=未设置（不显示课程）
  specialDates: SpecialDate[];
  updatedAt: number;
}

// ============ DDL 截止清单 ============

/** DDL 关联项：保存时快照名字，课程/分组被删后仍能看到当时关联了什么 */
export interface DdlLink {
  kind: 'course' | 'group';
  id: string;              // 课程 id 或分组条目的 id
  label: string;           // 显示名（快照）
  groupName?: string;      // 自定义组：组名（快照）
}

/** 自定义关联分组里的条目 */
export interface LinkGroupItem {
  id: string;
  name: string;
}

/**
 * 自定义关联分组。
 * 内置的「课程」组不落库——它直接读课程表，永远是当前学期的有效课程。
 */
export interface LinkGroup {
  id?: number;
  name: string;
  items: LinkGroupItem[];
  createdAt: number;
  updatedAt: number;
}

/** 杂念的三种：小愿望 / 琐事 / 灵感 */
export type MindKind = 'wish' | 'chore' | 'idea';

/**
 * 杂念：一句话的愿望与琐事、带标题详情的灵感，共用一张表。
 * kind 缺省视为 'idea'（兼容只有灵感的旧数据）。
 */
export interface Idea {
  id?: number;
  kind?: MindKind;
  title?: string;            // 灵感标题（愿望/琐事不用）
  text: string;              // 详情 / 一句话
  date: string;              // "YYYY-MM-DD"，记下它的日子
  source?: 'todo' | 'harvest' | 'plan' | 'other';
  tags?: string[];           // 自定义标签（灵感用）
  createdAt: number;
  updatedAt: number;
}

/** 把旧数据补齐成新形状 */
export function normalizeIdea(idea: Idea): Idea {
  return { ...idea, kind: idea.kind ?? 'idea', tags: idea.tags ?? [] };
}
/** DDL 事件（专门收录带截止时间的事项） */
export interface DdlItem {
  id?: number;
  name: string;            // 事件名称
  deadlineDate: string;    // "YYYY-MM-DD"
  deadlineTime: string;    // "HH:mm"；空 = 默认 23:59
  location: string;        // 地点（可为空）
  notes: string;           // 长文字备注（Markdown，可为空）
  images: string[];        // 压缩后 JPEG dataURL（≤9 张，单条约 ≤3MB）
  links?: DdlLink[];       // 关联内容（课程 / 自定义分组条目；「重要的事」不使用）
  dismissedAt?: number;    // 解除威胁的时间戳（0/空 = 未解除；解除后褪色、30 秒后隐藏）
  createdAt: number;
  updatedAt: number;
}

// ============ 统计相关 ============

export interface DayStats {
  date: string;
  avgFocus: number;
  avgEfficiency: number;
  completionRate: number;   // 0-1
  totalBlocks: number;
  completedBlocks: number;
}

export interface PeriodLabel {
  value: Period;
  label: string;
}

export const PERIODS: PeriodLabel[] = [
  { value: 'morning', label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening', label: '晚上' },
];

/** 生成简单唯一 ID */
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** 把模板 items 深拷贝并追加到清单末尾：重新 genId、done 强制 false，不改动模板本身 */
export function appendTemplateItems(
  current: ChecklistItem[],
  templateItems: ChecklistItem[],
): ChecklistItem[] {
  const added = templateItems.map(t => ({ id: genId(), text: t.text, done: false }));
  return [...current, ...added];
}

/** 获取今天的日期字符串 */
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 重要的事：字段与 DDL 完全一致，只是单独一张表（页面同构、文字不同） */
export type ImportantItem = DdlItem;
// ============ 任务树（taskboard） ============

/** 任务树节点：只有末级节点的 done 有意义 */
export interface TaskNode {
  id: string;
  title: string;
  done: boolean;
  children: TaskNode[];
  /** 已搁置：不进任务清单，进搁置清单 */
  shelved?: boolean;
  /** 完成时刻：完成 30 秒后从清单里隐去 */
  doneAt?: number;
}

/** 任务板（单记录数组表，id 恒 1） */
export interface TaskBoard {
  id: number;
  nodes: TaskNode[];
  /** 末级完整链顺序（用户拖动后的顺序） */
  order: string[];
  updatedAt: number;
}

/** 末级并列项（清单里的一行） */
export interface TaskLeaf {
  key: string;       // 完整链 "实验/近代物理学实验/ppt"
  label: string;     // 显示 "近代物理学实验-ppt"（一级末级则只有自身）
  chain: string[];   // 完整链数组
  done: boolean;
  shelved?: boolean; // 是否已搁置
  doneAt?: number;   // 完成时刻（用于 30 秒后隐去）
}

// ============ 遗留问题（backlog） ============

/** 起始时间的三种填法：距今 / 具体日期 / 文字（不可量化） */
export type BacklogStartMode = 'age' | 'date' | 'text';

/** 遗留问题状态 */
export type BacklogStatus = 'blocked' | 'ready' | 'resolved' | 'dropped';

/**
 * 遗留问题：现在解决不了、等条件成熟再处理的事项。
 * - `startMode='age' | 'date'`：用 `startAt`（起点时间戳）算历时
 * - `startMode='text'`：不可量化（如"小时候"），只存 `startText`，不算历时
 */
export interface BacklogItem {
  id?: number;
  title: string;
  startMode: BacklogStartMode;
  startAt: number | null;
  startText: string;
  blocker: string;       // 困难：为什么做不到
  detail: string;        // 详情
  status: BacklogStatus;
  createdAt: number;
  updatedAt: number;
}

export const BACKLOG_STATUS_LABELS: Record<BacklogStatus, string> = {
  blocked: '阻塞中',
  ready: '可推进',
  resolved: '已解决',
  dropped: '已终止',
};

/** 困难推荐词：仅作手填时的追加建议，不是选项 */
export const BACKLOG_BLOCKER_HINTS = ['能力不足', '资源不足', '时间不足', '信息不足'];

// ============ 回收站 ============

export interface TrashItem {
  id?: number;
  originalTable: string;     // 来源表名
  originalId: number | string; // 原记录 ID
  originalData: any;          // 完整原始数据（用于还原）
  title: string;              // 显示标题
  deletedAt: number;          // 删除时间戳
}
