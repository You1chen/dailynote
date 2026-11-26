import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));
vi.mock('../../src/db', () => ({ getSemester: vi.fn(), saveCourse: vi.fn() }));
import CourseEditModal from '../../src/components/CourseEditModal';
import CourseTimeSettings from '../../src/components/CourseTimeSettings';
import { DEFAULT_COURSE_TIME_COMBINATIONS, loadCourseTimeCombinations, normalizeCourseTimeCombinations } from '../../src/utils/courseTimeCombinations';
import { _resetForTest, initStore } from '../../src/services/store';
import type { Course } from '../../src/types';

type Element = ReactElement<Record<string, any>>;
function find(node: ReactNode, predicate: (element: Element) => boolean): Element {
  if (Array.isArray(node)) {
    for (const child of node) { try { return find(child, predicate); } catch { /* continue */ } }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as Element;
    if (predicate(element)) return element;
    return find(element.props.children, predicate);
  }
  throw new Error('Element not found');
}
const memory: Record<string, string> = {};
async function seedLegacyFile(data: Record<string, unknown>): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dailynote_kv', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(JSON.stringify({ version: 1, savedAt: 0, dailyPlans: [], ...data }), 'dailynote-data');
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}
beforeEach(async () => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory[key] ?? null,
    setItem: (key: string, value: string) => { memory[key] = value; },
    removeItem: (key: string) => { delete memory[key]; },
  });
  Object.keys(memory).forEach(key => delete memory[key]);
  hooks.values = []; hooks.index = 0;
  await _resetForTest();
});

const course: Course = {
  id: 1, name: '数学', teacher: '', location: '', dayOfWeek: [1], startTime: '08:00',
  endTime: '10:15', weekType: 'all', startWeek: 1, weekCount: 18, createdAt: 1, updatedAt: 1,
};
function renderCourse() {
  hooks.index = 0;
  return CourseEditModal({ course, onClose: vi.fn(), onSaved: vi.fn() });
}
function input(tree: ReactNode, label: string) { return find(tree, element => element.props['aria-label'] === label); }

describe('课程时间组合', () => {
  it('provides defaults, preserves an empty list, and filters malformed/duplicate combinations', () => {
    expect(loadCourseTimeCombinations()).toEqual(DEFAULT_COURSE_TIME_COMBINATIONS);
    expect(normalizeCourseTimeCombinations([])).toEqual([]);
    expect(normalizeCourseTimeCombinations([
      { startTime: '10:00', endTime: '11:00' }, { startTime: '10:00', endTime: '12:00' },
      { startTime: '24:00', endTime: '25:00' }, { startTime: '09:00', endTime: '08:00' }, null,
    ])).toEqual([{ startTime: '10:00', endTime: '11:00' }]);
  });

  it('keeps an edited course end time on opening; matching typed/selected starts fill and manual changes persist', () => {
    let tree = renderCourse();
    expect(input(tree, '课程结束时间').props.value).toBe('10:15');
    input(tree, '课程开始时间').props.onChange({ target: { value: '14:30' } });
    tree = renderCourse();
    expect(input(tree, '课程结束时间').props.value).toBe('17:05');
    input(tree, '课程结束时间').props.onChange({ target: { value: '17:30' } });
    tree = renderCourse();
    expect(input(tree, '课程结束时间').props.value).toBe('17:30');
    input(tree, '课程开始时间').props.onChange({ target: { value: '15:00' } });
    tree = renderCourse();
    expect(input(tree, '课程结束时间').props.value).toBe('17:30');
    find(tree, element => element.type === 'button' && Array.isArray(element.props.children)
      && element.props.children[0] === '10:00').props.onClick();
    tree = renderCourse();
    expect(input(tree, '课程开始时间').props.value).toBe('10:00');
    expect(input(tree, '课程结束时间').props.value).toBe('11:00');
  });

  it('prefills grid selections and exposes course deletion without a map entry', () => {
    const onDelete = vi.fn();
    const draft = CourseEditModal({ course: null, initialSlot: { dayOfWeek: [6], startTime: '08:00', endTime: '08:35' }, onClose: vi.fn(), onSaved: vi.fn(), onDelete });
    expect(input(draft, '课程开始时间').props.value).toBe('08:00');
    expect(input(draft, '课程结束时间').props.value).toBe('08:35');
    expect(find(draft, element => element.props.children === '周六').props.className).toContain('settings-chip--active');
    expect(() => input(draft, '删除课程')).toThrow();
    hooks.values = []; hooks.index = 0;
    const edit = CourseEditModal({ course, onClose: vi.fn(), onSaved: vi.fn(), onDelete });
    input(edit, '删除课程').props.onClick();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(() => find(edit, element => element.type === 'button' && element.props.children === '知识地图')).toThrow();
  });

  it('creates, edits, rejects duplicates, and deletes combinations in settings', () => {
    let combinations = [...DEFAULT_COURSE_TIME_COMBINATIONS];
    const render = () => {
      hooks.index = 0;
      return CourseTimeSettings({ combinations, onChange: value => { combinations = value; } });
    };
    const click = (text: string) => find(render(), element => element.type === 'button' && element.props.children === text).props.onClick();
    input(render(), '组合开始时间').props.onChange({ target: { value: '18:00' } });
    input(render(), '组合结束时间').props.onChange({ target: { value: '19:30' } });
    click('添加组合');
    expect(combinations).toContainEqual({ startTime: '18:00', endTime: '19:30' });
    input(render(), '编辑 18:00 时间组合').props.onClick();
    input(render(), '组合结束时间').props.onChange({ target: { value: '20:00' } });
    click('保存组合');
    expect(combinations).toContainEqual({ startTime: '18:00', endTime: '20:00' });
    input(render(), '组合开始时间').props.onChange({ target: { value: '18:00' } });
    input(render(), '组合结束时间').props.onChange({ target: { value: '21:00' } });
    click('添加组合');
    expect(find(render(), element => element.props.role === 'alert').props.children).toContain('已有组合');
    expect(combinations).toHaveLength(4);
    input(render(), '删除 18:00 时间组合').props.onClick();
    expect(combinations).toHaveLength(3);
  });

  it('旧单文件里的时间组合迁入偏好；显式空组合保持为空', async () => {
    const custom = [{ startTime: '12:10', endTime: '13:20' }];
    await seedLegacyFile({ courseTimeCombinations: custom });
    await initStore();
    expect(loadCourseTimeCombinations()).toEqual(custom);
  });

  it('没有时间组合字段的旧单文件沿用默认组合', async () => {
    await seedLegacyFile({});
    await initStore();
    expect(loadCourseTimeCombinations()).toEqual(DEFAULT_COURSE_TIME_COMBINATIONS);
  });
});
