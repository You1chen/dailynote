import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import type { KnowledgeCard } from '../src/types/knowledge';

const state = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, load: undefined as (() => void) | undefined,
  cards: [] as KnowledgeCard[], back: vi.fn(), close: vi.fn(),
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
  useRef: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = { current: initial };
    return state.values[index];
  },
  useEffect: (effect: () => void) => { state.load ??= effect; },
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock('../src/db', () => ({ getAllCourses: async () => [], getKnowledgeCardLibrary: async () => null }));
vi.mock('../src/db/knowledgeCards', () => ({
  getCards: async () => state.cards,
  saveCard: async (card: KnowledgeCard) => { state.cards = [...state.cards.filter(item => item.id !== card.id), card]; },
  deleteCard: async (id: string) => { state.cards = state.cards.filter(card => card.id !== id); },
}));
vi.mock('../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: state.back }));
vi.mock('../src/components/KnowledgeCardEditor', () => ({ default: () => null }));

import KnowledgeCardCollector from '../src/components/KnowledgeCardCollector';
import KnowledgeCardEditor from '../src/components/KnowledgeCardEditor';
import ConfirmDialog from '../src/components/ConfirmDialog';

function collector() {
  state.index = 0;
  return KnowledgeCardCollector({ onClose: state.close });
}

type Element = ReactElement<Record<string, any>>;
function find(node: ReactNode, predicate: (el: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = find(child, predicate);
      if (match) return match;
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as Element;
    return predicate(el) ? el : find(el.props.children, predicate);
  }
}
const byLabel = (label: string) => find(collector(), el => el.props['aria-label'] === label)!;
const byText = (text: string) => find(collector(), el => el.type === 'button' && renderToStaticMarkup(el).includes(text))!;
const monthButton = (month: number) => find(collector(), el => el.type === 'button' &&
  el.props['aria-expanded'] !== undefined && Array.isArray(el.props.children) && el.props.children.join('') === `${month} 月`)!;
const selected = () => find(collector(), el => el.type === 'time')?.props.dateTime;
const html = () => renderToStaticMarkup(collector());

function card(title: string, year: number, month: number, day: number, hour: number, text: string): KnowledgeCard {
  const timestamp = new Date(year, month - 1, day, hour).getTime();
  return { id: title, title, createdAt: timestamp, updatedAt: timestamp, contents: [{ id: `${title}-text`, kind: 'text', text, createdAt: timestamp, updatedAt: timestamp }] };
}

function pointer(x: number, y: number, overrides = {}) {
  return { isPrimary: true, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, target: { closest: () => null }, ...overrides };
}

async function open() {
  collector();
  state.load?.();
  await vi.waitFor(() => expect(html()).not.toContain('正在打开收集器'));
}

beforeEach(() => {
  state.values = [];
  state.load = undefined;
  state.cards = [
    card('Today early', 2026, 1, 1, 9, 'ALPHA'),
    card('Today late', 2026, 1, 1, 11, 'alphabet'),
    card('Old card', 2024, 2, 29, 8, 'sample'),
  ];
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 0, 1, 12));
});
afterEach(() => vi.useRealTimers());

describe('card collector date navigation', () => {
  it('opens the current year and month and can disclose an older leap day', async () => {
    await open();
    expect(selected()).toBe('2026-01-01');
    expect(byText('2026 年').props['aria-expanded']).toBe(true);
    expect(monthButton(1).props['aria-expanded']).toBe(true);
    expect(byLabel('2026-01-01 · 2 张卡片').props['aria-pressed']).toBe(true);
    expect(byText('2024 年').props['aria-expanded']).toBe(false);
    byText('2024 年').props.onClick();
    monthButton(2).props.onClick();
    expect(byLabel('2024-02-30 · 0 张卡片')).toBeUndefined();
    byLabel('2024-02-29 · 1 张卡片').props.onClick();
    expect(selected()).toBe('2024-02-29');
    expect(html()).toContain('Old card');
  });

  it('takes one calendar step per swipe through empty dates and across a year', async () => {
    await open();
    const { props } = collector();
    expect(props['data-app-swipe']).toBe('off');
    props.onPointerDown(pointer(30, 50));
    props.onPointerUp(pointer(140, 52));
    expect(selected()).toBe('2025-12-31');
    expect(byText('2025 年').props['aria-expanded']).toBe(true);
    expect(monthButton(12).props['aria-expanded']).toBe(true);
    expect(html()).toContain('没有匹配卡片');
    const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    collector().props.onClickCapture(click);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopPropagation).toHaveBeenCalledOnce();

    const swipeBack = collector().props;
    swipeBack.onPointerDown(pointer(140, 52));
    swipeBack.onPointerUp(pointer(30, 50));
    expect(selected()).toBe('2026-01-01');
    byLabel('下一天').props.onClick();
    expect(selected()).toBe('2026-01-02');
    byLabel('上一天').props.onClick();
    expect(selected()).toBe('2026-01-01');
  });

  it('ignores vertical, short, canceled, multi-touch and input gestures', async () => {
    await open();
    const { props } = collector();
    for (const [start, end] of [
      [pointer(0, 0), pointer(80, 100)],
      [pointer(0, 0), pointer(40, 0)],
      [pointer(0, 0, { target: { closest: () => ({}) } }), pointer(110, 0)],
      [pointer(0, 0, { pointerType: 'mouse' }), pointer(110, 0)],
    ]) {
      props.onPointerDown(start);
      props.onPointerUp(end);
      expect(selected()).toBe('2026-01-01');
    }
    props.onPointerDown(pointer(0, 0));
    props.onPointerCancel();
    props.onPointerUp(pointer(110, 0));
    props.onPointerDown(pointer(0, 0));
    props.onPointerDown(pointer(30, 20, { isPrimary: false, pointerId: 2 }));
    props.onPointerUp(pointer(110, 0));
    expect(selected()).toBe('2026-01-01');
  });

  it('preserves date-scoped search and sort, selects the saved date, and retains back handling', async () => {
    await open();
    expect(html().indexOf('Today late')).toBeLessThan(html().indexOf('Today early'));
    byText('最新在前').props.onClick();
    byLabel('搜索卡片').props.onChange({ target: { value: 'alpha' } });
    expect(html().indexOf('Today early')).toBeLessThan(html().indexOf('Today late'));
    byLabel('下一天').props.onClick();
    expect(html()).toContain('没有匹配卡片');
    byLabel('上一天').props.onClick();
    expect(byLabel('搜索卡片').props.value).toBe('alpha');
    byText('Today early').props.onClick();
    const editor = collector();
    expect(editor.type).toBe(KnowledgeCardEditor);
    expect(state.back.mock.lastCall?.[0]()).toBe(false);
    await editor.props.onSave({ ...state.cards[2], contents: state.cards[0].contents });
    editor.props.onClose();
    expect(selected()).toBe('2024-02-29');
    byLabel('删除卡片：Old card').props.onClick();
    expect(find(collector(), el => el.type === ConfirmDialog)?.props.open).toBe(true);
    expect(state.back.mock.lastCall?.[0]()).toBe(true);
    expect(find(collector(), el => el.type === ConfirmDialog)?.props.open).toBe(false);
    expect(state.close).not.toHaveBeenCalled();
    expect(state.back.mock.lastCall?.[0]()).toBe(true);
    expect(state.close).toHaveBeenCalledOnce();
  });

  it('stays on the selected date after deleting its last card', async () => {
    await open();
    byText('2024 年').props.onClick();
    monthButton(2).props.onClick();
    byLabel('2024-02-29 · 1 张卡片').props.onClick();
    byLabel('删除卡片：Old card').props.onClick();
    find(collector(), el => el.type === ConfirmDialog)!.props.onConfirm();
    await vi.waitFor(() => expect(byLabel('2024-02-29 · 0 张卡片')?.props['aria-pressed']).toBe(true));
    expect(selected()).toBe('2024-02-29');
  });
});
