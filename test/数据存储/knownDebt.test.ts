import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetForTest, initStore, flush, persist, getStore } from '../../src/services/store';
import { clearSnapshot } from '../../src/services/snapshot';
import * as db from '../../src/db';

const values = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};

async function kv(key: string, value?: string): Promise<string | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dailynote_kv', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const tx = database.transaction('kv', value === undefined ? 'readonly' : 'readwrite');
    const request = value === undefined ? tx.objectStore('kv').get(key) : tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => { database.close(); resolve(value === undefined ? request.result : value); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}
const goal = (title: string) => ({ title, description: '', category: '', tasks: [], createdAt: 0, updatedAt: 0 });
const course = (name: string) => ({ name, teacher: '', location: '', dayOfWeek: [1], startTime: '08:00', endTime: '09:00', weekType: 'all' as const, startWeek: 1, weekCount: 18, createdAt: 0, updatedAt: 0 });
const semester = (startDate: string | null) => ({ id: 1, startDate, specialDates: [], updatedAt: 0 });

beforeEach(async () => {
  await _resetForTest();
  values.clear();
});

describe('已知债务回归：真实 CRUD → 持久化 → 重载', () => {
  it('仓库样例数据全量保存、清快照重载保持全部内容', async () => {
    const fs = (globalThis as any).process.getBuiltinModule('node:fs');
    const sample = JSON.parse(fs.readFileSync('dailynote-data.json', 'utf8'));
    const tables = ['dailyPlans', 'longTermGoals', 'reflections', 'harvests', 'fixedRoutines'] as const;
    for (const key of tables) (getStore() as any)[key] = sample[key];
    expect(await persist()).toBe(true);
    await flush();
    await clearSnapshot();
    await initStore();
    for (const key of tables) {
      expect((getStore() as any)[key].map(({ id: _id, ...record }: any) => record))
        .toEqual(sample[key].map(({ id: _id, ...record }: any) => record));
    }
  });
  it('重启后不复用回收站占用的 ID，还原不丢记录', async () => {
    const removed = await db.saveGoal(goal('旧目标'));
    await db.deleteGoal(removed);
    await flush();
    await initStore();
    const created = await db.saveGoal(goal('新目标'));
    expect(created).toBeGreaterThan(removed);
    const trash = await db.getTrashItems();
    expect(await db.restoreFromTrash(trash[0].id!)).toBe(true);
    expect((await db.getAllGoals()).map(item => item.title).sort()).toEqual(['新目标', '旧目标'].sort());
  });

  it('全量 persist 包含自动关联分组，清快照后仍能恢复', async () => {
    getStore().linkGroups.push({ id: 1, name: '读书', items: [{ id: 'i1', name: '课本章节' }], createdAt: 0, updatedAt: 0 });
    expect(await persist()).toBe(true);
    await flush();
    expect(JSON.parse((await kv('linkGroups.json'))!)[0].items[0].name).toBe('课本章节');
    await clearSnapshot();
    getStore().linkGroups = [];
    await initStore();
    expect(getStore().linkGroups[0].items[0].name).toBe('课本章节');
  });

  it('全量保存清理孤儿日期文件，保留其他文件与备份', async () => {
    await db.savePlan({ date: '2026-10-28', timeBlocks: [], createdAt: 0, updatedAt: 0 });
    await kv('days/2026-10-27/plan.json', '{"date":"2026-10-27"}');
    await kv('days/2026-10-27/reflections.json', '[]');
    await kv('days/2026-10-27/custom.json', '{"keep":true}');
    await kv('dailynote-backup-test.json', '{"keep":true}');
    expect(await persist()).toBe(true);
    expect(await kv('days/2026-10-27/plan.json')).toBeUndefined();
    expect(await kv('days/2026-10-27/reflections.json')).toBeUndefined();
    expect(await kv('days/2026-10-27/custom.json')).toBe('{"keep":true}');
    expect(await kv('dailynote-backup-test.json')).toBe('{"keep":true}');
    expect(await kv('days/2026-10-28/plan.json')).toBeDefined();
  });

  it('旧课程首次读取补归属，换学期后不重绑，编辑缺字段也不擦除归属', async () => {
    await kv('courses.json', JSON.stringify([{ ...course('旧课'), id: 1 }]));
    await kv('semester.json', JSON.stringify([semester('2026-03-02')]));
    await initStore();
    expect(getStore().courses[0].semesterStartDate).toBe('2026-03-02');
    const stale = { ...getStore().courses[0] };
    delete stale.semesterStartDate;
    await db.saveSemester(semester('2026-09-07'));
    await db.saveCourse(stale);
    const id = await db.saveCourse(course('新课'));
    expect(getStore().courses.find(c => c.id === 1)?.semesterStartDate).toBe('2026-03-02');
    expect(getStore().courses.find(c => c.id === id)?.semesterStartDate).toBe('2026-09-07');
    await flush();
    await clearSnapshot();
    await initStore();
    expect(getStore().courses[0].semesterStartDate).toBe('2026-03-02');
  });

  it('未设置学期的课程仅在首次设置时绑定', async () => {
    await db.saveCourse(course('待归属课程'));
    await db.saveSemester(semester('2026-09-07'));
    await db.saveSemester(semester('2027-03-01'));
    expect(getStore().courses[0].semesterStartDate).toBe('2026-09-07');
  });

  it('回收站旧课程也绑定原学期，换学期还原后不变', async () => {
    await kv('trash.json', JSON.stringify([{ id: 1, originalTable: 'courses', originalId: 7, originalData: { ...course('旧课'), id: 7 }, title: '旧课', deletedAt: Date.now() }]));
    await kv('semester.json', JSON.stringify([semester('2026-03-02')]));
    await initStore();
    await db.saveSemester(semester('2026-09-07'));
    expect(await db.restoreFromTrash(1)).toBe(true);
    expect(getStore().courses[0].semesterStartDate).toBe('2026-03-02');
  });

  it('课程读入时按当时学期补归属，保存后仍在', async () => {
    await db.saveSemester(semester('2026-09-07'));
    await kv('courses.json', JSON.stringify([{ ...course('旧备份课程'), id: 4 }]));
    await clearSnapshot();
    await initStore();
    expect(getStore().courses.find(item => item.id === 4)?.semesterStartDate).toBe('2026-09-07');
  });
});
