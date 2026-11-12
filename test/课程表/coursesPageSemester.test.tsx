import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Course } from '../../src/types';

const state = vi.hoisted(() => ({ values: [] as unknown[] }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [state.values.shift(), vi.fn()],
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('../../src/db', () => ({
  getAllCourses: vi.fn(), deleteCourse: vi.fn(), getSemester: vi.fn(), saveSemester: vi.fn(),
}));
vi.mock('../../src/hooks/usePreferences', () => ({ usePreferences: () => ({ prefs: { hourHeight: 60 } }) }));
vi.mock('../../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: vi.fn() }));
vi.mock('../../src/components/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../../src/components/CourseEditModal', () => ({
  default: () => null,
  DAY_LABELS: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  WEEK_TYPE_LABELS: { all: '每周', odd: '单周', even: '双周' },
}));

import CoursesPage from '../../src/pages/CoursesPage';

const current: Course = {
  id: 1, name: '当前课程', teacher: '', location: '', dayOfWeek: [1],
  startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 18,
  semesterStartDate: '2026-09-07', createdAt: 1, updatedAt: 1,
};
const old: Course = { ...current, id: 2, name: '历史课程', semesterStartDate: '2026-02-23' };

function render(courses: Course[], view: 'list' | 'grid'): string {
  state.values = [
    courses, { id: 1, startDate: '2026-09-07', specialDates: [], updatedAt: 1 },
    false, view, true, undefined, null, null, '', 'holiday',
  ];
  return renderToStaticMarkup(CoursesPage());
}

beforeEach(() => { state.values = []; });

describe('CoursesPage — 学期展示', () => {
  it('课表只展示当前归属课程，不再把历史课程画进当前课表', () => {
    const html = render([old, current], 'grid');
    expect(html).toContain('当前课程');
    expect(html).not.toContain('历史课程');
  });

  it('只有历史课程时显示当前学期空态，并提示列表可管理', () => {
    const html = render([old], 'grid');
    expect(html).toContain('本学期还没有课程');
    expect(html).toContain('其他学期的课程可在列表中管理');
    expect(html).not.toContain('历史课程');
  });

  it('管理列表保留历史课程，标明归属日期及当前/非当前状态', () => {
    const html = render([old, current], 'list');
    expect(html).toContain('历史课程');
    expect(html).toContain('当前课程');
    expect(html).toContain('2026-02-23 开学（非当前）');
    expect(html).toContain('2026-09-07 开学（当前）');
  });
});
