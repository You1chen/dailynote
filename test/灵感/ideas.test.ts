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
import { normalizeIdea } from '../../src/types';

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

describe('杂念三型', () => {
  it('kind 区分小愿望 / 琐事 / 灵感，互不混淆', async () => {
    await db.saveIdea({ kind: 'wish', text: '想去看海', date: '2026-10-27', createdAt: 0, updatedAt: 0 });
    await db.saveIdea({ kind: 'chore', text: '交电费', date: '2026-10-27', createdAt: 0, updatedAt: 0 });
    await db.saveIdea({ kind: 'idea', title: '一个念头', text: '详情', date: '2026-10-27', createdAt: 0, updatedAt: 0 });

    const list = (await db.getAllIdeas()).map(normalizeIdea);
    expect(list.filter(i => i.kind === 'wish')).toHaveLength(1);
    expect(list.filter(i => i.kind === 'chore')).toHaveLength(1);
    expect(list.filter(i => i.kind === 'idea')).toHaveLength(1);
  });

  it('灵感可带标题、详情与标签', async () => {
    const id = await db.saveIdea({
      kind: 'idea', title: '标题', text: '详情内容',
      tags: ['产品', '想法'], date: '2026-10-27', createdAt: 0, updatedAt: 0,
    });
    const item = (await db.getAllIdeas()).find(i => i.id === id)!;
    expect(item.title).toBe('标题');
    expect(item.tags).toEqual(['产品', '想法']);
  });

  it('旧数据缺 kind 视为灵感', () => {
    expect(normalizeIdea({ text: 'x', date: '2026-10-27', createdAt: 0, updatedAt: 0 }).kind).toBe('idea');
    expect(normalizeIdea({ text: 'x', date: '2026-10-27', createdAt: 0, updatedAt: 0 }).tags).toEqual([]);
  });

  it('三类共用一张表，删除互不影响', async () => {
    const w = await db.saveIdea({ kind: 'wish', text: '愿望', date: '2026-10-27', createdAt: 0, updatedAt: 0 });
    await db.saveIdea({ kind: 'chore', text: '琐事', date: '2026-10-27', createdAt: 0, updatedAt: 0 });
    await db.deleteIdea(w);
    const list = (await db.getAllIdeas()).map(normalizeIdea);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('chore');
  });

  it('每次增删改与还原都广播变更事件，各页计数可即时刷新', async () => {
    const events: string[] = [];
    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = {
      dispatchEvent(event: { type: string }) { events.push(event.type); return true; },
    };
    try {
      const id = await db.saveIdea({ kind: 'wish', text: '新增', date: '2026-10-27', createdAt: 0, updatedAt: 0 });
      await db.saveIdea({ kind: 'wish', text: '改名', date: '2026-10-27', createdAt: 0, updatedAt: 0, id });
      await db.deleteIdea(id);
      const trashed = (await db.getTrashItems()).find(t => t.originalTable === 'ideas')!;
      await db.restoreFromTrash(trashed.id!);
      // 只有灵感计入「记录灵感」；小愿望/琐事的成果按实现时统计
      await db.saveIdea({ kind: 'idea', text: '真正记下的灵感', date: '2026-10-27', createdAt: 0, updatedAt: 0 });
    } finally {
      if (previousWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = previousWindow;
    }
    // 新增、更新、删除、还原、再新增各一次
    expect(events.filter(e => e === 'dailynote-ideas-changed')).toHaveLength(5);
    // 仅灵感新增产生一条交互记录；更新不算新建，还原不补记
    expect(events.filter(e => e === 'dailynote-activity-changed')).toHaveLength(1);
  });
});