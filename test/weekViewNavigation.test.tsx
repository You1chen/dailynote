import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import type { Course, DailyPlan, SemesterRecord } from '../src/types';

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
    plannedContent: '详情', completed: false, notes: '',
  }],
};
const course: Course = {
  id: 1, name: '课😀程名称详情', teacher: '', location: '', dayOfWeek: [1],
  startTime: '10:00', endTime: '12:00', weekType: 'all', startWeek: 1, weekCount: 18,
  semesterStartDate: '2026-09-07', createdAt: 1, updatedAt: 1,
};
function render({ date = '2026-10-26', specialDates = [], courses = [course] }: {
  date?: string; specialDates?: SemesterRecord['specialDates']; courses?: Course[];
} = {}) {
  state.values = [new Date(`${date}T00:00:00`), courses,
    { id: 1, startDate: '2026-09-07', specialDates, updatedAt: 1 },
    date === plan.date ? [plan] : [], undefined];
  return WeekViewPage();
}
function findByClass(node: ReactNode, className: string): ReactElement<Record<string, any>> | undefined {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(child => findByClass(child, className)).find(Boolean);
  const element = node as ReactElement<Record<string, any>>;
  if (element.props.className === className) return element;
  return findByClass(element.props.children, className);
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

  it('uses all seven day columns for empty-slot clicks and keeps the selected time', () => {
    const tree = render();
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain('wv-hour-label');
    expect(html).toContain('wv-hour-line');
    expect(html).toContain('10:00-12:00');
    const grid = findByClass(tree, 'wv-inner')!;
    const currentTarget = { getBoundingClientRect: () => ({ left: 20, top: -80, width: 350 }) };
    grid.props.onClick({ clientX: 21, clientY: 488, currentTarget });
    grid.props.onClick({ clientX: 369, clientY: 488, currentTarget });
    expect(state.navigate.mock.calls).toEqual([
      ['/?date=2026-10-26&new=08:30'], ['/?date=2026-11-01&new=08:30'],
    ]);
  });

  it('shows regular courses on formerly built-in holidays and honors manual holiday badges', () => {
    const date = '2026-09-28';
    const courses = [{ ...course, dayOfWeek: [4] }];
    const normal = renderToStaticMarkup(render({ date, courses }));
    expect(normal).toContain('wv-course-block');
    expect(normal).not.toContain('wv-head-holiday');
    const manual = renderToStaticMarkup(render({ date, courses,
      specialDates: [{ id: 1, date: '2026-10-01', kind: 'holiday' }],
    }));
    expect(manual).not.toContain('wv-course-block');
    expect(manual).toContain('class="wv-head-holiday">放假');
  });

  it('opens the selected plan date and block by mouse without creating an empty-slot plan', () => {
    const block = findByClass(render(), 'wv-task-block')!;
    const stopPropagation = vi.fn();
    block.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-26&block=user-created');
  });

  it.each(['Enter', ' '])('opens the same plan details with the %s key', key => {
    const block = findByClass(render(), 'wv-task-block')!;
    const preventDefault = vi.fn();
    block.props.onKeyDown({ key, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-26&block=user-created');
  });
});
