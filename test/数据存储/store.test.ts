/**
 * 权威存储（store.ts / db/index.ts）测试
 *
 * 验证：
 *   1. 内存 CRUD 语义与排序
 *   2. id 单调递增（add → delete → add 不复用；回收站还原不撞 id）
 *   3. 回收站软删除 / 还原 / 深拷贝
 *   4. cleanOldTrash 清理并持久化
 *   5. persist 快照与串行队列
 *   6. 存储路径读写
 *   7. 一次性旧 Dexie 迁移（持久化成功后删除旧库）
 *   8. 已退役表（遗留/花园密钥/活动）的数据只做保全，不进内存 store
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

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

import type { DailyPlan, LongTermGoal, TaskItem, Course, SemesterRecord, DdlItem } from '../../src/types';
import { genId } from '../../src/types';
import {
  initStore,
  flush,
  persist,
  getStore,
  setStoragePath,
  getStoragePath,
  isCapacitor,
  _resetForTest,
} from '../../src/services/store';
import { emptyStore } from '../../src/services/storeSchema';
import { searchStore } from '../../src/utils/search';
import * as db from '../../src/db';
import { deleteCard, getCards } from '../../src/db/knowledgeCards';
import { clearSnapshot } from '../../src/services/snapshot';
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

function makeDdl(name: string, deadlineDate = '2026-08-20', deadlineTime = '18:30', createdAt = 0): DdlItem {
  return { name, deadlineDate, deadlineTime, notes: '', images: [], createdAt, updatedAt: createdAt } as DdlItem;
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
  it('setStoragePath / getStoragePath 读写', () => {
    setStoragePath('Documents/Custom');
    expect(getStoragePath()).toBe('Documents/Custom');
  });
});

// ============ 退役数据保全 ============

describe('退役数据保全', () => {
  it('遗留、花园密钥与活动日文件不再进入 StoreShape，保存后原样留在磁盘', async () => {
    const backlog = JSON.stringify([{ id: 1, title: '旧遗留', status: 'blocked', startMode: 'date', startAt: 1, createdAt: 1, updatedAt: 1 }]);
    const gardenKeys = JSON.stringify([{ id: 1, keyId: 'k1', version: 1, publicKey: 'pk', salt: 's', iv: 'i', privateKey: 'p', iterations: 310000, updatedAt: 1 }]);
    const activity = JSON.stringify([{ id: 'e1', date: '2026-08-01', category: 'goal', action: 'create', title: '旧活动', at: 1 }]);
    await kvPut('backlog.json', backlog);
    await kvPut('garden-keys.json', gardenKeys);
    await kvPut('days/2026-08-01/activity.json', activity);

    const shape = emptyStore() as Record<string, unknown>;
    expect(shape).not.toHaveProperty('backlog');
    expect(shape).not.toHaveProperty('gardenKeys');
    expect(shape).not.toHaveProperty('activityEvents');

    await initStore();
    await db.saveGoal(makeGoal('新目标'));
    await flush();

    expect(await kvGet('backlog.json')).toBe(backlog);
    expect(await kvGet('garden-keys.json')).toBe(gardenKeys);
    expect(await kvGet('days/2026-08-01/activity.json')).toBe(activity);
  });

  it('花园记录仍随目标与回收站保存，但不从公开接口和搜索泄漏', async () => {
    const wish = { id: 1, kind: 'wish', title: '秘密愿望', description: '只有花园可见', category: '', tasks: [], createdAt: 1, updatedAt: 1 };
    const wishTrash = { id: 5, originalTable: 'longTermGoals', originalId: 3, originalData: { ...wish, id: 3 }, title: '秘密花园条目', deletedAt: Date.now() };
    await kvPut('goals.json', JSON.stringify([wish, { ...makeGoal('公开目标'), id: 2 }]));
    await kvPut('trash.json', JSON.stringify([wishTrash]));
    await initStore();

    expect((await db.getAllGoals()).map(goal => goal.title)).toEqual(['公开目标']);
    expect((await db.getTrashItems()).some(item => (item.originalData as any)?.kind === 'wish')).toBe(false);
    expect(searchStore(getStore(), '秘密愿望')).toHaveLength(0);
    expect(getStore().longTermGoals).toHaveLength(2);

    await db.saveGoal(makeGoal('另一目标'));
    await flush();
    expect(JSON.parse((await kvGet('goals.json'))!).some((goal: any) => goal.kind === 'wish')).toBe(true);

    await db.clearAllTrash();
    expect(getStore().trashItems.some(item => (item.originalData as any)?.kind === 'wish')).toBe(true);
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
  it('旧文件含退役表内容时另存到 legacy 归档，可迁移的部分照常进入新布局', async () => {
    const bundle = JSON.stringify({
      version: 1, savedAt: 1,
      dailyPlans: [{ date: '2026-07-02', timeBlocks: [], createdAt: 1, updatedAt: 1 }],
      longTermGoals: [], reflections: [], harvests: [], fixedRoutines: [], taskItems: [], trashItems: [],
      backlog: [{ id: 1, title: '旧遗留', status: 'blocked' }],
      ideas: [{ id: 2, kind: 'idea', text: '旧杂念', date: '2026-07-02', createdAt: 1, updatedAt: 1 }],
    });
    await kvPut('dailynote-data', bundle);

    await initStore();
    expect(await db.getPlanByDate('2026-07-02')).toBeDefined();
    expect(await kvGet('dailynote-legacy-archive.json')).toBe(bundle);
    expect(await kvGet('dailynote-data')).toBeNull();
  });
});

describe('知识地图退役迁移', () => {
  function map(title: string, id = 1) {
    return { id, courseId: id, createdAt: 1, nodes: [{ id: 'node', title, cards: [{ text: title }] }] };
  }

  it('迁移地图独有的数据并原样保留文件，清空快照后不会恢复已删除卡片', async () => {
    const original = JSON.stringify([map('旧地图卡片')], null, 2);
    await kvPut('knowledge-maps.json', original);
    expect(await initStore()).toBe(1);
    expect(getStore()).not.toHaveProperty('knowledgeMaps');
    const [card] = await getCards();
    expect(card.title).toBe('旧地图卡片');
    await deleteCard(card.id);
    await persist();
    await flush();
    await clearSnapshot();
    await initStore();
    expect(await getCards()).toEqual([]);
    expect(JSON.parse((await kvGet('knowledge-cards.json'))!)[0].legacyMapsMigrated).toBe(true);
    expect(await kvGet('knowledge-maps.json')).toBe(original);
  });

  it('归档旧单文件，合并独有卡片并以分类文件的重复条目为准', async () => {
    const bundle = JSON.stringify({ version: 1, dailyPlans: [], knowledgeMaps: [map('旧的重复卡片'), map('旧单文件独有卡片', 2)] });
    const mapFile = JSON.stringify([map('分类文件的卡片')]);
    await kvPut('dailynote-data', bundle);
    await kvPut('knowledge-maps.json', mapFile);
    await initStore();
    const cards = await getCards();
    expect(cards.map(card => card.title)).toEqual(['分类文件的卡片', '旧单文件独有卡片']);
    expect(await kvGet('knowledge-maps.json')).toBe(mapFile);
    expect(await kvGet('dailynote-legacy-archive.json')).toBe(bundle);
    expect(await kvGet('dailynote-data')).toBeNull();

    await deleteCard(cards[0].id);
    // Simulate recovery when the original bundle is still present after the cards file was saved.
    await kvPut('dailynote-data', bundle);
    await initStore();
    expect((await getCards()).map(card => card.title)).toEqual(['旧单文件独有卡片']);
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

describe('DDL 存储', () => {
  it('DDL CRUD 与持久化往返（initStore 重读），按截止时间升序', async () => {
    const id = await db.saveDdl(makeDdl('高数作业'));
    expect(id).toBe(1);
    await db.saveDdl(makeDdl('实验报告', '2026-08-15', '09:00')); // 日期更早 → 排最前
    await db.saveDdl(makeDdl('英语作文', '2026-08-20', '08:00')); // 同日更早 → 排在高数作业前
    let list = await db.getAllDdls();
    expect(list.map(d => d.name)).toEqual(['实验报告', '英语作文', '高数作业']);

    await initStore(); // 从文件重读
    list = await db.getAllDdls();
    expect(list).toHaveLength(3);
    expect(list.map(d => d.name)).toEqual(['实验报告', '英语作文', '高数作业']);
  });

  it('同日同刻：按 id 升序兜底稳定', async () => {
    await db.saveDdl(makeDdl('a'));
    await db.saveDdl(makeDdl('b'));
    const list = await db.getAllDdls();
    expect(list.map(d => d.name)).toEqual(['a', 'b']);
  });

  it('带 id 保存 = 更新不新增，images/notes 数组与长文本往返', async () => {
    const id = await db.saveDdl(makeDdl('高数作业'));
    const img = 'data:image/jpeg;base64,/9j/4AAQ';
    await db.saveDdl({
      ...makeDdl('高数作业'),
      id,
      name: '高等数学作业',
      notes: '第一行\n第二行\n'.repeat(50), // 足够长的多行备注
      images: [img, img],
    });
    const list = await db.getAllDdls();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('高等数学作业');
    expect(list[0].notes).toContain('第一行');
    expect(list[0].images).toEqual([img, img]);

    await initStore(); // 持久化后重读，dataURL 完整保留
    const reread = await db.getAllDdls();
    expect(reread[0].images).toEqual([img, img]);
  });

  it('删除 DDL → 回收站（originalTable=ddls，标题 DDL - 名称）→ 还原原 id', async () => {
    const id = await db.saveDdl(makeDdl('高数作业'));
    await db.deleteDdl(id);
    expect(await db.getAllDdls()).toHaveLength(0);
    const trash = await db.getTrashItems();
    expect(trash).toHaveLength(1);
    expect(trash[0].originalTable).toBe('ddls');
    expect(trash[0].title).toBe('DDL - 高数作业');
    const ok = await db.restoreFromTrash(trash[0].id!);
    expect(ok).toBe(true);
    const list = await db.getAllDdls();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
  });

  it('删除后 id 不复用（与回收站还原不撞）', async () => {
    const id1 = await db.saveDdl(makeDdl('a'));
    await db.deleteDdl(id1);
    const id2 = await db.saveDdl(makeDdl('b'));
    expect(id2).toBeGreaterThan(id1);
  });

  it('仅 ddls.json 目录（无任何计划）不被当首次使用丢弃（回归）', async () => {
    await kvPut('ddls.json', JSON.stringify([{ ...makeDdl('高数作业'), id: 1 }]));
    await initStore();
    const list = await db.getAllDdls();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('高数作业');
  });
});
