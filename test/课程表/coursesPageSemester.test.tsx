import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import type { Course } from '../../src/types';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, navigate: vi.fn(), saveCourse: vi.fn(), deleteCourse: vi.fn(), back: () => false as boolean | void }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = typeof value === 'function' ? value(state.values[index]) : value; }];
  },
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = { current: initial };
    return state.values[index];
  },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate, useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('../../src/db', () => ({
  getAllCourses: vi.fn().mockResolvedValue([]), deleteCourse: state.deleteCourse, getSemester: vi.fn(), saveSemester: vi.fn(), saveCourse: state.saveCourse,
}));
vi.mock('../../src/hooks/usePreferences', () => ({ usePreferences: () => ({ prefs: { hourHeight: 60 } }) }));
vi.mock('../../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: (callback: () => boolean | void) => { state.back = callback; } }));
vi.mock('../../src/components/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../../src/components/KnowledgeMapPanel', () => ({ default: () => null }));
vi.mock('../../src/components/CourseEditModal', () => ({
  default: () => null,
  DAY_LABELS: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  WEEK_TYPE_LABELS: { all: '每周', odd: '单周', even: '双周' },
}));

import CoursesPage from '../../src/pages/CoursesPage';
import CourseEditModal from '../../src/components/CourseEditModal';
import ConfirmDialog from '../../src/components/ConfirmDialog';
import KnowledgeMapPanel from '../../src/components/KnowledgeMapPanel';

const current: Course = {
  id: 1, name: '当前课程', teacher: '', location: '', dayOfWeek: [1],
  startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 18,
  semesterStartDate: '2026-09-07', createdAt: 1, updatedAt: 1,
};
const old: Course = { ...current, id: 2, name: '历史课程', semesterStartDate: '2026-02-23' };
const weekend: Course = { ...current, id: 3, name: '周末课程', dayOfWeek: [6, 0], startTime: '11:00', endTime: '12:30' };

function render() {
  state.index = 0;
  return CoursesPage();
}

type Element = ReactElement<Record<string, any>>;
function find(node: ReactNode, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, predicate); if (match) return match; }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as Element;
    return predicate(element) ? element : find(element.props.children, predicate);
  }
}
function button(text: string) { return find(render(), element => element.type === 'button' && element.props.children === text)!; }
function editor() { return find(render(), element => element.type === CourseEditModal); }

beforeEach(() => {
  vi.clearAllMocks();
  state.values = [[old, current, weekend], { id: 1, startDate: '2026-09-07', specialDates: [], updatedAt: 1 }, false];
});

describe('CoursesPage — 课表和本地弹窗', () => {
  it('shows current courses Monday to Friday with one settings entry and no list view', () => {
    const html = renderToStaticMarkup(render());
    expect(html).toContain('当前课程');
    for (const text of ['历史课程', '周末课程', '周六', '周日', '粘贴导入', '>列表<']) expect(html).not.toContain(text);
    expect(html.match(/学期设置/g)).toHaveLength(1);
    expect(html).toContain('>返回</button>');
    expect(html).toContain('--ct-day-count:5');
    expect(html).not.toContain('>时间<');
    expect(html).not.toContain('ct-time-axis');
    expect(html).toContain('ct-scroll-rail');
    expect(html).toContain('08:00–09:40');
  });

  it('orders semester settings from start date to special dates without helper copy', () => {
    button('学期设置').props.onClick();
    const html = renderToStaticMarkup(render());
    const start = html.indexOf('开学时间');
    const weekend = html.indexOf('显示周末');
    const special = html.indexOf('特殊日期');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(weekend);
    expect(weekend).toBeLessThan(special);
    expect(html).not.toContain('settings-field-hint');
    expect(html).not.toContain('仅调整本页显示');
    expect(html).not.toContain('法定节假日已内置');
  });

  it('shows no instructional hint line above the timetable', () => {
    const html = renderToStaticMarkup(render());
    expect(html).not.toContain('点击空白选时间');
    expect(html).not.toContain('滑动时间轴滚动');
  });

  it('enables existing weekend data through settings without changing it', () => {
    button('学期设置').props.onClick();
    find(render(), element => element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } });
    button('完成').props.onClick();
    const html = renderToStaticMarkup(render());
    expect(html).toContain('--ct-day-count:7');
    expect(html).toContain('周末课程');
    expect(weekend.dayOfWeek).toEqual([6, 0]);
    expect(state.saveCourse).not.toHaveBeenCalled();
  });

  it('uses the empty folded row to create a course with a prefilled day and time', () => {
    state.values[0] = [old, weekend];
    const folded = find(render(), element => element.props['aria-label'] === '周四 00:00–24:00（折叠）：新建课程');
    expect(folded).toBeDefined();
    folded!.props.onClick({ detail: 0 });
    expect(editor()?.props).toMatchObject({ course: null, initialSlot: { dayOfWeek: [4], startTime: '12:00', endTime: '13:00' } });
  });

  it('handles pointer clicks and reverse drags with the starting column and appropriate times', () => {
    const day = find(render(), element => element.props.role === 'group' && element.props['aria-label'] === '周五')!;
    const event = (clientY: number) => ({ button: 0, isPrimary: true, pointerId: 8, clientY, target: { closest: () => null }, currentTarget: { setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ top: 100 }) } });
    day.props.onPointerDown(event(128));
    day.props.onPointerUp(event(128));
    expect(editor()?.props.initialSlot).toEqual({ dayOfWeek: [5], startTime: '08:00', endTime: '09:00' });
    editor()?.props.onClose();
    day.props.onPointerDown(event(188));
    day.props.onPointerMove(event(138));
    day.props.onPointerUp(event(138));
    expect(editor()?.props.initialSlot).toEqual({ dayOfWeek: [5], startTime: '08:10', endTime: '09:00' });
  });

  it('opens edit, offers map and delete and handles local back before returning to plan', async () => {
    find(render(), element => element.props.className === 'ct-course-block')!.props.onClick();
    expect(editor()?.props.course).toBe(current);
    editor()?.props.onKnowledgeMap();
    const map = find(render(), element => element.type === KnowledgeMapPanel)!;
    expect(map.props.course).toBe(current);
    map.props.onClose();
    editor()?.props.onDelete();
    expect(find(render(), element => element.type === ConfirmDialog && element.props.open)).toBeDefined();
    state.back();
    expect(find(render(), element => element.type === ConfirmDialog && element.props.open)).toBeUndefined();
    expect(editor()).toBeDefined();
    editor()?.props.onDelete();
    await find(render(), element => element.type === ConfirmDialog && element.props.open)!.props.onConfirm();
    expect(state.deleteCourse).toHaveBeenCalledWith(current.id);
    expect(editor()).toBeUndefined();
    expect(state.navigate).not.toHaveBeenCalled();
    state.back();
    expect(state.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('keeps the paste, preview, validation and local back flow inside settings', () => {
    button('学期设置').props.onClick();
    button('粘贴导入').props.onClick();
    find(render(), element => element.type === 'textarea')!.props.onChange({ target: { value: '周一 08:00-09:40 高等数学 @教1-101' } });
    button('解析预览').props.onClick();
    expect(find(render(), element => element.props['aria-label'] === '课程 1 名称')?.props.value).toBe('高等数学');
    expect(button('确认导入').props.disabled).toBe(true);
    state.back();
    expect(find(render(), element => element.type === 'textarea')).toBeDefined();
    state.back();
    expect(button('粘贴导入')).toBeDefined();
    state.back();
    expect(button('粘贴导入')).toBeUndefined();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
