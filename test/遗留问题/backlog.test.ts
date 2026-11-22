/**
 * 遗留问题（BacklogItem）测试
 *
 * 验证：
 *   1. CRUD：保存 / 读取 / 更新，id 单调分配
 *   2. 状态流转：setBacklogStatus 会刷新 updatedAt（重新计时）
 *   3. 软删除进回收站 → 还原原 id
 *   4. 持久化到 backlog.json，initStore 重载仍在
 *   5. 增量写：只改遗留问题时只写 backlog.json
 *   6. 旧备份（无 backlog 字段）导入兼容
 *   7. 导出 → 导入往返
 *   8. 时间纯函数：距今折算、历时文案、气泡一周宽限、排序
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

// ---- Web 端 IndexedDB KV 后端检查辅助 ----
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
async function kvPut(key: string, value: string): Promise<void> {
  const db = await openKvDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function kvGet(key: string): Promise<string | null> {
  const db = await openKvDb();
  return new Promise(resolve => {
    const tx = db.transaction(KV_STORE, 'readonly');
    const greq = tx.objectStore(KV_STORE).get(key);
    greq.onsuccess = () => { db.close(); resolve(typeof greq.result === 'string' ? greq.result : null); };
    greq.onerror = () => { db.close(); resolve(null); };
  });
}

import { initStore, importJSONIntoStore, exportJSON, _resetForTest } from '../../src/services/store';
import * as db from '../../src/db';
import type { BacklogItem } from '../../src/types';
import {
  ageFromStartAt,
  backlogAgeText,
  countBacklogBadge,
  elapsedText,
  isBacklogDue,
  sortBacklog,
  startAtFromAge,
  BADGE_GRACE_DAYS,
} from '../../src/utils/backlog';

const DAY = 24 * 60 * 60 * 1000;

function makeItem(title: string, over: Partial<BacklogItem> = {}): BacklogItem {
  return {
    title,
    startMode: 'age',
    startAt: startAtFromAge(1, 0, 0),
    startText: '',
    blocker: '能力不足',
    detail: '',
    status: 'blocked',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

// ============ CRUD ============

describe('遗留问题 CRUD', () => {
  it('save → getAll 字段完整，分配 id', async () => {
    const id = await db.saveBacklog(makeItem('口语表达未突破'));
    const list = await db.getAllBacklog();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].title).toBe('口语表达未突破');
    expect(list[0].blocker).toBe('能力不足');
    expect(list[0].status).toBe('blocked');
    expect(list[0].createdAt).toBeGreaterThan(0);
    expect(list[0].updatedAt).toBeGreaterThan(0);
  });

  it('带 id 再 save = 更新，不新增记录', async () => {
    const id = await db.saveBacklog(makeItem('旧标题'));
    await db.saveBacklog({ ...makeItem('新标题'), id, blocker: '时间不足' });
    const list = await db.getAllBacklog();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].title).toBe('新标题');
    expect(list[0].blocker).toBe('时间不足');
  });

  it('id 单调递增，不复用已删 id', async () => {
    const a = await db.saveBacklog(makeItem('A'));
    await db.deleteBacklog(a);
    const b = await db.saveBacklog(makeItem('B'));
    expect(b).toBeGreaterThan(a);
  });

  it('setBacklogStatus 改状态并刷新 updatedAt（重新计时）', async () => {
    const id = await db.saveBacklog(makeItem('设备性能不足'));
    const before = (await db.getAllBacklog())[0].updatedAt;
    await new Promise(r => setTimeout(r, 5));
    await db.setBacklogStatus(id, 'ready');
    const after = (await db.getAllBacklog())[0];
    expect(after.status).toBe('ready');
    expect(after.updatedAt).toBeGreaterThan(before);
  });
});

// ============ 回收站 ============

describe('遗留问题删除与还原', () => {
  it('删除走软删除进回收站（深拷贝），原表移除', async () => {
    const id = await db.saveBacklog(makeItem('性格偏内向'));
    await db.deleteBacklog(id);
    expect(await db.getAllBacklog()).toHaveLength(0);

    const trash = await db.getTrashItems();
    expect(trash).toHaveLength(1);
    expect(trash[0].originalTable).toBe('backlog');
    expect(trash[0].originalId).toBe(id);
    expect(trash[0].title).toBe('遗留问题 - 性格偏内向');
  });

  it('还原恢复原 id 与字段', async () => {
    const id = await db.saveBacklog(makeItem('宿舍关系未改善', { detail: '住一起两年' }));
    await db.deleteBacklog(id);
    const trashId = (await db.getTrashItems())[0].id!;
    expect(await db.restoreFromTrash(trashId)).toBe(true);

    const list = await db.getAllBacklog();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].detail).toBe('住一起两年');
    expect(await db.getTrashItems()).toHaveLength(0);
  });
});

// ============ 持久化 ============

describe('遗留问题持久化', () => {
  it('写到 backlog.json，initStore 重载仍在', async () => {
    await db.saveBacklog(makeItem('职业方向未定', { startMode: 'text', startAt: null, startText: '小时候' }));

    const keys = await kvKeys();
    expect(keys).toContain('backlog.json');
    const raw = await kvGet('backlog.json');
    expect(raw).toContain('职业方向未定');

    // 再 initStore 一次 = 清空内存后重新从"磁盘"读
    const count = await initStore();
    expect(count).toBe(1);
    const list = await db.getAllBacklog();
    expect(list[0].title).toBe('职业方向未定');
    expect(list[0].startMode).toBe('text');
    expect(list[0].startText).toBe('小时候');
    expect(list[0].startAt).toBeNull();
  });

  it('增量写：只改遗留问题时只写 backlog.json', async () => {
    await db.saveBacklog(makeItem('A'));
    const before = await kvKeys();

    await db.saveBacklog(makeItem('B'));
    const after = await kvKeys();

    expect(after).toContain('backlog.json');
    // 没有凭空多出其它表文件
    expect(after.filter(k => k.endsWith('.json')).length).toBe(before.filter(k => k.endsWith('.json')).length);
  });

  it('导出包含 backlog，导入后仍在（往返）', async () => {
    await db.saveBacklog(makeItem('体检异常项未跟进'));
    const json = exportJSON();
    expect(json).toContain('"backlog"');

    await _resetForTest();
    await importJSONIntoStore(json);
    const list = await db.getAllBacklog();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('体检异常项未跟进');
  });

  it('旧备份缺少 backlog 字段时按空数组兼容', async () => {
    const old = JSON.stringify({
      version: 1,
      savedAt: 0,
      dailyPlans: [],
      longTermGoals: [],
      reflections: [],
      harvests: [],
      fixedRoutines: [],
      taskItems: [],
      taskTemplates: [],
      trashItems: [],
      courses: [],
      semester: [],
      ddls: [],
    });
    await expect(importJSONIntoStore(old)).resolves.toBe(0);
    expect(await db.getAllBacklog()).toHaveLength(0);
  });

  it('仅 backlog.json 的目录不被当作空目录（initStore 不返回 -1）', async () => {
    // 先把内存与 KV 清干净，再只往"磁盘"放 backlog.json
    await _resetForTest();
    await kvPut('backlog.json', JSON.stringify([{ ...makeItem('设备性能不足'), id: 1 }]));

    const count = await initStore();
    expect(count).toBe(1);
    expect(count).not.toBe(-1);
  });
});

// ============ 时间纯函数 ============

describe('遗留问题时间纯函数', () => {
  const base = new Date(2026, 7, 13); // 2026-08-13 本地

  it('距今全空 = 今天', () => {
    const at = startAtFromAge(0, 0, 0, base);
    expect(ageFromStartAt(at, base.getTime())).toEqual({ years: 0, months: 0, days: 0 });
    expect(elapsedText(at, base.getTime())).toBe('今天');
  });

  it('年填 2、月日不填 = 两年前的今天，历时 2 年', () => {
    const at = startAtFromAge(2, 0, 0, base);
    expect(ageFromStartAt(at, base.getTime())).toEqual({ years: 2, months: 0, days: 0 });
    expect(elapsedText(at, base.getTime())).toBe('历时 2 年');
  });

  it('年 1 月 2 日 3 → 历时 1 年 2 个月', () => {
    const at = startAtFromAge(1, 2, 3, base);
    expect(elapsedText(at, base.getTime())).toBe('历时 1 年 2 个月');
  });

  it('只填日 3 → 历时 3 天', () => {
    const at = startAtFromAge(0, 0, 3, base);
    expect(elapsedText(at, base.getTime())).toBe('历时 3 天');
  });

  it('月末回退不溢出（3/31 回退 1 个月 = 2 月最后一天）', () => {
    const mar31 = new Date(2026, 2, 31);
    const at = new Date(startAtFromAge(0, 1, 0, mar31));
    expect(at.getMonth()).toBe(1); // 2 月
  });

  it('非法/负数输入按 0 处理', () => {
    const at = startAtFromAge(-5, NaN as unknown as number, -1, base);
    expect(ageFromStartAt(at, base.getTime())).toEqual({ years: 0, months: 0, days: 0 });
  });

  it('文字填法原样显示，不算历时', () => {
    const item = makeItem('性格偏内向', { startMode: 'text', startAt: null, startText: '小时候' });
    expect(backlogAgeText(item)).toBe('小时候');
    const empty = makeItem('x', { startMode: 'text', startAt: null, startText: '  ' });
    expect(backlogAgeText(empty)).toBe('未填');
  });

  it('气泡只算「阻塞中 + 超过一周没动」', () => {
    const now = base.getTime();
    const oldBlocked = makeItem('老阻塞', { updatedAt: now - (BADGE_GRACE_DAYS + 1) * DAY });
    const newBlocked = makeItem('新阻塞', { updatedAt: now - 2 * DAY });
    const oldReady = makeItem('老可推进', { status: 'ready', updatedAt: now - 30 * DAY });

    expect(isBacklogDue(oldBlocked, now)).toBe(true);
    expect(isBacklogDue(newBlocked, now)).toBe(false);
    expect(isBacklogDue(oldReady, now)).toBe(false);
    expect(countBacklogBadge([oldBlocked, newBlocked, oldReady], now)).toBe(1);
  });

  it('排序：越久越靠前，文字填法垫底', () => {
    const now = base.getTime();
    const older = makeItem('久', { startAt: startAtFromAge(3, 0, 0, base), createdAt: 1 });
    const newer = makeItem('近', { startAt: startAtFromAge(0, 0, 5, base), createdAt: 2 });
    const text = makeItem('文字', { startMode: 'text', startAt: null, startText: '小时候', createdAt: 3 });

    const sorted = sortBacklog([newer, text, older]);
    expect(sorted.map(x => x.title)).toEqual(['久', '近', '文字']);
    expect(sorted.every(x => x.id === undefined)).toBe(true); // 不改原数组元素
    void now;
  });
});
