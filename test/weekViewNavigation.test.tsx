import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import type { Course, DailyPlan } from '../src/types';

const state = vi.hoisted(() => ({ values: [] as unknown[], navigate: vi.fn() }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [state.values.shift(), vi.fn()],
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: vi.fn() }));
vi.mock('../src/hooks/usePreferences', () => ({ usePreferences: () => ({ prefs: {
  hourHeight: 60, hideSleepHours: false, sleepStart: '23:00', sleepEnd: '07:00',
} }) }));
vi.mock('../src/db', () => ({ getAllCourses: vi.fn(), getSemester: vi.fn(), getPlanByDate: vi.fn() }));
vi.mock('../src/components/CourseEditModal', () => ({
  default: () => null, DAY_LABELS: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
}));

import WeekViewPage from '../src/pages/WeekViewPage';

const plan: DailyPlan = {
  date: '2026-10-26', createdAt: 1, updatedAt: 1, timeBlocks: [{
    id: 'user-created', taskTitle: '学😀习计划详情', startTime: '08:00', endTime: '10:00',
    plannedContent: '详情', actualExecution: '', focusScore: 0, efficiencyScore: 0, completed: false, notes: '',
  }],
};
const course: Course = {
  id: 1, name: '课😀程名称详情', teacher: '', location: '', dayOfWeek: [1],
  startTime: '10:00', endTime: '12:00', weekType: 'all', startWeek: 1, weekCount: 18,
  semesterStartDate: '2026-09-07', createdAt: 1, updatedAt: 1,
};
function render() {
  state.values = [new Date('2026-10-26T00:00:00'), [course],
    { id: 1, startDate: '2026-09-07', specialDates: [], updatedAt: 1 },
    [plan], undefined, 408];
  return WeekViewPage();
}
function taskBlock(node: ReactNode): ReactElement<Record<string, any>> | undefined {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(taskBlock).find(Boolean);
  const element = node as ReactElement<Record<string, any>>;
  if (element.props.className === 'wv-task-block') return element;
  return taskBlock(element.props.children);
}

beforeEach(() => { state.navigate.mockReset(); });

describe('WeekView blocks', () => {
  it('shows the first five Unicode code points for both plans and courses, retaining full titles', () => {
    const html = renderToStaticMarkup(render());
    expect(html).toContain('aria-hidden="true">学😀习计划</span>');
    expect(html).toContain('>课😀程名称</span>');
    expect(html).toContain('title="学😀习计划详情"');
    expect(html).toContain('title="课😀程名称详情 ·');
  });

  it('opens the selected plan date and block by mouse without creating an empty-slot plan', () => {
    const block = taskBlock(render())!;
    const stopPropagation = vi.fn();
    block.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-26&block=user-created');
  });

  it.each(['Enter', ' '])('opens the same plan details with the %s key', key => {
    const block = taskBlock(render())!;
    const preventDefault = vi.fn();
    block.props.onKeyDown({ key, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-26&block=user-created');
  });
});
