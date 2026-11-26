/**
 * 启动快照：只同步「变了的部分」，不再每次启动全量读文件
 *
 * 验证：
 *   1. 第二次启动走快照（文件名未变 → 不重读内容）
 *   2. 目录结构变化（新增日期）→ 快照失效 → 全量读，能看到新数据
 *   3. rescanFromDisk 丢弃快照 → 外部修改能被读进来
 *   4. 换存储目录不复用快照
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = v; },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
};

import { _resetForTest, initStore, rescanFromDisk, flush, getStore } from '../../src/services/store';
import * as db from '../../src/db';
import { readSnapshot, clearSnapshot, sameNames, filesCover } from '../../src/services/snapshot';

/** 直接往 KV 里写一条（模拟外部改动） */
async function kvPut(key: string, value: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('dailynote_kv', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const dbi = req.result;
      const tx = dbi.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => { dbi.close(); resolve(); };
      tx.onerror = () => { dbi.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

describe('启动快照', () => {
  it('写入同一个任务文件后立即重新启动也能读到最新任务', async () => {
    const node = { id: 'a', title: 'old', done: false, children: [] };
    await db.saveTaskBoard({ nodes: [node], order: [] });
    await flush();
    await db.saveTaskBoard({ nodes: [{ ...node, title: 'new' }], order: [] });
    await initStore();
    expect((await db.getTaskBoard()).nodes[0].title).toBe('new');
  });
  it('首次启动写快照，目录结构不变时复用快照', async () => {
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    await flush();
    await initStore();

    const snap = await readSnapshot((await import('../../src/services/store')).getStoragePath());
    expect(snap).not.toBeNull();
    expect(snap!.dates).toContain('2026-03-01');

    // 目录结构不变时仍复用快照。
    await initStore();
    expect((getStore().dailyPlans[0] as any).injected).toBeUndefined();
  });

  it('同路径内容外改时复用快照，显式重扫才读取新内容', async () => {
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    const { persist } = await import('../../src/services/store');
    await persist();
    await flush();
    await initStore();
    await kvPut('days/2026-03-01/plan.json', JSON.stringify({
      date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0, injected: true,
    }));
    await initStore();
    expect((getStore().dailyPlans[0] as any).injected).toBeUndefined();
    await rescanFromDisk();
    expect((getStore().dailyPlans[0] as any).injected).toBe(true);
  });

  it('快照列出未创建的分类文件时仍能命中', async () => {
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    await flush();
    await initStore();
    // 再次写入会让快照带上全部类别文件名，而磁盘上仍只有 plan.json。
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    await flush();
    await kvPut('days/2026-03-01/plan.json', JSON.stringify({
      date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0, injected: true,
    }));
    await initStore();
    expect((getStore().dailyPlans[0] as any).injected).toBeUndefined();
  });

  it('filesCover 允许快照多列尚未创建的分类文件', () => {
    expect(filesCover(['plan.json', 'goals.json'], ['plan.json'])).toBe(true);
    expect(filesCover(['plan.json'], ['plan.json', 'goals.json'])).toBe(false);
  });

  it('新增日期目录 → 快照失效 → 全量读能看到新数据', async () => {
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    await flush();
    await initStore();

    await kvPut('days/2026-03-02/plan.json', JSON.stringify({
      date: '2026-03-02', timeBlocks: [], createdAt: 0, updatedAt: 0,
    }));
    await initStore();
    expect(getStore().dailyPlans.map(p => p.date)).toContain('2026-03-02');
  });

  it('rescanFromDisk 丢弃快照后能读到外部修改', async () => {
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    await flush();
    await initStore();

    await kvPut('days/2026-03-01/plan.json', JSON.stringify({
      date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0, injected: true,
    }));
    await rescanFromDisk();
    expect((getStore().dailyPlans[0] as any).injected).toBe(true);
  });

  it('快照带目录名，换目录不命中', async () => {
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    await flush();
    await initStore();

    const snap = await readSnapshot('Documents/dailynote');
    if (snap) expect(snap.root).toBe('Documents/dailynote');
    expect(await readSnapshot('Documents/other')).toBeNull();
  });

  it('sameNames 顺序无关', () => {
    expect(sameNames(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameNames(['a'], ['a', 'b'])).toBe(false);
    expect(sameNames([], [])).toBe(true);
  });

  it('clearSnapshot 后读不到快照', async () => {
    await db.savePlan({ date: '2026-03-01', timeBlocks: [], createdAt: 0, updatedAt: 0 } as any);
    await flush();
    await initStore();
    await clearSnapshot();
    expect(await readSnapshot('Documents/dailynote')).toBeNull();
  });
});
