import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { KnowledgeCard } from '../src/types/knowledge';

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as Array<() => unknown>,
  params: new URLSearchParams(),
  setParams: vi.fn(),
  cards: [] as KnowledgeCard[],
  locationState: null as { fromHomeQuickNote: boolean } | null,
  back: vi.fn(),
}));

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
    return [state.values[index], (next: unknown) => {
      state.values[index] = typeof next === 'function' ? next(state.values[index]) : next;
    }];
  },
  useEffect: (effect: () => unknown) => { state.effects.push(effect); },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/reflection', state: state.locationState }),
  useSearchParams: () => [state.params, state.setParams],
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  NavLink: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock('../src/db/knowledgeCards', () => ({ getCards: async () => state.cards }));
vi.mock('../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: vi.fn() }));
vi.mock('../src/hooks/useRouteBack', () => ({ useRouteBack: () => state.back }));
vi.mock('../src/components/DayNavigator', () => ({ default: () => null }));
vi.mock('../src/components/KnowledgeCardEditor', () => ({ default: () => null }));
vi.mock('../src/components/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../src/components/WalkEdit', () => ({ default: () => null }));
vi.mock('../src/pages/WalkMotion', () => ({ default: () => null }));

import KnowledgeCardCollector from '../src/components/KnowledgeCardCollector';
import KnowledgeCardEditor from '../src/components/KnowledgeCardEditor';
import ReflectionPage from '../src/pages/Reflection';
import Walk from '../src/pages/Walk';
import WalkMotion from '../src/pages/WalkMotion';

function renderPage<T>(page: () => T): T {
  state.index = 0;
  state.effects = [];
  return page();
}

function find(node: ReactNode, predicate: (el: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = find(child, predicate);
      if (match) return match;
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    return predicate(node) ? node : find(node.props.children, predicate);
  }
}

const withLabel = (label: string) => (el: ReactElement<any>) => el.type === 'button' && renderToStaticMarkup(el).includes(label);

beforeEach(() => {
  state.values = [];
  state.params = new URLSearchParams('date=2026-11-20');
  state.cards = [];
  state.locationState = null;
  vi.clearAllMocks();
});

describe('记事 and 回忆 navigation', () => {
  it('keeps only the card collector entry on 记事', () => {
    const page = renderPage(ReflectionPage);
    expect(find(page, withLabel('杂念'))).toBeUndefined();
    expect(find(page, withLabel('卡片收集器'))).toBeDefined();
  });

  it('opens a fresh composer from home and closes it directly back to home', () => {
    state.params = new URLSearchParams('cards=new');
    state.locationState = { fromHomeQuickNote: true };
    const page = renderPage(ReflectionPage);
    expect(find(page, withLabel('杂念'))).toBeUndefined();
    const collector = find(page, el => el.type === KnowledgeCardCollector)!;
    expect(collector.props).toMatchObject({ startWithNewCard: true, quickComposer: true });
    state.values = [];
    const editor = renderPage(() => KnowledgeCardCollector(collector.props));
    expect(editor.type).toBe(KnowledgeCardEditor);
    editor.props.onClose();
    expect(state.back).toHaveBeenCalledOnce();
    expect(state.setParams).not.toHaveBeenCalled();
  });

  it('opens the new card editor from the empty recall page and clears its query on close', async () => {
    renderPage(Walk);
    state.effects.forEach(effect => effect());
    await vi.waitFor(() => expect(renderToStaticMarkup(renderPage(Walk))).toContain('创建第一张卡片'));
    const link = find(renderPage(Walk), el => el.props.to === '/reflection?cards=new');
    expect(link?.props.children).toBe('创建第一张卡片');

    state.values = [];
    state.params = new URLSearchParams('cards=new&date=2026-11-20');
    const collector = find(renderPage(ReflectionPage), el => el.type === KnowledgeCardCollector)!;
    expect(collector.props.startWithNewCard).toBe(true);
    collector.props.onClose();
    expect(state.setParams.mock.lastCall?.[0].toString()).toBe('date=2026-11-20');
    expect(state.setParams.mock.lastCall?.[1]).toEqual({ replace: true });

    state.values = [];
    const editor = renderPage(() => KnowledgeCardCollector(collector.props));
    expect(editor.type).toBe(KnowledgeCardEditor);
    expect(editor.props.card).toMatchObject({ title: '', contents: [] });
  });

  it('continues to show saved cards in the recall deck', async () => {
    state.cards = [{ id: 'card-1', title: '旧卡片', contents: [], createdAt: 1, updatedAt: 1 }];
    renderPage(Walk);
    state.effects.forEach(effect => effect());
    await vi.waitFor(() => {
      const deck = find(renderPage(Walk), el => el.type === WalkMotion);
      expect(deck?.props.items.map((item: { kind: string }) => item.kind)).toEqual(['卡片']);
    });
  });
});
