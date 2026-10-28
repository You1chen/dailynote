import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetForTest, getStore } from '../../src/services/store';
import * as db from '../../src/db';

const values = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};

beforeEach(async () => {
  await _resetForTest();
});

describe('DB 边界的对象隔离', () => {
  it('查询返回深副本，嵌套修改不会绕过 mutate', async () => {
    await db.savePlan({
      date: '2026-10-28', timeBlocks: [{ id: 'b1', startTime: '08:00', endTime: '09:00', taskTitle: '原值', checklist: [{ id: 'c1', text: '原项', done: false }] }],
    } as any);
    const result = await db.getPlanByDate('2026-10-28');
    result!.timeBlocks[0].checklist![0].text = '被绕过';
    expect(getStore().dailyPlans[0].timeBlocks[0].checklist![0].text).toBe('原项');
  });

  it('保存入口复制调用方对象，后续外部修改不污染 store', async () => {
    const idea = { text: '原文', date: '2026-10-28', createdAt: 1, updatedAt: 1, links: [{ label: '原标签' }] } as any;
    await db.saveIdea(idea);
    idea.links[0].label = '外部修改';
    expect(getStore().ideas[0].links[0].label).toBe('原标签');
  });

  it('灵感还原按原表先于回收站写入', async () => {
    const id = await db.saveIdea({ text: '待还原', date: '2026-10-28', createdAt: 1, updatedAt: 1 } as any);
    await db.deleteIdea(id);
    const trash = (await db.getTrashItems()).find(item => item.originalId === id)!;
    expect(await db.restoreFromTrash(trash.id!)).toBe(true);
    expect(getStore().ideas.some(item => item.id === id)).toBe(true);
    expect(getStore().trashItems.some(item => item.id === trash.id)).toBe(false);
  });
});
