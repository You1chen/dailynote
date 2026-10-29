import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetForTest, exportJSON, flush, getStore, importJSONIntoStore, mutate, rescanFromDisk } from '../../src/services/store';
import { emptyStore } from '../../src/services/storeSchema';
import { buildSettlement, detectActivity, localActivityDate, posterFromSettlement } from '../../src/utils/settlement';
import type { LongTermGoal, TaskNode, TimeBlock } from '../../src/types';
import * as db from '../../src/db';

const memory: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => memory[k] ?? null, setItem: (k: string, v: string) => { memory[k] = v; }, removeItem: (k: string) => { delete memory[k]; } };
const date = () => localActivityDate(new Date());
const leaf = (id: string, title: string, done = false): TaskNode => ({ id, title, done, children: [] });
const goal = (): LongTermGoal => ({ id: 1, title: '学习', description: '', category: '', createdAt: 0, updatedAt: 0, tasks: [], nodes: [{ id: 'a', title: '甲', completed: false, children: [] }, { id: 'b', title: '乙', completed: false, children: [] }] });
beforeEach(async () => { await _resetForTest(); });

describe('结算实际活动与净推进', () => {
  it('本地日期使用设备年月日且事件 ID 唯一，旧时间戳不回填', async () => {
    const when = new Date(2026, 0, 2, 0, 1);
    expect(localActivityDate(when)).toBe('2026-01-02');
    const before = emptyStore(), after = emptyStore();
    after.ideas.push({ id: 1, text: '点子', date: '2000-01-01', createdAt: 0, updatedAt: 0 });
    const a = detectActivity(before, after, {}, when)[0], b = detectActivity(before, after, {}, when)[0];
    expect(a.date).toBe('2026-01-02');
    expect(a.id).not.toBe(b.id);
    expect(a.title).toBe('点子');
    expect(detectActivity(before, after, { skipActivity: true }, when)).toEqual([]);
  });
  it('TODO 重建随机 ID 和重排不算创建；完成撤销重做只计一次，自动裁剪不算删除', async () => {
    await mutate(() => { getStore().taskBoard = [{ id: 1, nodes: [leaf('a', '写作'), leaf('b', '阅读')], order: [], updatedAt: 0 }]; });
    await mutate(() => { getStore().taskBoard[0].nodes = [leaf('new-b', '阅读'), leaf('new-a', '写作')]; });
    expect(buildSettlement(getStore().activityEvents, date()).todo.created).toBe(2);
    for (const done of [true, false, true]) await mutate(() => { getStore().taskBoard[0].nodes[1].done = done; });
    await mutate(() => { getStore().taskBoard[0].nodes.splice(1, 1); });
    await mutate(() => { getStore().taskBoard[0].nodes[0].shelved = true; });
    expect(buildSettlement(getStore().activityEvents, date()).todo).toEqual({ created: 2, completed: 1, deleted: 0, shelved: 1 });
    await mutate(() => { getStore().taskBoard[0].nodes = []; });
    expect(buildSettlement(getStore().activityEvents, date()).todo.deleted).toBe(1);
  });
  it('文本模式改名按改名处理，不算删一条建一条', async () => {
    await mutate(() => { getStore().taskBoard = [{ id: 1, nodes: [leaf('a', '写作')], order: [], updatedAt: 0 }]; });
    const before = buildSettlement(getStore().activityEvents, date()).todo;
    await mutate(() => { getStore().taskBoard[0].nodes = [leaf('renamed', '写长文')]; });
    const after = buildSettlement(getStore().activityEvents, date()).todo;
    expect(after.created).toBe(before.created);
    expect(after.deleted).toBe(before.deleted);
  });
  it('目标和逐条计划记净进度，改结构或新建预完成不算完成', async () => {
    const block = { id: 'b', taskTitle: '读书', completed: false, checklist: [{ id: 'c1', text: '第一章', done: false }, { id: 'c2', text: '第二章', done: false }] } as TimeBlock;
    await mutate(() => { getStore().longTermGoals = [goal()]; getStore().dailyPlans = [{ date: '2000-01-01', timeBlocks: [block], createdAt: 0, updatedAt: 0 }]; });
    for (const completed of [true, false, true]) await mutate(() => { getStore().longTermGoals[0].nodes![0].completed = completed; getStore().dailyPlans[0].timeBlocks[0].checklist![0].done = completed; });
    let summary = buildSettlement(getStore().activityEvents, date());
    expect(summary.goals[0]).toMatchObject({ from: 0, to: 0.5, delta: 0.5 });
    expect(summary.plans[0]).toMatchObject({ entityId: '2000-01-01:b', delta: 0.5 });
    await mutate(() => { getStore().longTermGoals[0].nodes!.pop(); });
    summary = buildSettlement(getStore().activityEvents, date());
    expect(summary.goals[0].delta).toBe(0.5);
    expect(getStore().activityEvents.every(e => e.date === date())).toBe(true);
  });
  it('真正 db 完成小愿望/琐事才计完成，普通删除与还原不计创建', async () => {
    const make = (kind: 'wish' | 'chore' | 'idea') => ({ kind, text: kind, date: date(), createdAt: 0, updatedAt: 0 });
    const wish = await db.saveIdea(make('wish'));
    const chore = await db.saveIdea(make('chore'));
    const idea = await db.saveIdea(make('idea'));
    await db.deleteIdea(wish, 'complete');
    await db.deleteIdea(chore);
    await db.deleteIdea(idea);
    const count = getStore().activityEvents.length;
    const trashedIdea = getStore().trashItems.find(t => t.originalTable === 'ideas' && t.originalId === idea)!;
    await db.restoreFromTrash(trashedIdea.id!);
    expect(getStore().activityEvents).toHaveLength(count);
    const summary = buildSettlement(getStore().activityEvents, date());
    expect(summary.smallWishesCompleted).toBe(1);
    expect(summary.choresCompleted).toBe(0);
    expect(summary.ideasCreated).toBe(1);
  });
  it('DDL 撤销重做、大愿望里程碑分别保留净数', async () => {
    await mutate(() => {
      getStore().ddls = [{ id: 1, name: '交作业', deadlineDate: date(), deadlineTime: '', location: '', notes: '', images: [], createdAt: 0, updatedAt: 0 }];
      getStore().longTermGoals = [{ ...goal(), kind: 'wish', tasks: [{ id: 'm', title: '里程碑', completed: false, createdAt: 0 }] }];
    });
    for (const complete of [true, false, true]) await mutate(() => { getStore().ddls[0].dismissedAt = complete ? Date.now() : 0; getStore().longTermGoals[0].tasks[0].completed = complete; });
    const summary = buildSettlement(getStore().activityEvents, date());
    expect(summary.ddlCompleted).toBe(1);
    expect(summary.wishMilestones[0]).toMatchObject({ title: '里程碑', delta: 1, parentTitle: '学习' });
  });
  it('日期 JSON/快照/备份导入保留活动，反复导入去重且旧备份不伪造活动', async () => {
    await db.saveIdea({ text: '灵感', date: '2000-01-01', createdAt: 0, updatedAt: 0 });
    const backup = exportJSON();
    const events = structuredClone(getStore().activityEvents);
    await flush();
    expect(await rescanFromDisk()).toBeGreaterThan(0);
    expect(getStore().activityEvents).toEqual(events);
    await importJSONIntoStore(backup);
    await importJSONIntoStore(backup);
    expect(getStore().activityEvents).toEqual(events);
    await _resetForTest();
    const oldBackup = JSON.parse(backup);
    delete oldBackup.activityEvents;
    await importJSONIntoStore(JSON.stringify(oldBackup));
    expect(getStore().activityEvents).toEqual([]);
    await importJSONIntoStore(backup);
    expect(getStore().activityEvents).toEqual(events);
    const summary = buildSettlement([...events, ...events], date());
    expect(summary.ideasCreated).toBe(1);
    expect(summary.recordedSince).toBe(date());
    expect(buildSettlement(events, '2000-01-01').events).toEqual([]);
  });
  it('海报只保留非零项，进度按净变化显示，空的一天不编造数字', () => {
    const summary = buildSettlement([
      { id: '1', date: '2026-10-29', occurredAt: 1, category: 'todo', action: 'create', entityId: 'a', title: '写作', from: null, to: null },
      { id: '2', date: '2026-10-29', occurredAt: 2, category: 'todo', action: 'complete', entityId: 'a', title: '写作', from: 0, to: 1 },
      { id: '3', date: '2026-10-29', occurredAt: 3, category: 'goal', action: 'progress', entityId: 'g', title: '学习', from: 0, to: 0.25 },
      { id: '4', date: '2026-10-29', occurredAt: 4, category: 'plan', action: 'progress', entityId: 'p', title: '读书', from: 0.5, to: 0.5 },
    ], '2026-10-29');
    const poster = posterFromSettlement(summary);
    expect(poster.sections.map(section => section.title)).toEqual(['TODO · 行动的足迹', '长期目标 · 向前生长']);
    expect(poster.sections[0].items.map(item => item.label)).toEqual(['新建 TODO', '完成 TODO']);
    expect(poster.sections[1].items[0]).toMatchObject({ label: '学习', value: '+25 个百分点', detail: '0% → 25%' });
    expect(poster.headline).toContain('3 次行动'); // 新建 + 完成 + 目标推进；零净变化的计划不计

    const empty = posterFromSettlement(buildSettlement([], '2026-10-29'));
    expect(empty.sections).toEqual([]);
    expect(empty.headline).toBeUndefined();
  });
});
