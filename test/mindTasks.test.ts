import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../src/db';
import { toggleTaskTimer } from '../src/db/taskTimers';
import { _resetForTest, exportJSON, importJSONIntoStore, initStore, mutate, store } from '../src/services/store';
import type { Idea, TaskNode } from '../src/types';
import { flattenTaskRows, rowsToTree } from '../src/utils/taskRows';
import { executionLeavesOf, TASK_UNDO_MS } from '../src/utils/taskTree';

const preferences = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => { preferences.set(key, value); },
    removeItem: (key: string) => { preferences.delete(key); },
  },
});

const thought = (text: string, kind?: Idea['kind']): Idea => ({
  text, kind, date: '2026-06-15', createdAt: 100, updatedAt: 100,
});
const regularTask = (title: string): TaskNode => ({ id: 'regular', title, done: false, children: [], shelved: true });
const leafKey = (nodeId: string) => `task-id:${nodeId}`;
async function taskLeaves() {
  const board = await db.getTaskBoard();
  return executionLeavesOf(board.nodes, board.order);
}

beforeEach(async () => {
  preferences.clear();
  await _resetForTest();
});

describe('小愿望与琐事 → TODO 遗留', () => {
  it('backfills stored legacy entries once without touching same-title TODOs or independent ideas', async () => {
    await mutate(() => {
      store.ideas = [
        { ...thought('同名', 'wish'), id: 7 },
        { ...thought('同名', 'chore'), id: 8 },
        { ...thought('旧灵感'), id: 9 },
        { ...thought('灵感', 'idea'), id: 10 },
      ];
      store.taskBoard = [{ id: 1, nodes: [regularTask('同名')], order: ['同名'], updatedAt: 200 }];
    }, { skipActivity: true });
    await initStore();
    const first = await db.getTaskBoard();
    expect(first.nodes).toHaveLength(3);
    expect(first.nodes[0]).toEqual(regularTask('同名'));
    expect(first.nodes.slice(1)).toEqual([
      expect.objectContaining({ title: '同名', mindLinked: true, shelved: true }),
      expect.objectContaining({ title: '同名', mindLinked: true, shelved: true }),
    ]);
    expect(new Set(first.nodes.map(n => n.id)).size).toBe(3);
    expect(store.ideas.map(i => i.taskNodeId)).toEqual([first.nodes[1].id, first.nodes[2].id, undefined, undefined]);
    expect(store.ideas.map(i => i.id)).toEqual([7, 8, 9, 10]);
    await initStore();
    expect(await db.getTaskBoard()).toEqual(first);
  });

  it('syncs edits both ways without recreating the linked row or changing its order', async () => {
    const id = await db.saveIdea(thought('先写在杂念', 'chore'));
    const [before] = await taskLeaves();
    await db.saveIdea({ ...thought('杂念编辑', 'chore'), id });
    expect(await taskLeaves()).toMatchObject([{ key: before.key, label: '杂念编辑', shelved: true }]);
    const { nodes } = await db.getTaskBoard();
    const rows = flattenTaskRows(nodes).map(row => ({ ...row, title: 'TODO 编辑' }));
    await db.saveTaskTree(rowsToTree(rows), nodes);
    expect(await db.getAllIdeas()).toMatchObject([{ id, text: 'TODO 编辑' }]);
    expect((await db.getTaskBoard()).order).toEqual([before.key]);
  });

  it('deletes from either view and prevents a stale editor save from recreating the pair', async () => {
    const a = await db.saveIdea(thought('愿望', 'wish'));
    const b = await db.saveIdea(thought('琐事', 'chore'));
    const c = await db.saveIdea(thought('灵感', 'idea'));
    const oldBoard = await db.getTaskBoard();
    await db.deleteIdea(a);
    await db.removeTaskLeaf(leafKey(oldBoard.nodes[1].id));
    await db.saveTaskTree(oldBoard.nodes, oldBoard.nodes);
    await initStore();
    expect(await taskLeaves()).toEqual([]);
    expect((await db.getAllIdeas()).map(i => i.id)).toEqual([c]);
    expect((await db.getTrashItems()).map(i => i.originalId).sort()).toEqual([a, b]);
  });

  it('keeps both entries through the TODO undo window and removes both at expiration', async () => {
    const id = await db.saveIdea(thought('完成它', 'wish'));
    const [task] = await taskLeaves();
    await db.toggleTaskLeaf(task.key);
    const [completed] = await taskLeaves();
    await db.clearExpiredTaskLeaves(completed.doneAt! + TASK_UNDO_MS - 1);
    expect((await db.getAllIdeas()).map(i => i.id)).toEqual([id]);
    expect((await taskLeaves())[0].done).toBe(true);
    await db.toggleTaskLeaf(task.key);
    await db.clearExpiredTaskLeaves(completed.doneAt! + TASK_UNDO_MS);
    expect((await taskLeaves())[0].done).toBe(false);
    await db.toggleTaskLeaf(task.key);
    const [finished] = await taskLeaves();
    await db.clearExpiredTaskLeaves(finished.doneAt! + TASK_UNDO_MS);
    await initStore();
    expect(await db.getAllIdeas()).toEqual([]);
    expect(await taskLeaves()).toEqual([]);
  });

  it('cleans up expired links on a Mind read when TODO is unmounted', async () => {
    await db.saveIdea(thought('仍然完成', 'chore'));
    const { nodes } = await db.getTaskBoard();
    const doneAt = Date.now() - TASK_UNDO_MS;
    await mutate(() => {
      const ordinaryTask = { ...regularTask('普通遗留'), done: true, doneAt };
      store.taskBoard[0] = { ...store.taskBoard[0], nodes: [{ ...nodes[0], done: true, doneAt }, ordinaryTask] };
    });
    expect(await db.getAllIdeas()).toEqual([]);
    expect(await taskLeaves()).toMatchObject([{ label: '普通遗留', done: true }]);
  });

  it('preserves newly linked entries and newer timer state across an older editor save', async () => {
    await db.saveIdea(thought('先有', 'wish'));
    const oldBoard = await db.getTaskBoard();
    const key = leafKey(oldBoard.nodes[0].id);
    await db.saveIdea(thought('编辑途中才有', 'chore'));
    await toggleTaskTimer(key, 1_000);
    await db.saveTaskTree(rowsToTree(flattenTaskRows(oldBoard.nodes)), oldBoard.nodes);
    await initStore();
    expect(await taskLeaves()).toMatchObject([
      { label: '先有', taskTiming: { elapsedMs: 0, startedAt: 1_000 } },
      { label: '编辑途中才有', shelved: true },
    ]);
    await toggleTaskTimer(key, 3_500);
    const backup = exportJSON();
    await _resetForTest();
    await db.saveIdea(thought('另一条数据', 'idea'));
    await importJSONIntoStore(backup);
    const [resumed] = await taskLeaves();
    expect(resumed).toMatchObject({ key, label: '先有', taskTiming: { elapsedMs: 2_500 } });
    expect(resumed.taskTiming?.startedAt).toBeUndefined();
  });
});
