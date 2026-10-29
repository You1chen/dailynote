/**
 * 目标页首屏 SSR：大愿望保留折叠行为；长期目标以摘要作为进入地图的入口。
 * 编辑器与地图的交互详见 goalEditor.test.tsx。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LongTermGoal } from '../../src/types';

const state = vi.hoisted(() => ({ values: [] as unknown[] }));

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [state.values.shift(), vi.fn()],
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
}));

vi.mock('../../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: vi.fn() }));
vi.mock('../../src/components/ConfirmDialog', () => ({ default: () => null }));

import LongTermGoalsPage from '../../src/pages/LongTermGoals';

const wishGoal: LongTermGoal = {
  id: 1,
  kind: 'wish',
  title: '去海边',
  vision: '坐在礁石上听浪',
  description: '想记住安静',
  category: '其他',
  targetDate: '2027-07-01',
  status: 'active',
  tasks: [{ id: 'm1', title: '攒路费', completed: true, createdAt: 0 }],
  createdAt: 0,
  updatedAt: 0,
};

const goalWithTree: LongTermGoal = {
  id: 2,
  title: '英语考试',
  description: '',
  category: '学业',
  tasks: [],
  nodes: [
    {
      id: 'n1',
      title: '听力',
      completed: false,
      children: [
        { id: 'n2', title: '精听训练', completed: true, children: [] },
        { id: 'n3', title: '泛听', completed: false, children: [] },
      ],
    },
    { id: 'n4', title: '词汇', completed: true, children: [] },
  ],
  createdAt: 0,
  updatedAt: 0,
};

const emptyGoal: LongTermGoal = {
  id: 3,
  title: '新目标',
  description: '',
  category: '学业',
  tasks: [],
  createdAt: 0,
  updatedAt: 0,
};

interface Opts { expandedWishId?: number | null }

function render(goals: LongTermGoal[], opts: Opts = {}): string {
  state.values = [
    goals, false,                        // useGoals: goals, loading
    null, '',                            // wishDraft, wishMilestone
    null, null,                          // goalEditor, goalMapId
    false, '', null,                     // saving, saveError, confirm
    opts.expandedWishId ?? null,        // expandedWishId
    '',                                 // milestoneDraft
  ];
  return renderToStaticMarkup(<LongTermGoalsPage />);
}

beforeEach(() => { state.values = []; });

describe('目标页 — 大愿望默认收起', () => {
  it('收起时只有标题、状态与进度，不铺开愿景和里程碑', () => {
    const html = render([wishGoal]);
    expect(html).toContain('去海边');
    expect(html).toContain('进行中');
    expect(html).toContain('1/1 个里程碑');
    expect(html).not.toContain('坐在礁石上听浪');
    expect(html).not.toContain('攒路费');
    // 从摘要就能进入编辑
    expect(html).toContain('编辑大愿望');
  });

  it('展开后才显示愿景、动机和里程碑', () => {
    const html = render([wishGoal], { expandedWishId: 1 });
    expect(html).toContain('坐在礁石上听浪');
    expect(html).toContain('想记住安静');
    expect(html).toContain('攒路费');
  });

  it('没有里程碑时显示「尚未拆解」，不是 0/0', () => {
    const html = render([{ ...wishGoal, tasks: [] }]);
    expect(html).toContain('尚未拆解');
    expect(html).not.toContain('0/0');
  });
});

describe('目标页 — 长期目标卡片入口', () => {
  it('首屏只显示摘要和递归百分比，不渲染旧展开树', () => {
    const html = render([goalWithTree]);
    expect(html).toContain('英语考试');
    expect(html).toContain('2/3 项 · 75%');
    expect(html).toContain('goal-head');
    expect(html).not.toContain('精听训练');
    expect(html).not.toContain('gt-list');
  });

  it('空目标只显示「尚未拆解」，不显示误导性的 0%', () => {
    const html = render([emptyGoal]);
    expect(html).toContain('尚未拆解');
    expect(html).not.toMatch(/>0%<|>0\/0</);
  });
});
