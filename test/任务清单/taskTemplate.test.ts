/**
 * 任务清单模板（TaskTemplate）测试
 *
 * 验证：
 *   1. 模板 CRUD：保存 / 读取 / 更新
 *   2. 删除进回收站 → 还原
 *   3. 持久化到 templates.json，initStore 重载仍在
 *   4. 增量写：仅改模板时只写 templates.json
 *   5. 旧备份（无 taskTemplates 字段）导入兼容
 *   6. 新布局空目录判定：仅 templates.json 存在不算空
 *   7. 回收站自愈：templates 与 trash 同 id 副本 → 丢弃回收站副本
 *   8. appendTemplateItems 纯函数语义
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

import { initStore, importJSONIntoStore, _resetForTest } from '../../src/services/store';
import * as db from '../../src/db';
import { appendTemplateItems, genId } from '../../src/types';
import type { TaskTemplate } from '../../src/types';

function makeTemplate(name: string, texts: string[] = []): TaskTemplate {
  return {
    name,
    items: texts.map(text => ({ id: genId(), text, done: false })),
    createdAt: 0,
    updatedAt: 0,
  } as TaskTemplate;
}

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

// ============ 模板 CRUD ============

describe('任务清单模板 CRUD', () => {
  it('save → getAll 字段完整，分配 id', async () => {
    const id = await db.saveTaskTemplate(makeTemplate('早起清单', ['早读英语', '背单词']));
    const list = await db.getAllTaskTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].name).toBe('早起清单');
    expect(list[0].items).toHaveLength(2);
    expect(list[0].createdAt).toBeGreaterThan(0);
    expect(list[0].updatedAt).toBeGreaterThan(0);
  });

  it('带 id 再 save = 更新（重命名），不新增 id', async () => {
    const id = await db.saveTaskTemplate(makeTemplate('旧名'));
    await db.saveTaskTemplate({ ...makeTemplate('新名'), id });
    const list = await db.getAllTaskTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].name).toBe('新名');
  });
});

// ============ 删除 / 回收站 ============

describe('模板删除与回收站', () => {
  it('删除走软删除进回收站（深拷贝），原表移除', async () => {
    const id = await db.saveTaskTemplate(makeTemplate('学习清单', ['A', 'B']));
    const original = (await db.getAllTaskTemplates())[0]; // 捕获原对象引用
    await db.deleteTaskTemplate(id);
    expect(await db.getAllTaskTemplates()).toHaveLength(0);

    const trash = await db.getTrashItems();
    expect(trash).toHaveLength(1);
    expect(trash[0].originalTable).toBe('taskTemplates');
    expect(trash[0].originalId).toBe(id);
    expect(trash[0].title).toContain('学习清单');

    // 深拷贝：删除后改原对象引用，回收站副本不应受影响
    original.name = 'MUTATED';
    expect((trash[0].originalData as TaskTemplate).name).toBe('学习清单');
  });

  it('restoreFromTrash 还原模板，id 不变、回收站移除', async () => {
    const id = await db.saveTaskTemplate(makeTemplate('还原我'));
    await db.deleteTaskTemplate(id);
    const trash = await db.getTrashItems();
    const ok = await db.restoreFromTrash(trash[0].id!);
    expect(ok).toBe(true);
    const list = await db.getAllTaskTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(await db.getTrashItems()).toHaveLength(0);
  });
});

// ============ 持久化 / 增量写 ============

describe('模板持久化', () => {
  it('写入 templates.json，initStore 重载后仍在', async () => {
    const id = await db.saveTaskTemplate(makeTemplate('持久化模板', ['x']));
    const keys = await kvKeys();
    expect(keys).toContain('templates.json');

    await initStore();
    const list = await db.getAllTaskTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
  });

  it('增量写：仅改模板时只写 templates.json', async () => {
    await db.saveTaskTemplate(makeTemplate('只有模板'));
    const keys = await kvKeys();
    expect(keys).toEqual(['templates.json']);
  });
});

// ============ 导入兼容 ============

describe('模板导入兼容', () => {
  it('旧备份 JSON（无 taskTemplates 字段）导入成功且模板为空', async () => {
    const json = JSON.stringify({
      version: 1, savedAt: 0,
      dailyPlans: [{ date: '2026-08-01', timeBlocks: [], createdAt: 1, updatedAt: 1 }],
      longTermGoals: [], reflections: [], harvests: [], fixedRoutines: [], taskItems: [],
    });
    const count = await importJSONIntoStore(json);
    expect(count).toBe(1);
    expect(await db.getAllTaskTemplates()).toHaveLength(0);
  });

  it('含模板的新备份导入后并入', async () => {
    const json = JSON.stringify({
      version: 1, savedAt: 0,
      dailyPlans: [],
      longTermGoals: [], reflections: [], harvests: [], fixedRoutines: [], taskItems: [],
      taskTemplates: [{ id: 5, name: '导入模板', items: [{ id: 'i1', text: 't', done: false }], createdAt: 1, updatedAt: 1 }],
    });
    const count = await importJSONIntoStore(json);
    expect(count).toBe(1);
    const list = await db.getAllTaskTemplates();
    expect(list).toHaveLength(1);
    // 数字表导入新记录时用 allocId 重新分配 id（与 longTermGoals 等一致），保留内容
    expect(typeof list[0].id).toBe('number');
    expect(list[0].name).toBe('导入模板');
    expect(list[0].items).toEqual([{ id: 'i1', text: 't', done: false }]);
  });
});

// ============ 新布局空目录判定 ============

describe('新布局空目录判定', () => {
  it('目录仅 templates.json 存在时不算空，initStore 返回记录数', async () => {
    await kvPut('templates.json', JSON.stringify([{ id: 1, name: '只有模板', items: [], createdAt: 1, updatedAt: 1 }]));
    const count = await initStore();
    expect(count).toBe(1);
    expect(await db.getAllTaskTemplates()).toHaveLength(1);
  });

  it('全新空目录 initStore 返回 -1（首次使用）', async () => {
    const count = await initStore();
    expect(count).toBe(-1);
  });
});

// ============ 回收站自愈 ============

describe('模板回收站自愈', () => {
  it('templates 与 trash 各有一条同 id 模板副本 → 丢弃回收站副本', async () => {
    await kvPut('templates.json', JSON.stringify([{ id: 1, name: '现存模板', items: [], createdAt: 1, updatedAt: 1 }]));
    await kvPut('trash.json', JSON.stringify([{ id: 999, originalTable: 'taskTemplates', originalId: 1, originalData: { id: 1, name: '现存模板', items: [], createdAt: 1, updatedAt: 1 }, title: '重复副本', deletedAt: Date.now() }]));
    await initStore();
    expect(await db.getAllTaskTemplates()).toHaveLength(1);
    expect(await db.getTrashItems()).toHaveLength(0);
  });
});

// ============ appendTemplateItems 纯函数 ============

describe('appendTemplateItems 纯函数', () => {
  it('追加到清单末尾：新 id 不与原冲突、done 全 false、模板 items 不可变', () => {
    const current = [{ id: 'c1', text: '已有', done: true }];
    const tplItems = [{ id: 't1', text: '模板项1', done: true }, { id: 't2', text: '模板项2', done: false }];
    const tplItemsCopy = JSON.parse(JSON.stringify(tplItems));

    const result = appendTemplateItems(current, tplItems);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(current[0]);
    expect(result[1].text).toBe('模板项1');
    expect(result[1].done).toBe(false); // 强制重置为未完成
    expect(result[2].text).toBe('模板项2');
    expect(result[2].done).toBe(false);
    // 新 id 不与原 id 冲突
    expect(result[1].id).not.toBe('t1');
    expect(result[1].id).not.toBe('c1');
    expect(result[2].id).not.toBe('t2');
    // 模板 items 未被改动（不可变）
    expect(tplItems).toEqual(tplItemsCopy);
  });

  it('模板 items 为空时内容不变、无副作用', () => {
    const current = [{ id: 'c1', text: '已有', done: false }];
    const result = appendTemplateItems(current, []);
    expect(result).toEqual(current);
    expect(current).toEqual([{ id: 'c1', text: '已有', done: false }]);
  });
});
