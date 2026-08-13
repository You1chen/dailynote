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

// ============ 回收站 ============

export interface TrashItem {
  id?: number;
  originalTable: string;     // 来源表名
  originalId: number | string; // 原记录 ID
  originalData: any;          // 完整原始数据（用于还原）
  title: string;              // 显示标题
  deletedAt: number;          // 删除时间戳
}
