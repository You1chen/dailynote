import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => state.navigate,
  useSearchParams: () => [state.params],
}));
vi.mock('../src/hooks/useDailyPlan', () => ({ useDailyPlan: () => ({ plan: state.plan, loading: state.loading }) }));
vi.mock('../src/hooks/usePreferences', () => ({ usePreferences: () => ({
  prefs: { hourHeight: 60, defaultDuration: 30, hideSleepHours: false, sleepStart: '23:00', sleepEnd: '07:00' },
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
vi.mock('../src/components/MindSheet', () => ({ default: () => null }));
vi.mock('../src/components/DayNavigator', () => ({ default: () => null }));
vi.mock('../src/components/ConfirmDialog', () => ({ default: () => null }));

import DailyPlanPage from '../src/pages/DailyPlan';

const block: TimeBlock = {
  id: 'user-created', startTime: '08:00', endTime: '09:00', taskTitle: '用户创建的计划',
  plannedContent: '实际计划详情', actualExecution: '', focusScore: 0, efficiencyScore: 0,
  completed: false, notes: '',
};
const planFor = (date: string, blocks: TimeBlock[] = []): DailyPlan => ({
  date, timeBlocks: blocks, createdAt: 1, updatedAt: 1,
});

function render() {
  state.index = 0;
  state.effects = [];
  return renderToStaticMarkup(<DailyPlanPage />);
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
    expect(html).toContain('新建任务');
    expect(html).toContain('value="10:15"');
    expect(html).toContain('value="10:45"');
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/?date=2026-10-27', { replace: true });
  });
});
