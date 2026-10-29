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
import { effectiveNodes } from '../../src/utils/goalTree';
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

describe('愿望编辑闭环', () => {
  it('编辑愿望主体与里程碑时保留原 ID', async () => {
    const id = await db.saveGoal(wish({
      tasks: [{ id: 'm1', title: '攒钱', completed: true, createdAt: 0 }],
    }));
    const saved = (await db.getAllGoals()).find(g => g.id === id)!;

    await db.saveGoal({
      ...saved,
      title: '去海边看日出',
      vision: '在礁石上等到天亮',
      description: '想记住安静',
      tasks: [
        ...saved.tasks,
        { id: 'm2', title: '订票', completed: false, createdAt: 1 },
      ],
    });

    const all = await db.getAllGoals();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].title).toBe('去海边看日出');
    expect(all[0].vision).toBe('在礁石上等到天亮');
    expect(all[0].tasks.map(t => t.title)).toEqual(['攒钱', '订票']);
    expect(all[0].tasks[0].completed).toBe(true);
  });
});

describe('长期目标树', () => {
  const treeGoal = (over: Partial<LongTermGoal> = {}): LongTermGoal => ({
    title: '英语考试',
    description: '',
    category: '学业',
    tasks: [],
    nodes: [{
      id: 'n1',
      title: '听力',
      completed: false,
      children: [
        { id: 'n2', title: '精听', completed: true, children: [] },
        { id: 'n3', title: '泛听', completed: false, children: [] },
      ],
    }],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });

  it('树落盘并在重启后保留层级与完成状态', async () => {
    const id = await db.saveGoal(treeGoal());
    await initStore();

    const saved = getStore().longTermGoals.find(g => g.id === id)!;
    expect(saved.nodes).toHaveLength(1);
    expect(saved.nodes![0].children.map(n => n.id)).toEqual(['n2', 'n3']);
    expect(saved.nodes![0].children[0].completed).toBe(true);
  });

  it('旧扁平 tasks 仍可读；保存 nodes: [] 后不会被 tasks 复活', async () => {
    const id = await db.saveGoal({
      title: '旧目标',
      description: '',
      category: '学业',
      tasks: [{ id: 't1', title: '旧任务', completed: true, createdAt: 0 }],
      createdAt: 0,
      updatedAt: 0,
    });

    const legacy = (await db.getAllGoals()).find(g => g.id === id)!;
    expect(effectiveNodes(legacy).map(n => n.title)).toEqual(['旧任务']);
    expect(effectiveNodes(legacy)[0].completed).toBe(true);

    await db.saveGoal({ ...legacy, nodes: [] });
    await initStore();

    const cleared = getStore().longTermGoals.find(g => g.id === id)!;
    expect(cleared.nodes).toEqual([]);
    expect(effectiveNodes(cleared)).toEqual([]);
    // 旧字段原样保留，只作为兼容副本，不再参与读取
    expect(cleared.tasks).toHaveLength(1);
  });

  it('删除进回收站，还原后树仍在', async () => {
    const id = await db.saveGoal(treeGoal());
    await db.deleteGoal(id);

    const item = (await db.getTrashItems()).find(t => t.originalTable === 'longTermGoals')!;
    await db.restoreFromTrash(item.id!);

    const restored = (await db.getAllGoals()).find(g => g.id === id)!;
    expect(restored.nodes![0].children.map(n => n.title)).toEqual(['精听', '泛听']);
  });
});
