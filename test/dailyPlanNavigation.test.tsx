import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import type { DailyPlan, TimeBlock } from '../src/types';

// Follow the existing SSR component-test pattern, retaining state between renders
// so the query/date/async-plan transition can be exercised without a DOM package.
const state = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as (() => void | (() => void))[],
  params: new URLSearchParams(),
  plan: null as DailyPlan | null,
  loading: false,
  prefs: { hourHeight: 60, defaultDuration: 30, hideSleepHours: false, sleepStart: '23:00', sleepEnd: '07:00', futureOnly: false },
  navigate: vi.fn(),
}));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
    return [state.values[index], (next: unknown) => {
      state.values[index] = typeof next === 'function' ? next(state.values[index]) : next;
    }];
  },
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = { current: initial };
    return state.values[index];
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => state.navigate,
  useSearchParams: () => [state.params],
}));
vi.mock('../src/hooks/useDailyPlan', () => ({ useDailyPlan: () => ({ plan: state.plan, loading: state.loading }) }));
vi.mock('../src/hooks/usePreferences', () => ({ usePreferences: () => ({
  prefs: state.prefs,
}) }));
vi.mock('../src/hooks/useIdeas', () => ({ useIdeas: () => ({ byKind: { wish: [], chore: [] } }) }));
vi.mock('../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: vi.fn() }));
vi.mock('../src/db', () => ({
  getAllRoutines: async () => [], getAllPlans: async () => [],
  getAllCourses: async () => [], getSemester: async () => undefined,
  getAllTaskTemplates: vi.fn(), savePlan: vi.fn(),
}));
vi.mock('../src/components/FullscreenSchedule', () => ({ default: () => null }));
vi.mock('../src/components/PreferencePanel', () => ({ default: () => null }));
vi.mock('../src/components/DayNavigator', () => ({ default: () => null }));
vi.mock('../src/components/ConfirmDialog', () => ({ default: () => null }));

import DailyPlanPage from '../src/pages/DailyPlan';
import PlanTimeGrid from '../src/components/PlanTimeGrid';

const block: TimeBlock = {
  id: 'user-created', startTime: '08:00', endTime: '09:00', taskTitle: '用户创建的计划',
  plannedContent: '实际计划详情',
  completed: false, notes: '',
};
const planFor = (date: string, blocks: TimeBlock[] = []): DailyPlan => ({
  date, timeBlocks: blocks, createdAt: 1, updatedAt: 1,
});

function tree() {
  state.index = 0;
  state.effects = [];
  return DailyPlanPage({});
}
function render() {
  return renderToStaticMarkup(tree());
}

type Element = ReactElement<Record<string, any>>;
function find(node: ReactNode, predicate: (el: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = find(child, predicate);
      if (match) return match;
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as Element;
    return predicate(element) ? element : find(element.props.children, predicate);
  }
}
const byClass = (node: ReactNode, className: string) => find(node, el => el.props.className?.split(' ').includes(className));
const timeline = () => find(tree(), el => el.type === PlanTimeGrid)!;

function pointer(clientY: number, { target = '.dp-time-slot', pointerType = 'touch', pointerId = 7, clientX = 80, scroller = null as { scrollTop: number } | null } = {}) {
  return {
    clientX, clientY, pointerType, pointerId, isPrimary: true, button: 0, detail: 1,
    target: { closest: (selector: string) => selector.split(', ').includes(target) ? {} : null },
    currentTarget: { getBoundingClientRect: () => ({ top: -100 }), setPointerCapture: vi.fn(), parentElement: scroller },
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  };
}
function runEffects() {
  for (const effect of state.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanup();
  }
}

beforeEach(() => {
  state.values = [];
  state.params = new URLSearchParams('date=2026-10-26');
  state.plan = planFor('2026-10-26');
  state.loading = false;
  state.prefs = { hourHeight: 60, defaultDuration: 30, hideSleepHours: false, sleepStart: '23:00', sleepEnd: '07:00', futureOnly: false };
  state.navigate.mockReset();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('DailyPlan weekly block navigation', () => {
  it('preserves the details query until the requested date and its plan are ready', () => {
    render();
    runEffects();
    // Route changes first; useDailyPlan still exposes the previous day for this frame.
    state.params = new URLSearchParams('date=2026-10-27&block=user-created');
    render();
    runEffects();
    expect(state.navigate).not.toHaveBeenCalled();
    // Local date has caught up, but the old plan/loading snapshot has not.
    render();
    runEffects();
    expect(state.navigate).not.toHaveBeenCalled();
    state.loading = true;
    render();
    runEffects();
    expect(state.navigate).not.toHaveBeenCalled();
    state.plan = planFor('2026-10-27', [block]);
    state.loading = false;
    render();
    runEffects();
    const html = render();
    expect(html).toContain('编辑任务');
    expect(html).toContain('value="用户创建的计划"');
    expect(html).toContain('实际计划详情');
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-27', { replace: true });
  });

  it('does not consume a details query before any plan has loaded', () => {
    state.params = new URLSearchParams('date=2026-10-27&block=user-created');
    state.plan = null;
    render();
    runEffects();
    expect(state.navigate).not.toHaveBeenCalled();
    state.plan = planFor('2026-10-27', [block]);
    render();
    runEffects();
    expect(render()).toContain('编辑任务');
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-27', { replace: true });
  });

  it('waits for the matching plan before opening a weekly empty-slot creation query', () => {
    state.params = new URLSearchParams('date=2026-10-27&new=10:15');
    render();
    runEffects();
    expect(state.navigate).not.toHaveBeenCalled();
    state.plan = planFor('2026-10-27');
    render();
    runEffects();
    const html = render();
    expect(byClass(tree(), 'bs-title')?.props.children).toBe('计划在这个时间做什么？');
    expect(html).toContain('value="10:15"');
    expect(html).toContain('value="10:45"');
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-27', { replace: true });
  });
});

describe('DailyPlan timeline creation', () => {
  it('prefills both times from a reverse drag after scrolling and clears the preview', () => {
    const props = timeline().props as Parameters<typeof PlanTimeGrid>[0];
    function grid() { state.index = 100; return PlanTimeGrid(props); }
    grid().props.onPointerDown(pointer(620)); // grid top is -100: 12:00
    vi.advanceTimersByTime(400);
    grid().props.onPointerMove(pointer(545)); // 10:45
    expect(byClass(grid(), 'dp-time-selection')?.props.style).toEqual({ top: 645, height: 75 });
    grid().props.onPointerUp(pointer(545));
    expect(byClass(grid(), 'dp-time-selection')).toBeUndefined();
    const html = render();
    expect(byClass(tree(), 'bs-title')?.props.children).toBe('计划在这个时间做什么？');
    expect(html.indexOf('计划名称')).toBeLessThan(html.indexOf('aria-label="开始时间"'));
    const range = byClass(tree(), 'bs-time-range');
    expect(find(range, el => el.props['aria-label'] === '开始时间')?.props.value).toBe('10:45');
    expect(find(range, el => el.props['aria-label'] === '结束时间')?.props.value).toBe('12:00');
    expect(html).not.toMatch(/起止\+时长|预计时长|dp-fab/);

    const overlay = byClass(tree(), 'bs-overlay')!;
    const releaseClick = pointer(545);
    overlay.props.onClickCapture(releaseClick);
    expect(releaseClick.stopPropagation).toHaveBeenCalledOnce();
    expect(releaseClick.preventDefault).toHaveBeenCalledOnce();
    const deliberateClick = { ...pointer(550), target: {}, currentTarget: {} };
    deliberateClick.target = deliberateClick.currentTarget;
    overlay.props.onPointerDownCapture();
    overlay.props.onClickCapture(deliberateClick);
    expect(deliberateClick.stopPropagation).not.toHaveBeenCalled();
    overlay.props.onClick(deliberateClick);
    expect(byClass(tree(), 'bs-overlay')).toBeUndefined();
  });

  it('retains tap duration and accessible slot activation', () => {
    const props = timeline().props as Parameters<typeof PlanTimeGrid>[0];
    state.index = 100;
    const grid = PlanTimeGrid(props);
    grid.props.onPointerDown(pointer(515));
    grid.props.onPointerUp(pointer(515));
    expect(byClass(tree(), 'bs-overlay')).toBeUndefined();
    grid.props.onClick(pointer(515));
    expect(render()).toContain('value="10:15"');
    expect(render()).toContain('value="10:45"');
    const keyboardSlot = find(grid, el => el.props['aria-label'] === '13:00 新建任务')!;
    expect(keyboardSlot.type).toBe('button');
    keyboardSlot.props.onClick({ detail: 0 });
    expect(render()).toContain('value="13:00"');
    expect(render()).toContain('value="13:30"');
  });

  it('does not start selection from existing blocks, fold bars, or touch scroll lane', () => {
    const onSelect = vi.fn();
    const props = { ...timeline().props, onSelect } as Parameters<typeof PlanTimeGrid>[0];
    function grid() { state.index = 100; return PlanTimeGrid(props); }
    for (const target of ['.time-block', '.course-block', '.sleep-bar', '.future-bar', '.time-row']) {
      grid().props.onPointerDown(pointer(500, { target }));
      grid().props.onPointerMove(pointer(550, { target }));
      grid().props.onPointerUp(pointer(550, { target }));
      expect(byClass(grid(), 'dp-time-selection')).toBeUndefined();
    }
    grid().props.onPointerDown(pointer(500, { pointerType: 'mouse' }));
    grid().props.onPointerMove(pointer(550, { pointerType: 'mouse' }));
    expect(byClass(grid(), 'dp-time-selection')).toBeDefined();
    grid().props.onPointerCancel(pointer(550, { pointerId: 6 }));
    expect(byClass(grid(), 'dp-time-selection')).toBeDefined();
    grid().props.onPointerCancel(pointer(550));
    expect(byClass(grid(), 'dp-time-selection')).toBeUndefined();
    grid().props.onPointerUp(pointer(550));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('scrolls on immediate touch movement and blocks click-through after horizontal swipes', () => {
    const onSelect = vi.fn();
    const props = { ...timeline().props, onSelect } as Parameters<typeof PlanTimeGrid>[0];
    function grid() { state.index = 100; return PlanTimeGrid(props); }
    const scroller = { scrollTop: 100 };
    const scrollStart = pointer(550, { scroller });
    const scrollEnd = pointer(520, { scroller });
    vi.stubGlobal('document', { scrollingElement: scroller });
    try {
      grid().props.onPointerDown(scrollStart);
      grid().props.onPointerMove(scrollEnd);
      grid().props.onPointerUp(scrollEnd);
      grid().props.onClickCapture(scrollEnd);
      expect(scroller.scrollTop).toBe(130);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(scrollEnd.stopPropagation).toHaveBeenCalledOnce();

    const swipeStart = pointer(550, { clientX: 110 });
    const swipeEnd = pointer(565, { clientX: 220 });
    grid().props.onPointerDown(swipeStart);
    grid().props.onPointerMove(swipeEnd);
    grid().props.onPointerUp(swipeEnd);
    grid().props.onClickCapture(swipeEnd);
    expect(swipeEnd.stopPropagation).toHaveBeenCalledOnce();
    expect(byClass(grid(), 'dp-time-selection')).toBeUndefined();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('maps precise endpoints across folded timeline layouts', () => {
    state.prefs.hideSleepHours = true;
    state.prefs.sleepStart = '23:15';
    state.prefs.sleepEnd = '07:30';
    let props = timeline().props;
    expect(props.minuteAt(props.firstY)).toBe(450);
    expect(props.minuteAt(props.height, true)).toBe(1395);
    state.values = [];
    vi.setSystemTime(new Date(2026, 9, 26, 12, 41));
    state.prefs.futureOnly = true;
    props = timeline().props;
    expect(props.minuteAt(props.firstY)).toBe(720);
    expect(props.minuteAt(props.firstY + 45)).toBe(765);
  });
});
