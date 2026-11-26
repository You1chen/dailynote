/**
 * 首次安装的分步引导：只介绍四个最常用的入口，最后指向说明书。
 *
 * 每一步要么圈住一个真实的界面锚点（data-tour），要么圈出一块手势区域；
 * 最后一步没有可圈的控件，用一张居中的说明卡收尾。
 */

export type OnboardingTarget =
  | { selector: string; maxHeight?: number }
  | { zone: { left: number; top: number; right: number; bottom: number } };

export interface OnboardingStep {
  id: 'todo' | 'card' | 'nav' | 'schedule' | 'manual';
  /** 卡片左上角的小标签。 */
  kicker: string;
  title: string;
  body: string;
  /** 没有目标时，遮罩整屏，只显示说明卡。 */
  target?: OnboardingTarget;
  /** 说明卡片优先放在高亮框的上方还是下方。 */
  placement?: 'above' | 'below';
  /** 手势步骤在高亮框里画一个方向提示。 */
  arrow?: 'left' | 'right';
  /** 最后一步提供的动作：打开应用内说明书。 */
  action?: 'help';
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'todo',
    kicker: '待办',
    title: 'TODO：把待办放进悬浮球',
    body: '点右下角的 TODO 悬浮球打开清单。单击开始计时，双击标记完成；30 秒内再双击可以撤销。',
    target: { selector: '[data-tour="todo-ball"]' },
    placement: 'above',
  },
  {
    id: 'card',
    kicker: '卡片',
    title: '左滑：随手记一张卡片',
    body: '在主页从右向左滑，直接打开卡片编辑器。写完保存，会自动回到刚才的页面。',
    target: { zone: { left: 0.52, top: 0.16, right: 0.94, bottom: 0.5 } },
    placement: 'below',
    arrow: 'left',
  },
  {
    id: 'nav',
    kicker: '导航',
    title: '右滑：打开设置与记事',
    body: '从左向右滑打开导航，设置与记事都在里面；向左滑回主页。',
    target: { zone: { left: 0.06, top: 0.16, right: 0.48, bottom: 0.5 } },
    placement: 'below',
    arrow: 'right',
  },
  {
    id: 'schedule',
    kicker: '日程',
    title: '框选时间：建立一段日程',
    body: '在时间轴空白处长按，再上下拖动框出起止时间；松手后填写内容，这段日程就建好了。',
    target: { selector: '[data-tour="time-grid"]', maxHeight: 300 },
    placement: 'below',
  },
  {
    id: 'manual',
    kicker: '说明书',
    title: '完整说明在「导航 → 帮助」',
    body: '四个入口先记到这里。更多用法都在导航的「帮助」里，随时可以自己慢慢探索。',
    action: 'help',
  },
];

/** 卡片主按钮文案：最后一步收束为「开始使用」。 */
export function onboardingPrimaryLabel(index: number): string {
  return index === ONBOARDING_STEPS.length - 1 ? '开始使用' : '下一步';
}
