import { CalendarClock, CalendarDays, Layers, ListTodo, Target, type LucideIcon } from 'lucide-react';

export type CoreFeatureKey = 'todo' | 'goal' | 'task' | 'card' | 'ddl';

export interface CoreFeature {
  key: CoreFeatureKey;
  label: string;
  icon: LucideIcon;
  /** One line, also used by the first-run guide. */
  summary: string;
  steps: readonly string[];
  /** The gesture that matters most for this feature. */
  gesture: string;
}

export const CORE_FEATURES: readonly CoreFeature[] = [
  {
    key: 'todo',
    label: 'TODO',
    icon: ListTodo,
    summary: '点悬浮的 TODO 按钮，快速记下待办并拆成小步骤。',
    steps: [
      '单击任务开始或结束计时，用时会显示在条目下方。',
      '双击标记完成，30 秒内再双击可以撤销。',
      '长按拖动调整顺序；拖到清单最下方，松手即可移入「遗留」。',
      '「编辑任务」只调整内容与层级，完成后回到任务清单。',
    ],
    gesture: '长按任务再拖动',
  },
  {
    key: 'goal',
    label: '目标',
    icon: Target,
    summary: '用「规划 → 目标」管理长期方向。',
    steps: [
      '从左向右滑打开导航，点「规划」。',
      '新建目标，把它拆成可以逐条完成的步骤。',
      '勾掉步骤会推进进度，已完成的目标仍可回看。',
    ],
    gesture: '从左向右滑，打开导航',
  },
  {
    key: 'task',
    label: '任务',
    icon: CalendarDays,
    summary: '在主页时间轴上，给一件事留出具体的时间。',
    steps: [
      '长按时间网格的空白处，再上下拖动选择时段。',
      '松手后填写任务内容，起止时间已经填好。',
      '轻扫上下是滚动时间轴，点一下空白也能直接新建。',
      '点已有的时间块进入编辑，长按再拖可以调整。',
    ],
    gesture: '长按后上下拖，选择时段',
  },
  {
    key: 'card',
    label: '卡片',
    icon: Layers,
    summary: '在主页左滑，立刻记下一闪而过的想法。',
    steps: [
      '主页从右向左滑，直接打开一张新卡片。',
      '写完点保存；有内容时会先保存再回到主页。',
      '旧卡片在「记事 → 卡片收集器」，也能在「回忆」里随机翻到。',
    ],
    gesture: '从右向左滑，新建卡片',
  },
  {
    key: 'ddl',
    label: 'DDL',
    icon: CalendarClock,
    summary: '记下截止时间，提前看到还剩多久。',
    steps: [
      '从左向右滑打开导航，进入「事项信息 → DDL」。',
      '填写名称、截止日期与时间，保存即可。',
      '剩余不足一周时，主页的「！」警报会一起提醒。',
    ],
    gesture: '从左向右滑，进入事项信息',
  },
];
