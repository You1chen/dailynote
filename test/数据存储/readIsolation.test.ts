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
    const group = { name: '读书', items: [{ id: 'i1', name: '原标签' }], createdAt: 1, updatedAt: 1 } as any;
    await db.saveLinkGroup(group);
    group.items[0].name = '外部修改';
    expect(getStore().linkGroups[0].items[0].name).toBe('原标签');
  });

  it('回收站还原按原表先于回收站写入', async () => {
    const id = await db.saveLinkGroup({ name: '待还原', items: [{ id: 'i1', name: '课本章节' }], createdAt: 1, updatedAt: 1 });
    await db.deleteLinkGroup(id);
    const trash = (await db.getTrashItems()).find(item => item.originalId === id)!;
    expect(await db.restoreFromTrash(trash.id!)).toBe(true);
    expect(getStore().linkGroups.some(item => item.id === id)).toBe(true);
    expect(getStore().trashItems.some(item => item.id === trash.id)).toBe(false);
  });
});
