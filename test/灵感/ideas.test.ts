/**
 * 灵感：新增数据表 ideas.json 的往返、排序、回收站与导出导入
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

import { _resetForTest, initStore, exportJSON, importJSONIntoStore, getStore } from '../../src/services/store';
import * as db from '../../src/db';

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

const mk = (text: string, date: string) => ({
  text, date, source: 'todo' as const, createdAt: 0, updatedAt: 0,
});

describe('灵感', () => {
  it('新增后可读回，按日期倒序', async () => {
    await db.saveIdea(mk('第一条', '2026-10-20'));
    await db.saveIdea(mk('第二条', '2026-10-25'));
    await db.saveIdea(mk('同一天', '2026-10-25'));

    const list = await db.getAllIdeas();
    expect(list).toHaveLength(3);
    expect(list[0].date).toBe('2026-10-25');
    expect(list[list.length - 1].date).toBe('2026-10-20');
  });

  it('带 id 保存 = 更新，不新增', async () => {
    const id = await db.saveIdea(mk('原样', '2026-10-25'));
    await db.saveIdea({ ...mk('改过', '2026-10-25'), id });
    const list = await db.getAllIdeas();
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('改过');
  });

  it('删除进回收站，可还原（原 id 恢复）', async () => {
    const id = await db.saveIdea(mk('会被删', '2026-10-25'));
    await db.deleteIdea(id);
    expect((await db.getAllIdeas())).toHaveLength(0);

    const trash = await db.getTrashItems();
    const item = trash.find(t => t.originalTable === 'ideas')!;
    expect(item.title).toContain('灵感');

    await db.restoreFromTrash(item.id!);
    const list = await db.getAllIdeas();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
  });

  it('落盘到 ideas.json 并能在重启后读回', async () => {
    await db.saveIdea(mk('要持久化', '2026-10-25'));
    await initStore();
    const list = await db.getAllIdeas();
    expect(list.map(i => i.text)).toContain('要持久化');
  });

  it('导出→重置→导入往返', async () => {
    await db.saveIdea(mk('备份我', '2026-10-24'));
    const json = exportJSON();
    await _resetForTest();
    await importJSONIntoStore(json);
    expect((await db.getAllIdeas()).map(i => i.text)).toContain('备份我');
  });

  it('不影响其它表', async () => {
    await db.saveIdea(mk('只写灵感', '2026-10-25'));
    const s = getStore();
    expect(s.ideas).toHaveLength(1);
    expect(s.ddls).toHaveLength(0);
    expect(s.harvests).toHaveLength(0);
  });
});
