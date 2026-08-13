/**
 * 权威存储（store.ts / db/index.ts）测试
 *
 * 验证：
 *   1. 内存 CRUD 语义与排序
 *   2. id 单调递增（add → delete → add 不复用；回收站还原不撞 id）
 *   3. 回收站软删除 / 还原 / 深拷贝
 *   4. cleanOldTrash 清理并持久化
 *   5. persist 快照与串行队列、路径捕获
 *   6. normalizePath / 改路径行为
 *   7. 导入合并（保留时间戳）
 *   8. 一次性旧 Dexie 迁移（持久化成功后删除旧库）
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- 模拟 localStorage（Node 环境没有）----
const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = v; },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
};

// ---- Web 端 IndexedDB KV 后端检查辅助（key = 相对路径，value = JSON）----
const KV_DB = 'dailynote_kv';
const KV_STORE = 'kv';
function openKvDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KV_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KV_STORE)) {
        req.result.createObjectStore(KV_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kvKeys(): Promise<string[]> {
  const db = await openKvDb();
  return new Promise(resolve => {
    const tx = db.transaction(KV_STORE, 'readonly');
    const kreq = tx.objectStore(KV_STORE).getAllKeys();
    kreq.onsuccess = () => { db.close(); resolve(kreq.result.map(String)); };
    kreq.onerror = () => { db.close(); resolve([]); };
  });
}
async function kvGet(key: string): Promise<string | null> {
  const db = await openKvDb();
  return new Promise(resolve => {
    const tx = db.transaction(KV_STORE, 'readonly');
    const g = tx.objectStore(KV_STORE).get(key);
    g.onsuccess = () => { db.close(); resolve((g.result as string) ?? null); };
    g.onerror = () => { db.close(); resolve(null); };
  });
}
async function kvPut(key: string, value: string): Promise<void> {
  const db = await openKvDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

import type { DailyPlan, LongTermGoal, TaskItem, Course, SemesterRecord } from '../../src/types';
import { genId } from '../../src/types';
import {
  initStore,
  flush,
  persist,
  getStore,
  setStoragePath,
  getStoragePath,
  normalizePath,
  changeStoragePath,
  importJSONIntoStore,
  exportBackupFile,
  isCapacitor,
  listSubdirs,
  _resetForTest,
} from '../../src/services/store';
import * as db from '../../src/db';
import { legacyDb, readLegacyTables } from '../../src/db/legacy';

const DAY = 24 * 60 * 60 * 1000;

function makePlan(date: string, createdAt = 0): DailyPlan {
  return { date, timeBlocks: [], createdAt, updatedAt: createdAt } as DailyPlan;
}

function makeGoal(title: string, createdAt = 0): LongTermGoal {
  return { title, description: '', category: '学习', tasks: [], createdAt, updatedAt: createdAt } as LongTermGoal;
}

function makeCourse(name: string, createdAt = 0): Course {
  return {
    name, teacher: '', location: '', dayOfWeek: [1], startTime: '08:00', endTime: '09:40',
    weekType: 'all', startWeek: 1, weekCount: 18, createdAt, updatedAt: createdAt,
  } as Course;
}

function makeSemester(startDate: string | null): SemesterRecord {
  return { id: 1, startDate, specialDates: [], updatedAt: 0 } as SemesterRecord;
}

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

// ============ id 单调性 ============

describe('id 单调性（与回收站还原不撞）', () => {
  it('add → delete → add 严格递增，不复用已删除 id', async () => {
    const g1 = await db.saveGoal(makeGoal('a'));
    const g2 = await db.saveGoal(makeGoal('b'));
    expect(g1).toBe(1);
    expect(g2).toBe(2);

    await db.deleteGoal(g1);
    const g3 = await db.saveGoal(makeGoal('c'));
    expect(g3).toBe(3); // 不复用 1

    // 从回收站还原 g1（id=1），与 g3(id=3) 不冲突
    const trash = await db.getTrashItems();
    const item = trash.find(t => t.originalId === g1);
    expect(item).toBeDefined();
    const ok = await db.restoreFromTrash(item!.id!);
    expect(ok).toBe(true);

    const goals = await db.getAllGoals();
    const ids = goals.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('savePlan 按 date upsert，返回同一 id', async () => {
    const p1 = await db.savePlan(makePlan('2026-08-01'));
    const p2 = await db.savePlan({ ...makePlan('2026-08-01'), timeBlocks: [{ id: genId(), startTime: '08:00', endTime: '09:00', taskTitle: 't', plannedContent: '', actualExecution: '', focusScore: 5, efficiencyScore: 5, completed: false, notes: '' }] });
    expect(p1).toBe(p2);
    const plan = await db.getPlanByDate('2026-08-01');
    expect(plan).toBeDefined();
    expect(plan!.timeBlocks).toHaveLength(1);
  });
});

// ============ 排序语义 ============

describe('查询排序语义（UI 依赖）', () => {
  beforeEach(async () => {
    await db.savePlan(makePlan('2026-08-01', 300));
    await db.savePlan(makePlan('2026-08-03', 100));
    await db.savePlan(makePlan('2026-08-02', 200));
  });

  it('getAllPlans 按 date 倒序', async () => {
    const plans = await db.getAllPlans();
    expect(plans.map(p => p.date)).toEqual(['2026-08-03', '2026-08-02', '2026-08-01']);
  });

  it('getAllGoals 按 createdAt 倒序', async () => {
    // 直接注入 store（saveGoal 对新建记录会重置 createdAt 为当前时间，与旧版一致）
    getStore().longTermGoals.push(makeGoal('old', 100), makeGoal('new', 300));
    const goals = await db.getAllGoals();
    expect(goals.map(g => g.title)).toEqual(['new', 'old']);
  });

  it('taskItems 按 sortOrder 升序', async () => {
    const mk = (sortOrder: number, title: string): TaskItem =>
      ({ id: genId(), title, completed: false, date: '2026-08-01', sortOrder, createdAt: 0, updatedAt: 0 });
    await db.saveTaskItem(mk(2, 'second'));
    await db.saveTaskItem(mk(1, 'first'));
    const items = await db.getTaskItemsByDate('2026-08-01');
    expect(items.map(i => i.title)).toEqual(['first', 'second']);
  });
});

// ============ 回收站 ============

describe('回收站', () => {
  it('软删除入回收站，还原可用，删除项不再出现', async () => {
    const g = await db.saveGoal(makeGoal('将被删除'));
    await db.deleteGoal(g);
    expect(await db.getAllGoals()).toHaveLength(0);

    const trash = await db.getTrashItems();
    expect(trash).toHaveLength(1);
    expect(trash[0].originalTable).toBe('longTermGoals');
    expect(trash[0].originalId).toBe(g);

    const ok = await db.restoreFromTrash(trash[0].id!);
    expect(ok).toBe(true);
    const goals = await db.getAllGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0].id).toBe(g);
    expect(await db.getTrashItems()).toHaveLength(0);
  });

  it('moveTimeBlockToTrash 深拷贝，原对象后续变更不影响回收站副本', async () => {
    const block: any = { id: genId(), startTime: '08:00', endTime: '09:00', taskTitle: 'original', plannedContent: '', actualExecution: '', focusScore: 5, efficiencyScore: 5, completed: false, notes: '' };
    await db.savePlan({ ...makePlan('2026-08-01'), timeBlocks: [block] });

    // 真实 removeBlock 流程：先移入回收站，再把块从 plan 移除
    await db.moveTimeBlockToTrash('2026-08-01', block, '标题');
    const planBefore = await db.getPlanByDate('2026-08-01');
    await db.savePlan({ ...planBefore!, timeBlocks: planBefore!.timeBlocks.filter(b => b.id !== block.id) });

    const trash = await db.getTrashItems();
    const t = trash.find(x => x.originalTable === 'timeBlocks')!;
    expect(t).toBeDefined();

    // 修改原 block 引用 → 回收站副本应不受影响（深拷贝）
    block.taskTitle = 'MUTATED';
    expect((t.originalData as any).taskTitle).toBe('original');

    // 还原：块回到当天 plan，且是独立副本
    const ok = await db.restoreFromTrash(t.id!);
    expect(ok).toBe(true);
    const plan = await db.getPlanByDate('2026-08-01');
    expect(plan!.timeBlocks.find(b => b.id === block.id)!.taskTitle).toBe('original');
  });

  it('cleanOldTrash 清理 30 天前项目并持久化', async () => {
    const oldItem: any = { id: 1, originalTable: 'longTermGoals', originalId: 99, originalData: {}, title: 'old', deletedAt: Date.now() - 31 * DAY };
    getStore().trashItems.push(oldItem);
    await db.saveGoal(makeGoal('fresh'));
    await db.deleteGoal(2); // 产生一条新回收站项

    await db.cleanOldTrash();
    const trash = await db.getTrashItems();
    expect(trash.find(t => t.id === 1)).toBeUndefined();

    // 持久化生效：重新初始化后仍无 30 天前的项
    await initStore();
    const after = await db.getTrashItems();
    expect(after.find(t => t.id === 1)).toBeUndefined();
  });

  it('permanentlyDelete / clearAllTrash', async () => {
    const g = await db.saveGoal(makeGoal('x'));
    await db.deleteGoal(g);
    await db.permanentlyDelete((await db.getTrashItems())[0].id!);
    expect(await db.getTrashItems()).toHaveLength(0);

    const g2 = await db.saveGoal(makeGoal('y'));
    await db.deleteGoal(g2);
    await db.clearAllTrash();
    expect(await db.getTrashItems()).toHaveLength(0);
  });
});

// ============ setActiveRoutine ============

describe('setActiveRoutine', () => {
  it('只保留一个激活模板', async () => {
    const r1 = await db.saveRoutine({ name: 'A', timeBlocks: [], isActive: true, createdAt: 0 } as any);
    const r2 = await db.saveRoutine({ name: 'B', timeBlocks: [], isActive: false, createdAt: 0 } as any);
    await db.setActiveRoutine(r2);
    const routines = await db.getAllRoutines();
    expect(routines.find(r => r.id === r1)!.isActive).toBe(false);
    expect(routines.find(r => r.id === r2)!.isActive).toBe(true);
    expect((await db.getActiveRoutine())!.id).toBe(r2);
  });
});

// ============ persist 快照与队列 ============

describe('persist 快照与串行队列', () => {
  it('入队后的再次变更不影响已捕获快照（不落中间态到文件）', async () => {
    // mutate → 入队并等待完成
    await db.savePlan(makePlan('2026-08-01'));
    // 未 persist 的直接改动
    getStore().dailyPlans.push(makePlan('2026-08-02'));
    await flush();

    // 重新从后端加载：只应有已 persist 的那条
    await initStore();
    const plans = await db.getAllPlans();
    expect(plans.map(p => p.date)).toEqual(['2026-08-01']);
  });
});

// ============ 路径 ============

describe('路径管理', () => {
  it('normalizePath 规范化输入并拒绝非法', () => {
    expect(normalizePath('MyNotes')).toBe('Documents/MyNotes');
    expect(normalizePath('Documents/MyNotes')).toBe('Documents/MyNotes');
    expect(normalizePath('  MyNotes/  ')).toBe('Documents/MyNotes');
    expect(() => normalizePath('')).toThrow();
    expect(() => normalizePath('..')).toThrow();
    expect(() => normalizePath('a/../b')).toThrow();
    expect(() => normalizePath('C:/x')).toThrow();
    expect(() => normalizePath('a:b')).toThrow();
  });

  it('changeStoragePath 切换路径并保留数据', async () => {
    await db.saveGoal(makeGoal('data'));
    const result = await changeStoragePath('Documents/Notes');
    expect(getStoragePath()).toBe('Documents/Notes');
    // Web 端 KV 是全局的，切换路径后数据仍在（原生端则写入新目录文件）
    expect(result.recovered).toBe(true);
    expect(await db.getAllGoals()).toHaveLength(1);
  });

  it('setStoragePath / getStoragePath 读写', () => {
    setStoragePath('Documents/Custom');
    expect(getStoragePath()).toBe('Documents/Custom');
  });
});

// ============ 导入 ============

describe('importJSONIntoStore', () => {
  it('导入合并保留时间戳（不重置 createdAt/updatedAt）', async () => {
    const json = JSON.stringify({
      version: 1,
      savedAt: 0,
      dailyPlans: [{ date: '2026-07-20', timeBlocks: [], createdAt: 111, updatedAt: 222 }],
      longTermGoals: [],
      reflections: [],
      harvests: [],
      fixedRoutines: [],
      taskItems: [],
    });
    const count = await importJSONIntoStore(json);
    expect(count).toBe(1);
    const plan = await db.getPlanByDate('2026-07-20');
    expect(plan!.createdAt).toBe(111);
    expect(plan!.updatedAt).toBe(222);
  });

  it('导入单个备份 JSON → 自动分布到新布局文件夹（不保留单文件存储）', async () => {
    const json = JSON.stringify({
      version: 1, savedAt: 0,
      dailyPlans: [{ date: '2026-07-20', timeBlocks: [], createdAt: 111, updatedAt: 222 }],
      longTermGoals: [{ id: 5, title: 'g', description: '', category: '技能', tasks: [], createdAt: 1, updatedAt: 1 }],
      reflections: [], harvests: [], fixedRoutines: [], taskItems: [],
      trashItems: [{ id: 2, originalTable: 'longTermGoals', originalId: 8, originalData: {}, title: 't', deletedAt: 1 }],
    });
    const count = await importJSONIntoStore(json);
    expect(count).toBe(3);

    // 磁盘上是分类文件夹文件，而不是单文件
    const keys = (await kvKeys()).sort();
    expect(keys).toContain('days/2026-07-20/plan.json');
    expect(keys).toContain('goals.json');
    expect(keys).toContain('trash.json');
    expect(keys).not.toContain('dailynote-data');
  });

  it('BOM 头被去除、非法格式被拒绝', async () => {
    await expect(importJSONIntoStore('\ufeff{"version":1,"dailyPlans":[],"longTermGoals":[],"reflections":[],"harvests":[],"fixedRoutines":[]}')).resolves.toBe(0);
    await expect(importJSONIntoStore('{"foo":"bar"}')).rejects.toThrow();
  });
});

// ============ 一次性迁移 ============

describe('一次性旧 Dexie 迁移', () => {
  it('后端空 + 旧库有数据 → 迁移进内存并写后端、删除旧库', async () => {
    await legacyDb.dailyPlans.add({ date: '2026-07-20', timeBlocks: [], createdAt: 100, updatedAt: 100 });
    await legacyDb.longTermGoals.add({ title: 'legacy', description: '', category: '技能', tasks: [], createdAt: 100, updatedAt: 100 });

    const count = await initStore();
    expect(count).toBe(2);

    expect(await db.getPlanByDate('2026-07-20')).toBeDefined();
    expect(await db.getAllGoals()).toHaveLength(1);

    // 旧库已删除（持久化成功 = 提交标记）
    const legacy = await readLegacyTables();
    expect(legacy.dailyPlans ?? []).toHaveLength(0);
    expect(legacy.longTermGoals ?? []).toHaveLength(0);

    // 持久化生效：再次初始化仍有数据
    await initStore();
    expect(await db.getPlanByDate('2026-07-20')).toBeDefined();
  });

  it('后端与旧库都有数据 → 按日期/id 合并，更新者胜', async () => {
    // 后端（KV）：date 2026-07-20，updatedAt=222（更新）
    // 注意：不能走 savePlan（它会对新记录重置 updatedAt），直接写 store 再 persist
    getStore().dailyPlans.push({ ...makePlan('2026-07-20'), updatedAt: 222 });
    await persist();
    // 旧库：同 date，updatedAt=111（旧），另一条独有 date
    await legacyDb.dailyPlans.add({ date: '2026-07-20', timeBlocks: [], createdAt: 111, updatedAt: 111 });
    await legacyDb.dailyPlans.add({ date: '2026-07-21', timeBlocks: [], createdAt: 100, updatedAt: 100 });

    await initStore();
    const plan20 = await db.getPlanByDate('2026-07-20');
    expect(plan20!.updatedAt).toBe(222); // 新者胜
    expect(await db.getPlanByDate('2026-07-21')).toBeDefined(); // 旧库独有并入
  });
});

// ============ 新布局：按日文件夹 + 分类文件 ============

describe('新布局：按日文件夹 + 分类文件', () => {
  it('各类型记录写入对应路径文件', async () => {
    await db.savePlan(makePlan('2026-08-01'));
    await db.saveGoal(makeGoal('目标'));
    await db.saveReflection({ date: '2026-08-01', period: 'morning', problem: 'p', cause: 'c', solution: 's', relatedTaskTitle: '', resolved: false, createdAt: 0 } as any);
    await db.saveTaskItem({ id: genId(), title: 't', completed: false, date: '2026-08-01', sortOrder: 0, createdAt: 0, updatedAt: 0 });

    const keys = (await kvKeys()).sort();
    expect(keys).toContain('days/2026-08-01/plan.json');
    expect(keys).toContain('days/2026-08-01/reflections.json');
    expect(keys).toContain('days/2026-08-01/tasks.json');
    expect(keys).toContain('goals.json');
  });

  it('plan.json 保存的是单个计划对象（不是数组）', async () => {
    await db.savePlan(makePlan('2026-08-01'));
    const raw = await kvGet('days/2026-08-01/plan.json');
    const parsed = JSON.parse(raw!);
    expect(parsed.date).toBe('2026-08-01');
    expect(Array.isArray(parsed)).toBe(false);
  });

  it('增量写：只写被改到的文件', async () => {
    await db.saveGoal(makeGoal('g'));
    let keys = await kvKeys();
    expect(keys).toEqual(['goals.json']); // 只有目标变脏

    await db.savePlan(makePlan('2026-08-01'));
    keys = (await kvKeys()).sort();
    expect(keys).toEqual(['days/2026-08-01/plan.json', 'goals.json'].sort());
  });

  it('删除某天最后一条反思 → 对应文件被删除', async () => {
    const rid = await db.saveReflection({ date: '2026-08-01', period: 'morning', problem: 'p', cause: '', solution: '', relatedTaskTitle: '', resolved: false, createdAt: 0 } as any);
    expect(await kvKeys()).toContain('days/2026-08-01/reflections.json');

    await db.deleteReflection(rid);
    expect(await kvKeys()).not.toContain('days/2026-08-01/reflections.json');

    await initStore();
    expect(await db.getReflectionsByDate('2026-08-01')).toHaveLength(0);
  });
});

// ============ 旧单文件迁移到新布局 ============

describe('旧版单文件迁移', () => {
  it('读旧文件 → 写入新布局 → 删除旧文件（提交标记），再启动仍可恢复', async () => {
    const bundle = JSON.stringify({
      version: 1, savedAt: 1,
      dailyPlans: [{ date: '2026-07-01', timeBlocks: [], createdAt: 1, updatedAt: 1 }],
      longTermGoals: [{ id: 7, title: 'legacy', description: '', category: '技能', tasks: [], createdAt: 1, updatedAt: 1 }],
      reflections: [], harvests: [], fixedRoutines: [], taskItems: [], trashItems: [],
    });
    await kvPut('dailynote-data', bundle);

    const count = await initStore();
    expect(count).toBe(2);
    expect(await db.getPlanByDate('2026-07-01')).toBeDefined();
    expect(await db.getAllGoals()).toHaveLength(1);

    const keys = await kvKeys();
    expect(keys).toContain('days/2026-07-01/plan.json');
    expect(keys).toContain('goals.json');
    expect(keys).not.toContain('dailynote-data'); // 旧文件已删除

    // 幂等：再次初始化仍完整
    await initStore();
    expect(await db.getPlanByDate('2026-07-01')).toBeDefined();
    expect(await db.getAllGoals()).toHaveLength(1);
  });

  it('回收站也一并迁移到 trash.json', async () => {
    const bundle = JSON.stringify({
      version: 1, savedAt: 1,
      dailyPlans: [], longTermGoals: [], reflections: [], harvests: [], fixedRoutines: [],
      taskItems: [],
      trashItems: [{ id: 3, originalTable: 'longTermGoals', originalId: 9, originalData: { id: 9, title: '已删' }, title: '已删', deletedAt: 1 }],
    });
    await kvPut('dailynote-data', bundle);

    await initStore();
    expect((await db.getTrashItems())).toHaveLength(1);
    const keys = await kvKeys();
    expect(keys).toContain('trash.json');
    expect(keys).not.toContain('dailynote-data');
  });
});

// ============ 加载自愈（跨文件半提交） ============

describe('加载自愈', () => {
  it('回收站副本若原表已有同 id 记录 → 丢弃副本，数据不丢', async () => {
    await kvPut('goals.json', JSON.stringify([{ ...makeGoal('现存目标'), id: 1 }]));
    await kvPut('trash.json', JSON.stringify([{ id: 999, originalTable: 'longTermGoals', originalId: 1, originalData: { ...makeGoal('现存目标'), id: 1 }, title: '重复副本', deletedAt: Date.now() }]));
    await initStore();
    expect(await db.getAllGoals()).toHaveLength(1);
    expect(await db.getTrashItems()).toHaveLength(0);
  });

  it('时间块副本若已回到当天计划 → 丢弃回收站副本', async () => {
    const block = { id: 'b1', startTime: '08:00', endTime: '09:00', taskTitle: 't', plannedContent: '', actualExecution: '', focusScore: 5, efficiencyScore: 5, completed: false, notes: '' };
    await kvPut('days/2026-08-01/plan.json', JSON.stringify({ ...makePlan('2026-08-01'), id: 1, timeBlocks: [block] }));
    await kvPut('trash.json', JSON.stringify([{ id: 999, originalTable: 'timeBlocks', originalId: 'b1', originalData: { date: '2026-08-01', ...block }, title: 'x', deletedAt: Date.now() }]));
    await initStore();
    expect(await db.getTrashItems()).toHaveLength(0);
    const plan = await db.getPlanByDate('2026-08-01');
    expect(plan!.timeBlocks).toHaveLength(1);
  });
});

// ============ 导出备份 ============

describe('导出备份文件', () => {
  let capturedAnchor: any;
  let blobContent = '';

  beforeEach(() => {
    blobContent = '';
    (globalThis as any).document = {
      createElement: () => {
        capturedAnchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
        return capturedAnchor;
      },
      body: { appendChild: vi.fn() },
    };
    (globalThis as any).Blob = class Blob {
      constructor(public parts: string[]) { blobContent = parts[0]; }
    };
    (globalThis as any).URL = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
  });

  it('Web 端触发浏览器下载，文件名含时间戳', async () => {
    await db.saveGoal(makeGoal('g'));
    const name = await exportBackupFile();
    expect(name).toMatch(/^dailynote-backup-\d{8}-\d{6}\.json$/);
    expect(capturedAnchor.download).toBe(name);
    expect(capturedAnchor.click).toHaveBeenCalled();
  });

  it('备份 JSON 内容有效且包含已保存数据', async () => {
    await db.saveGoal(makeGoal('目标'));
    await exportBackupFile();
    const parsed = JSON.parse(blobContent);
    expect(parsed.version).toBe(1);
    expect(parsed.longTermGoals).toHaveLength(1);
  });

  it('导出→重置→导入往返：任务清单模板完整恢复（换手机场景）', async () => {
    await db.saveTaskTemplate({ name: '往返模板', items: [{ id: genId(), text: '项', done: false }], createdAt: 0, updatedAt: 0 } as any);
    await exportBackupFile();
    const backup = blobContent;
    expect(JSON.parse(backup).taskTemplates).toHaveLength(1); // 备份包含模板

    await _resetForTest();
    const count = await importJSONIntoStore(backup);
    expect(count).toBe(1);
    const list = await db.getAllTaskTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('往返模板');
  });

  // 回归：浏览器里静态引入 @capacitor/app 会让 window.Capacitor 存在，
  // 但平台仍是 web，必须走浏览器下载，而不是 Capacitor Filesystem（否则抛 base64 错误）。
  it('浏览器存在 window.Capacitor 但平台=web：导出走浏览器下载，不抛 base64 错误', async () => {
    const prevWin = (globalThis as any).window;
    (globalThis as any).window = globalThis;
    (globalThis as any).Capacitor = { isNativePlatform: () => false };
    try {
      await db.saveGoal(makeGoal('web 目标'));
      const name = await exportBackupFile();
      expect(name).toMatch(/^dailynote-backup-\d{8}-\d{6}\.json$/);
      expect(capturedAnchor.download).toBe(name);
      expect(capturedAnchor.click).toHaveBeenCalled();
    } finally {
      (globalThis as any).Capacitor = undefined;
      if (prevWin === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWin;
    }
  });
});

// ============ isCapacitor 平台判定（Web 有 window.Capacitor 也不能误判为原生） ============

describe('isCapacitor 平台判定', () => {
  it('Web：window.Capacitor 存在但 isNativePlatform=false → false', () => {
    const prevWin = (globalThis as any).window;
    (globalThis as any).window = globalThis;
    (globalThis as any).Capacitor = { isNativePlatform: () => false };
    try {
      expect(isCapacitor()).toBe(false);
    } finally {
      (globalThis as any).Capacitor = undefined;
      if (prevWin === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWin;
    }
  });

  it('原生：isNativePlatform=true → true', () => {
    const prevWin = (globalThis as any).window;
    (globalThis as any).window = globalThis;
    (globalThis as any).Capacitor = { isNativePlatform: () => true };
    try {
      expect(isCapacitor()).toBe(true);
    } finally {
      (globalThis as any).Capacitor = undefined;
      if (prevWin === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWin;
    }
  });

  it('window 未定义（Node 测试环境）→ false', () => {
    expect(isCapacitor()).toBe(false);
  });

  it('浏览器带 window.Capacitor（平台=web）时 listSubdirs 仍返回空（无真实目录）', async () => {
    const prevWin = (globalThis as any).window;
    (globalThis as any).window = globalThis;
    (globalThis as any).Capacitor = { isNativePlatform: () => false };
    try {
      expect(await listSubdirs()).toEqual([]);
    } finally {
      (globalThis as any).Capacitor = undefined;
      if (prevWin === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWin;
    }
  });

  it('浏览器带 window.Capacitor（平台=web）时存储仍走 KV 后端', async () => {
    const prevWin = (globalThis as any).window;
    (globalThis as any).window = globalThis;
    (globalThis as any).Capacitor = { isNativePlatform: () => false };
    try {
      await db.saveGoal(makeGoal('kv 目标'));
      await flush();
      const raw = await kvGet('goals.json');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as Array<{ title: string }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].title).toBe('kv 目标');
    } finally {
      (globalThis as any).Capacitor = undefined;
      if (prevWin === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWin;
    }
  });
});

// ============ 课程表存储 ============

describe('课程表存储', () => {
  it('课程 CRUD 与持久化往返（initStore 重读）', async () => {
    const id = await db.saveCourse(makeCourse('高数'));
    expect(id).toBe(1);
    await db.saveCourse({ ...makeCourse('英语'), dayOfWeek: [2], startTime: '10:00' });
    let list = await db.getAllCourses();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('高数'); // dayOfWeek 1 排在 dayOfWeek 2 前

    await initStore(); // 从文件重读
    list = await db.getAllCourses();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('高数');
  });

  it('带 id 保存 = 更新不新增', async () => {
    const id = await db.saveCourse(makeCourse('高数'));
    await db.saveCourse({ ...makeCourse('高数'), id, name: '高等数学' });
    const list = await db.getAllCourses();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('高等数学');
  });

  it('学期设置：id 恒为 1、二次保存不重复', async () => {
    await db.saveSemester(makeSemester('2026-08-10'));
    await db.saveSemester({ ...makeSemester('2026-09-01'), id: 7 }); // 传入其他 id 也强制为 1
    const sem = await db.getSemester();
    expect(sem?.id).toBe(1);
    expect(sem?.startDate).toBe('2026-09-01');
    expect((getStore() as any).semester).toHaveLength(1);
  });

  it('未设置过学期 → undefined；startDate 可为 null（未开学）', async () => {
    expect(await db.getSemester()).toBeUndefined();
    await db.saveSemester(makeSemester(null));
    const sem = await db.getSemester();
    expect(sem?.startDate).toBeNull();
  });

  it('删除课程 → 回收站 → 还原（原 id 恢复）', async () => {
    const id = await db.saveCourse(makeCourse('高数'));
    await db.deleteCourse(id);
    expect(await db.getAllCourses()).toHaveLength(0);
    const trash = await db.getTrashItems();
    expect(trash).toHaveLength(1);
    expect(trash[0].originalTable).toBe('courses');
    expect(trash[0].title).toBe('课程 - 高数');
    const ok = await db.restoreFromTrash(trash[0].id!);
    expect(ok).toBe(true);
    const list = await db.getAllCourses();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('高数');
    expect(list[0].id).toBe(id);
  });

  it('删除后 id 不复用（与回收站还原不撞）', async () => {
    const id1 = await db.saveCourse(makeCourse('a'));
    await db.deleteCourse(id1);
    const id2 = await db.saveCourse(makeCourse('b'));
    expect(id2).toBeGreaterThan(id1);
  });

  it('导出→重置→导入往返：课程与学期完整恢复（换手机场景）', async () => {
    let blobContent = '';
    (globalThis as any).document = {
      createElement: () => ({ href: '', download: '', click: vi.fn(), remove: vi.fn() }),
      body: { appendChild: vi.fn() },
    };
    (globalThis as any).Blob = class Blob {
      constructor(public parts: string[]) { blobContent = parts[0]; }
    };
    (globalThis as any).URL = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };

    await db.saveCourse(makeCourse('高数'));
    await db.saveSemester({ ...makeSemester('2026-08-10'), specialDates: [{ id: 1, date: '2026-10-01', kind: 'makeup' }] });
    await exportBackupFile();
    const backup = blobContent;
    expect(JSON.parse(backup).courses).toHaveLength(1);
    expect(JSON.parse(backup).semester).toHaveLength(1);

    await _resetForTest();
    const count = await importJSONIntoStore(backup);
    expect(count).toBe(2);
    const list = await db.getAllCourses();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('高数');
    const sem = await db.getSemester();
    expect(sem?.startDate).toBe('2026-08-10');
    expect(sem?.specialDates[0].kind).toBe('makeup');
  });

  it('仅课程数据目录（无任何计划）不被当首次使用丢弃（回归）', async () => {
    await kvPut('courses.json', JSON.stringify([{ ...makeCourse('高数'), id: 1 }]));
    await initStore();
    const list = await db.getAllCourses();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('高数');
  });

  it('旧版单数字 dayOfWeek 数据读入时自动归一化为数组（兼容）', async () => {
    await kvPut('courses.json', JSON.stringify([{ ...makeCourse('高数'), id: 1, dayOfWeek: 4 }]));
    await initStore();
    const list = await db.getAllCourses();
    expect(list).toHaveLength(1);
    expect(list[0].dayOfWeek).toEqual([4]);
  });
});
