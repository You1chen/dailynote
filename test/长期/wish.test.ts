/**
 * 大愿望：与长期目标共用一张表，用 kind 区分；状态与期望日期独立
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

const mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => { mem[k] = v; },
  removeItem: (k: string) => { delete mem[k]; },
  clear: () => { Object.keys(mem).forEach(k => delete mem[k]); },
};

import { _resetForTest, initStore, getStore } from '../../src/services/store';
import * as db from '../../src/db';
import type { LongTermGoal } from '../../src/types';

beforeEach(async () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  await _resetForTest();
});

const wish = (over: Partial<LongTermGoal> = {}): LongTermGoal => ({
  kind: 'wish',
  title: '去一次海边',
  vision: '坐在礁石上听一整晚的浪',
  description: '想记住那种安静',
  category: '其他',
  targetDate: '2027-07-01',
  status: 'active',
  tasks: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('大愿望', () => {
  it('保存后能读回愿景、期望日期与状态', async () => {
    const id = await db.saveGoal(wish());
    const saved = (await db.getAllGoals()).find(g => g.id === id)!;
    expect(saved.kind).toBe('wish');
    expect(saved.vision).toBe('坐在礁石上听一整晚的浪');
    expect(saved.targetDate).toBe('2027-07-01');
    expect(saved.status).toBe('active');
  });

  it('与长期目标同表共存，靠 kind 区分', async () => {
    await db.saveGoal(wish());
    await db.saveGoal({ title: '考过六级', description: '', category: '学业', tasks: [], createdAt: 0, updatedAt: 0 });
    const all = await db.getAllGoals();
    expect(all.filter(g => g.kind === 'wish')).toHaveLength(1);
    expect(all.filter(g => g.kind !== 'wish')).toHaveLength(1);
  });

  it('旧数据没有 kind，按长期目标处理，不丢字段', async () => {
    const id = await db.saveGoal({ title: '旧目标', description: '说明', category: '学业', tasks: [], createdAt: 0, updatedAt: 0 });
    const old = (await db.getAllGoals()).find(g => g.id === id)!;
    expect(old.kind).toBeUndefined();
    expect(old.description).toBe('说明');
  });

  it('里程碑沿用 tasks，勾选即进度', async () => {
    const id = await db.saveGoal(wish({
      tasks: [
        { id: 'm1', title: '攒钱', completed: true, createdAt: 0 },
        { id: 'm2', title: '订票', completed: false, createdAt: 0 },
      ],
    }));
    const saved = (await db.getAllGoals()).find(g => g.id === id)!;
    expect(saved.tasks.filter(t => t.completed)).toHaveLength(1);
  });

  it('状态改变后落盘并在重启后仍在', async () => {
    const id = await db.saveGoal(wish());
    const saved = (await db.getAllGoals()).find(g => g.id === id)!;
    await db.saveGoal({ ...saved, status: 'done' });
    await initStore();
    expect(getStore().longTermGoals.find(g => g.id === id)!.status).toBe('done');
  });

  it('删除进回收站，还原后仍是愿望', async () => {
    const id = await db.saveGoal(wish());
    await db.deleteGoal(id);
    expect((await db.getAllGoals())).toHaveLength(0);

    const trash = await db.getTrashItems();
    const item = trash.find(t => t.originalTable === 'longTermGoals')!;
    expect(item).toBeTruthy();

    await db.restoreFromTrash(item.id!);
    const restored = (await db.getAllGoals()).find(g => g.id === id)!;
    expect(restored.kind).toBe('wish');
    expect(restored.vision).toBe('坐在礁石上听一整晚的浪');
  });
});
