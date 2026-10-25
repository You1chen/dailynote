/**
 * 「重要的事」测试
 *
 * 验证：
 *   1. CRUD 往返、按截止时间升序（时间空按 23:59）
 *   2. 软删除进回收站（originalTable='important'）→ 还原
 *   3. 持久化到 important.json，initStore 重载仍在；旧备份缺字段兼容
 *   4. 侧栏气泡：剩余不足三天（含已过期）计数
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

import { initStore, importJSONIntoStore, _resetForTest } from '../../src/services/store';
import * as db from '../../src/db';
import type { ImportantItem } from '../../src/types';
import { countImportantNear, splitDeadlineItems, IMPORTANT_NEAR_MIN, IMPORTANT_KEEP_AFTER_MIN } from '../../src/utils/ddl';

function makeItem(name: string, over: Partial<ImportantItem> = {}): ImportantItem {
  return {
    name,
    deadlineDate: '2026-11-01',
    deadlineTime: '09:00',
    notes: '',
    images: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

describe('重要的事 CRUD', () => {
  it('保存后读取，字段完整', async () => {
    const id = await db.saveImportant(makeItem('体检'));
    const list = await db.getAllImportant();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].name).toBe('体检');
    expect(list[0].createdAt).toBeGreaterThan(0);
  });

  it('按截止时间升序；时间空按 23:59 排在当天最后', async () => {
    await db.saveImportant(makeItem('晚', { deadlineDate: '2026-11-02', deadlineTime: '' }));
    await db.saveImportant(makeItem('早', { deadlineDate: '2026-11-01', deadlineTime: '08:00' }));
    await db.saveImportant(makeItem('当天最早', { deadlineDate: '2026-11-02', deadlineTime: '07:00' }));
    const names = (await db.getAllImportant()).map(x => x.name);
    expect(names).toEqual(['早', '当天最早', '晚']);
  });

  it('带 id 再保存 = 更新，不新增', async () => {
    const id = await db.saveImportant(makeItem('旧名'));
    await db.saveImportant({ ...makeItem('新名'), id });
    const list = await db.getAllImportant();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('新名');
  });
});

describe('重要的事回收站', () => {
  it('删除进回收站（originalTable=important），可还原', async () => {
    const id = await db.saveImportant(makeItem('答辩'));
    await db.deleteImportant(id);
    expect(await db.getAllImportant()).toHaveLength(0);

    const trash = await db.getTrashItems();
    expect(trash[0].originalTable).toBe('important');
    expect(trash[0].title).toBe('重要 - 答辩');

    expect(await db.restoreFromTrash(trash[0].id!)).toBe(true);
    const list = await db.getAllImportant();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
  });
});

describe('重要的事持久化', () => {
  it('写入 important.json，initStore 重载仍在', async () => {
    await db.saveImportant(makeItem('搬家'));
    expect(await kvKeys()).toContain('important.json');

    const count = await initStore();
    expect(count).toBe(1);
    expect((await db.getAllImportant())[0].name).toBe('搬家');
  });

  it('旧备份缺少 important 字段时按空数组兼容', async () => {
    const old = JSON.stringify({
      version: 1, savedAt: 0, dailyPlans: [], longTermGoals: [], reflections: [],
      harvests: [], fixedRoutines: [], taskItems: [], taskTemplates: [], trashItems: [],
      courses: [], semester: [], ddls: [], backlog: [], taskBoard: [],
    });
    await expect(importJSONIntoStore(old)).resolves.toBe(0);
    expect(await db.getAllImportant()).toHaveLength(0);
  });
});

describe('重要的事三天气泡', () => {
  const now = new Date('2026-11-01T12:00:00');
  const mk = (deadlineDate: string, deadlineTime = '09:00') => ({ deadlineDate, deadlineTime });

  it('剩余 2 天 → 计入；剩余 5 天 → 不计', () => {
    expect(countImportantNear([mk('2026-11-03')], now)).toBe(1);
    expect(countImportantNear([mk('2026-11-06')], now)).toBe(0);
  });

  it('刚过期（一天内）→ 仍计入', () => {
    expect(countImportantNear([mk('2026-11-01', '09:00')], now)).toBe(1);
  });

  it('过期超过一天 → 不再计入（已收起）', () => {
    expect(countImportantNear([mk('2026-10-20')], now)).toBe(0);
  });

  it('阈值边界：三天内计入，超过不计', () => {
    const inDays = (min: number) => {
      const d = new Date(now.getTime() + min * 60000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    expect(countImportantNear([mk(inDays(IMPORTANT_NEAR_MIN - 10), '00:00')], now)).toBe(1);
    expect(countImportantNear([mk(inDays(IMPORTANT_NEAR_MIN + 24 * 60), '00:00')], now)).toBe(0);
  });

  it('时间空按 23:59 参与判定', () => {
    const m = countImportantNear([{ deadlineDate: '2026-11-04', deadlineTime: '' }], now);
    expect(m).toBe(0); // 11-04 23:59 距 11-01 12:00 约 3.5 天
  });

  it('格式非法不计入', () => {
    expect(countImportantNear([mk('2026-13-40')], now)).toBe(0);
  });
});

describe('重要的事过期收起', () => {
  const now = new Date('2026-11-05T12:00:00');
  const mk = (deadlineDate: string, deadlineTime = '09:00') => ({ deadlineDate, deadlineTime, name: deadlineDate });

  it('过期超过一天 → 收进 hidden；刚过期一天内仍在 visible', () => {
    const justPast = mk('2026-11-05', '09:00');   // 3 小时前
    const longPast = mk('2026-11-03', '09:00');   // 两天多前
    const future = mk('2026-11-08', '09:00');
    const { visible, hidden } = splitDeadlineItems([justPast, longPast, future], now, IMPORTANT_KEEP_AFTER_MIN);
    expect(visible.map(x => x.name)).toEqual(['2026-11-05', '2026-11-08']);
    expect(hidden.map(x => x.name)).toEqual(['2026-11-03']);
  });

  it('不传隐藏阈值时全部显示（DDL 行为）', () => {
    const { visible, hidden } = splitDeadlineItems([mk('2026-01-01')], now);
    expect(visible).toHaveLength(1);
    expect(hidden).toHaveLength(0);
  });

  it('时间非法的条目保留在 visible（不因解析失败藏掉用户数据）', () => {
    const { visible } = splitDeadlineItems([mk('2026-13-40')], now, IMPORTANT_KEEP_AFTER_MIN);
    expect(visible).toHaveLength(1);
  });

  it('已收起的条目不再计入气泡', () => {
    const hiddenItem = { deadlineDate: '2026-10-01', deadlineTime: '09:00' };
    expect(countImportantNear([hiddenItem], now)).toBe(0);
  });
});