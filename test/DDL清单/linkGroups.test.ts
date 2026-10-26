/**
 * 关联分组（linkGroups）存储测试
 *
 * 覆盖新增表的完整链路：CRUD、软删除进回收站、落盘 linkGroups.json、
 * 启动重载、旧备份兼容、导入导出往返，以及 DDL 上的关联快照。
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

import { initStore, importJSONIntoStore, exportJSON, _resetForTest } from '../../src/services/store';
import * as db from '../../src/db';
import type { DdlItem, LinkGroup } from '../../src/types';

function makeGroup(name: string, items: LinkGroup['items'] = []): LinkGroup {
  return { name, items, createdAt: Date.now(), updatedAt: Date.now() };
}

function makeDdl(name: string, over: Partial<DdlItem> = {}): DdlItem {
  return {
    name,
    deadlineDate: '2026-11-10',
    deadlineTime: '23:59',
    location: '',
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

describe('关联分组 CRUD', () => {
  it('新建后按创建顺序返回', async () => {
    const a = await db.saveLinkGroup(makeGroup('实验'));
    const b = await db.saveLinkGroup(makeGroup('社团'));
    const list = await db.getAllLinkGroups();
    expect(list.map(g => g.name)).toEqual(['实验', '社团']);
    expect(list.map(g => g.id)).toEqual([a, b]);
    expect(list[0].createdAt).toBeGreaterThan(0);
  });

  it('带 id 再保存 = 更新，不新增', async () => {
    const id = await db.saveLinkGroup(makeGroup('旧名'));
    const [g] = await db.getAllLinkGroups();
    await db.saveLinkGroup({ ...g, name: '新名', items: [{ id: 'i1', name: '服务器 A' }] });
    const list = await db.getAllLinkGroups();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].name).toBe('新名');
    expect(list[0].items).toEqual([{ id: 'i1', name: '服务器 A' }]);
  });

  it('删除进回收站（originalTable=linkGroups），可还原', async () => {
    const id = await db.saveLinkGroup(makeGroup('实验', [{ id: 'i1', name: '服务器 A' }]));
    await db.deleteLinkGroup(id);
    expect(await db.getAllLinkGroups()).toHaveLength(0);

    const trash = await db.getTrashItems();
    expect(trash[0].originalTable).toBe('linkGroups');
    expect(trash[0].title).toBe('关联分组 - 实验');

    expect(await db.restoreFromTrash(trash[0].id!)).toBe(true);
    const restored = await db.getAllLinkGroups();
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(id);
    expect(restored[0].items).toEqual([{ id: 'i1', name: '服务器 A' }]);
  });
});

describe('关联分组持久化', () => {
  it('写入 linkGroups.json，initStore 重载仍在', async () => {
    await db.saveLinkGroup(makeGroup('实验', [{ id: 'i1', name: '服务器 A' }]));
    expect(await kvKeys()).toContain('linkGroups.json');

    const count = await initStore();
    expect(count).toBe(1);
    const list = await db.getAllLinkGroups();
    expect(list[0].name).toBe('实验');
    expect(list[0].items[0].name).toBe('服务器 A');
  });

  it('旧备份没有 linkGroups 字段 → 按空数组兼容，不报错', async () => {
    const old = JSON.stringify({
      version: 1, savedAt: 0, dailyPlans: [], longTermGoals: [], reflections: [],
      harvests: [], fixedRoutines: [], taskItems: [], taskTemplates: [], trashItems: [],
      courses: [], semester: [], ddls: [], backlog: [], taskBoard: [],
    });
    await expect(importJSONIntoStore(old)).resolves.toBe(0);
    expect(await db.getAllLinkGroups()).toHaveLength(0);
  });

  it('导出包含关联分组，导入后往返一致', async () => {
    const id = await db.saveLinkGroup(makeGroup('实验', [{ id: 'i1', name: '服务器 A' }]));
    const exported = JSON.parse(exportJSON());
    expect(exported.linkGroups).toHaveLength(1);
    expect(exported.linkGroups[0].name).toBe('实验');

    // 清空后再导入
    await _resetForTest();
    expect(await db.getAllLinkGroups()).toHaveLength(0);
    const n = await importJSONIntoStore(JSON.stringify(exported));
    expect(n).toBe(1);
    const list = await db.getAllLinkGroups();
    expect(list[0].id).toBe(id);
    expect(list[0].items[0].id).toBe('i1');
  });
});

describe('DDL 上的关联快照', () => {
  it('保存带关联的 DDL，重载后关联仍在', async () => {
    await db.saveDdl(makeDdl('交实验报告', {
      links: [
        { kind: 'course', id: '7', label: '近代物理学实验' },
        { kind: 'group', id: 'i1', label: '服务器 A', groupName: '实验' },
      ],
    }));

    const count = await initStore();
    expect(count).toBe(1);
    const [item] = await db.getAllDdls();
    expect(item.links).toHaveLength(2);
    expect(item.links![1]).toEqual({ kind: 'group', id: 'i1', label: '服务器 A', groupName: '实验' });
  });

  it('课程/分组被删后，DDL 仍保留当时的名字（快照）', async () => {
    const courseId = await db.saveCourse({
      name: '近代物理学实验', teacher: '', location: '', dayOfWeek: [2],
      startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 16,
      createdAt: 0, updatedAt: 0,
    });
    const groupId = await db.saveLinkGroup(makeGroup('实验', [{ id: 'i1', name: '服务器 A' }]));

    await db.saveDdl(makeDdl('交报告', {
      links: [
        { kind: 'course', id: String(courseId), label: '近代物理学实验' },
        { kind: 'group', id: 'i1', label: '服务器 A', groupName: '实验' },
      ],
    }));

    await db.deleteCourse(courseId);
    await db.deleteLinkGroup(groupId);

    const [item] = await db.getAllDdls();
    expect(item.links!.map(l => l.label)).toEqual(['近代物理学实验', '服务器 A']);
  });
});
