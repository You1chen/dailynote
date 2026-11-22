/**
 * 任务树（taskboard）测试
 *
 * 验证：
 *   1. 标准文本结构解析（`- ` + Tab）
 *   2. 行 → 树：层级不能跳、末级识别
 *   3. 完整链 key：两个同名「实验报告」不串
 *   4. 完成状态回填：同名末级保留原状态
 *   5. 末级并列：`父-子` 标签、一级末级不带前缀
 *   6. 删除末级：父节点空壳一并清理
 *   7. 拖动排序：moveKey / normalizeOrder
 *   8. 持久化：taskboard.json、initStore 重载、旧备份兼容
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

// ---- 模拟 localStorage ----
const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = v; },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
};

// ---- IndexedDB KV 辅助 ----
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

import {
  initStore, importJSONIntoStore, _resetForTest } from '../../src/services/store';
import * as db from '../../src/db';
import type { TaskNode } from '../../src/types';
import {
  setLeafShelved,
  prevLeafState,
  chainText,
  countUndone,
  executionLeavesOf,
  leafKey,
  leafLabel,
  leavesOf,
  linesToText,
  linesToTree,
  moveKey,
  moveKeyToTargetSlot,
  normalizeOrder,
  parseTaskText,
  pruneDoneLeaves,
  removeLeaf,
  toggleLeafDone,
  treeToText,
  walkLeaves,
} from '../../src/utils/taskTree';

/** 示例标准结构（Tab 缩进） */
const SAMPLE = [
  '- 量子力学',
  '\t- 广义统计诠释',
  '- 实验',
  '\t- 近代物理学实验',
  '\t\t- ppt',
  '\t\t- 实验报告',
  '\t- 电子技术实验',
  '\t\t- 实验报告',
  '\t\t- 仿真',
].join('\n');

function sampleTree(): TaskNode[] {
  return linesToTree(parseTaskText(SAMPLE));
}

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

// ============ 解析 ============

describe('标准文本结构解析', () => {
  it('解析出 9 行，层级按 Tab 计数', () => {
    const lines = parseTaskText(SAMPLE);
    expect(lines).toHaveLength(9);
    expect(lines[0]).toEqual({ title: '量子力学', level: 0 });
    expect(lines[1]).toEqual({ title: '广义统计诠释', level: 1 });
    expect(lines[4]).toEqual({ title: 'ppt', level: 2 });
  });

  it('忽略空行与不符合结构的行', () => {
    const text = '- A\n\n随便一句\n- B\n* C';
    expect(parseTaskText(text)).toEqual([
      { title: 'A', level: 0 },
      { title: 'B', level: 0 },
    ]);
  });

  it('树 → 文本 → 树 往返一致', () => {
    const tree = sampleTree();
    const round = linesToTree(parseTaskText(treeToText(tree)));
    expect(treeToText(round)).toBe(treeToText(tree));
  });

  it('行 → 文本 保留 Tab 层级', () => {
    expect(linesToText([{ title: 'A', level: 0 }, { title: 'B', level: 2 }])).toBe('- A\n\t\t- B');
  });
});

// ============ 树结构 ============

describe('行 → 树', () => {
  it('层级不能跳：三级直接出现会被压到二级', () => {
    const tree = linesToTree([
      { title: 'A', level: 0 },
      { title: 'B', level: 5 },
    ]);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].title).toBe('B');
  });

  it('末级识别：有子节点的不是末级', () => {
    const tree = sampleTree();
    const keys: string[] = [];
    walkLeaves(tree, (_n, chain) => keys.push(leafKey(chain)));
    expect(keys).toHaveLength(5); // 9 行 - 4 个父节点
    expect(keys).toContain('实验/近代物理学实验/ppt');
    expect(keys).not.toContain('实验');
  });
});

// ============ 完整链 ============

describe('完整链与显示文案', () => {
  it('两个同名「实验报告」的 key 不同（不串状态）', () => {
    const tree = sampleTree();
    const keys: string[] = [];
    walkLeaves(tree, (_n, chain) => keys.push(leafKey(chain)));
    const reports = keys.filter(k => k.endsWith('实验报告'));
    expect(reports).toEqual([
      '实验/近代物理学实验/实验报告',
      '实验/电子技术实验/实验报告',
    ]);
  });

  it('一级末级不带前缀，二级以下显示 父-子', () => {
    expect(leafLabel(['量子力学'])).toBe('量子力学');
    expect(leafLabel(['实验', '近代物理学实验', 'ppt'])).toBe('近代物理学实验-ppt');
    expect(leafLabel(['量子力学', '广义统计诠释'])).toBe('量子力学-广义统计诠释');
  });

  it('链路文案用 - 连一级到末级', () => {
    expect(chainText(['实验', '近代物理学实验', 'ppt'])).toBe('实验-近代物理学实验-ppt');
  });
});

// ============ 完成状态 ============

describe('编辑后保留完成状态', () => {
  it('同名末级保留 done，新条目默认待办', () => {
    const first = sampleTree();
    const toggled = toggleLeafDone(first, '实验/近代物理学实验/ppt');
    expect(leavesOf(toggled).find(l => l.key === '实验/近代物理学实验/ppt')!.done).toBe(true);

    // 用户改了树：新增一行、删掉一行，原有的 ppt 还在
    const edited = parseTaskText([
      '- 量子力学',
      '\t- 广义统计诠释',
      '- 实验',
      '\t- 近代物理学实验',
      '\t\t- ppt',
      '\t- 电子技术实验',
      '\t\t- 仿真',
      '\t\t- 新加的报告',
    ].join('\n'));
    const rebuilt = linesToTree(edited, toggled);
    const leaves = leavesOf(rebuilt);
    expect(leaves.find(l => l.key === '实验/近代物理学实验/ppt')!.done).toBe(true);
    expect(leaves.find(l => l.key === '实验/电子技术实验/新加的报告')!.done).toBe(false);
    expect(leaves.find(l => l.key === '实验/电子技术实验/仿真')!.done).toBe(false);
  });

  it('删掉再重新加同名条目时，状态仍被保留（按完整链匹配）', () => {
    const first = sampleTree();
    const toggled = toggleLeafDone(first, '量子力学/广义统计诠释');
    const rebuilt = linesToTree(parseTaskText('- 量子力学\n\t- 广义统计诠释'), toggled);
    expect(leavesOf(rebuilt)[0].done).toBe(true);
  });
});

// ============ 末级列表 ============

describe('末级并列列表', () => {
  it('5 条末级，label 为 父-子（一级末级不带前缀）', () => {
    const leaves = leavesOf(sampleTree());
    expect(leaves).toHaveLength(5);
    expect(leaves.map(l => l.label)).toEqual([
      '量子力学-广义统计诠释',
      '近代物理学实验-ppt',
      '近代物理学实验-实验报告',
      '电子技术实验-实验报告',
      '电子技术实验-仿真',
    ]);
  });

  it('未结束计数', () => {
    let tree = sampleTree();
    expect(countUndone(leavesOf(tree))).toBe(5);
    tree = toggleLeafDone(tree, '实验/近代物理学实验/ppt');
    expect(countUndone(leavesOf(tree))).toBe(4);
    tree = toggleLeafDone(tree, '实验/近代物理学实验/ppt');
    expect(countUndone(leavesOf(tree))).toBe(5);
  });

  it('order 决定显示顺序，未知 key 追加到末尾', () => {
    const tree = sampleTree();
    const base = leavesOf(tree);
    const order = [base[2].key, base[0].key];
    const sorted = leavesOf(tree, order);
    expect(sorted[0].key).toBe(base[2].key);
    expect(sorted[1].key).toBe(base[0].key);
    expect(sorted[2].key).toBe(base[1].key);
  });
});

// ============ 变更 ============

describe('删除与排序', () => {
  it('删除末级后父节点空壳一并清理', () => {
    const tree = linesToTree(parseTaskText('- A\n\t- A1\n- B'));
    const after = removeLeaf(tree, 'A/A1');
    expect(after.map(n => n.title)).toEqual(['B']);
  });

  it('删除后父节点仍有其它孩子时保留父节点', () => {
    const tree = linesToTree(parseTaskText('- A\n\t- A1\n\t- A2'));
    const after = removeLeaf(tree, 'A/A1');
    expect(after[0].children.map(n => n.title)).toEqual(['A2']);
  });

  it('moveKey 把一条移到另一条之前', () => {
    const order = ['a', 'b', 'c'];
    expect(moveKey(order, 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveKey(order, 'a', 'c')).toEqual(['b', 'a', 'c']);
  });

  it('moveKeyToTargetSlot uses the original destination index in both directions', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(moveKeyToTargetSlot(order, 'a', 'b')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveKeyToTargetSlot(order, 'b', 'a')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveKeyToTargetSlot(order, 'a', 'd')).toEqual(['b', 'c', 'd', 'a']);
    expect(moveKeyToTargetSlot(order, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveKeyToTargetSlot(order, 'b', 'b')).toBe(order);
    expect(moveKeyToTargetSlot(order, 'missing', 'b')).toBe(order);
    expect(moveKeyToTargetSlot(order, 'b', 'missing')).toBe(order);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('normalizeOrder 去掉失效 key、补齐新 key', () => {
    const tree = sampleTree();
    const keys = leavesOf(tree).map(l => l.key);
    const order = normalizeOrder(tree, ['已删除的key', keys[1]]);
    expect(order).not.toContain('已删除的key');
    expect(order[0]).toBe(keys[1]);
    expect(order).toHaveLength(keys.length);
  });
});

// ============ 持久化 ============

describe('任务板持久化', () => {
  it('保存后写入 taskboard.json，initStore 重载仍在', async () => {
    await db.saveTaskBoard({ nodes: sampleTree(), order: [] });
    const keys = await kvKeys();
    expect(keys).toContain('taskboard.json');

    const count = await initStore();
    expect(count).toBe(1); // 单记录
    const board = await db.getTaskBoard();
    expect(board.id).toBe(1);
    expect(board.nodes).toHaveLength(2);
    expect(leavesOf(board.nodes)).toHaveLength(5);
  });

  it('单记录：重复保存仍是 1 条', async () => {
    await db.saveTaskBoard({ nodes: sampleTree(), order: [] });
    await db.saveTaskBoard({ nodes: linesToTree(parseTaskText('- 只有一条')), order: [] });
    const board = await db.getTaskBoard();
    expect(board.nodes).toHaveLength(1);
    expect(board.nodes[0].title).toBe('只有一条');
  });

  it('toggleTaskLeaf 持久化勾选状态', async () => {
    await db.saveTaskBoard({ nodes: sampleTree(), order: [] });
    await db.toggleTaskLeaf('实验/近代物理学实验/ppt');
    await db.toggleTaskLeaf('实验/电子技术实验/仿真');
    const board = await db.getTaskBoard();
    const doneKeys = leavesOf(board.nodes).filter(l => l.done).map(l => l.key);
    expect(doneKeys.sort()).toEqual([
      '实验/近代物理学实验/ppt',
      '实验/电子技术实验/仿真',
    ].sort());
  });

  it('removeTaskLeaf 删除并同步 order', async () => {
    const tree = sampleTree();
    const order = leavesOf(tree).map(l => l.key);
    await db.saveTaskBoard({ nodes: tree, order });
    await db.removeTaskLeaf('实验/电子技术实验/仿真');
    const board = await db.getTaskBoard();
    expect(leavesOf(board.nodes)).toHaveLength(4);
    expect(board.order).not.toContain('实验/电子技术实验/仿真');
  });

  it('migrates legacy path order and preserves slots when a node is renamed', async () => {
    const nodes = linesToTree(parseTaskText('- A\n- B\n- C'));
    const [a, b, c] = executionLeavesOf(nodes).map(l => l.key);
    await importJSONIntoStore(JSON.stringify({
      version: 1, savedAt: 0, dailyPlans: [],
      taskBoard: [{ id: 1, nodes, order: ['C', 'deleted', 'A', 'A'], updatedAt: 1 }],
    }));
    expect((await db.getTaskBoard()).order).toEqual([c, a, b]);

    await db.saveTaskTree(nodes.map(n => n.title === 'C' ? { ...n, title: 'C renamed' } : n));
    await initStore();
    const board = await db.getTaskBoard();
    expect(board.order).toEqual([c, a, b]);
    expect(executionLeavesOf(board.nodes, board.order).map(l => l.label)).toEqual(['C renamed', 'A', 'B']);
  });

  it('uses stable keys to distinguish duplicate titles and matches paths with slashes', async () => {
    const nodes = linesToTree(parseTaskText('- A/B\n- same\n- same'));
    const [path, first, second] = executionLeavesOf(nodes).map(l => l.key);
    expect(new Set([path, first, second]).size).toBe(3);
    await db.saveTaskBoard({ nodes, order: ['same', 'A/B'] });
    expect((await db.getTaskBoard()).order).toEqual([first, second, path]);
    await db.toggleTaskLeaf('A/B');
    await db.shelveTaskLeaf(second);
    await db.removeTaskLeaf(first);
    const board = await db.getTaskBoard();
    expect(board.order).toEqual([second, path]);
    expect(executionLeavesOf(board.nodes, board.order)).toMatchObject([
      { key: second, done: false, shelved: true },
      { key: path, done: true, shelved: false },
    ]);
  });

  it('persists both the reorder and overlapping metadata updates without replacing nodes', async () => {
    const nodes = linesToTree(parseTaskText('- A\n- B\n- C'));
    const [a, b, c] = executionLeavesOf(nodes).map(l => l.key);
    await db.saveTaskBoard({ nodes, order: [] });
    await Promise.all([
      db.toggleTaskLeaf(b),
      db.reorderTaskLeaves('A', 'B'),
      db.shelveTaskLeaf(c),
    ]);
    const snapshot = await db.getTaskBoard();
    await db.reorderTaskLeaves(a, 'missing');
    expect(await db.getTaskBoard()).toEqual(snapshot);
    await initStore();
    const board = await db.getTaskBoard();
    expect(board.order).toEqual([b, a, c]);
    expect(board.nodes).toMatchObject([
      { id: nodes[0].id, done: false },
      { id: nodes[1].id, done: true, doneAt: expect.any(Number) },
      { id: nodes[2].id, shelved: true },
    ]);
  });

  it('persists expired completion cleanup, keeping undoable tasks and unfinished branches', async () => {
    const now = Date.now();
    const nodes = linesToTree(parseTaskText('- Empty parent\n\t- Legacy completed\n- Mixed parent\n\t- Expired\n\t- Pending\n- Recent'));
    Object.assign(nodes[0].children[0], { done: true });
    Object.assign(nodes[1].children[0], { done: true, shelved: true, doneAt: now - 30_000 });
    Object.assign(nodes[2], { done: true, doneAt: now - 1_000 });
    await db.saveTaskBoard({ nodes, order: ['Recent', 'Mixed parent/Pending'] });
    await db.clearExpiredTaskLeaves(now);
    await initStore();
    const board = await db.getTaskBoard();
    expect(board.nodes.map(n => n.title)).toEqual(['Mixed parent', 'Recent']);
    expect(board.nodes[0].children.map(n => n.title)).toEqual(['Pending']);
    expect(executionLeavesOf(board.nodes, board.order).map(l => l.label)).toEqual(['Recent', 'Mixed parent-Pending']);
    const recent = executionLeavesOf(board.nodes, board.order)[0];
    await db.toggleTaskLeaf(recent.key);
    await db.clearExpiredTaskLeaves(now + 30_000);
    expect((await db.getTaskBoard()).nodes[1]).toMatchObject({ done: false });
  });

  it('does not resurrect expired items from an open editor when saving', async () => {
    const nodes = linesToTree(parseTaskText('- Parent\n\t- Completed'));
    Object.assign(nodes[0].children[0], { done: true, doneAt: Date.now() - 30_000 });
    await db.saveTaskTree(nodes);
    await initStore();
    expect(await db.getTaskBoard()).toMatchObject({ nodes: [], order: [] });
  });

  it('旧备份缺少 taskBoard 字段时按空数组兼容', async () => {
    const old = JSON.stringify({
      version: 1, savedAt: 0, dailyPlans: [], longTermGoals: [], reflections: [],
      harvests: [], fixedRoutines: [], taskItems: [], taskTemplates: [], trashItems: [],
      courses: [], semester: [], ddls: [], backlog: [],
    });
    await expect(importJSONIntoStore(old)).resolves.toBe(0);
    const board = await db.getTaskBoard();
    expect(board.nodes).toEqual([]);
    expect(board.order).toEqual([]);
  });
});

describe('搁置与完成时刻', () => {
  const tree = (): TaskNode[] => linesToTree(parseTaskText('- 学习\n\t- 看书\n\t- 做题\n- 生活\n\t- 买菜'));

  it('搁置只改标记，链结构不动', () => {
    const nodes = setLeafShelved(tree(), '学习/看书', true);
    expect(treeToText(nodes)).toBe(treeToText(tree()));
    const leaves = leavesOf(nodes);
    expect(leaves.find(l => l.key === '学习/看书')!.shelved).toBe(true);
    expect(leaves.find(l => l.key === '学习/做题')!.shelved).toBe(false);
  });

  it('撤销搁置后回到未搁置', () => {
    const on = setLeafShelved(tree(), '生活/买菜', true);
    const off = setLeafShelved(on, '生活/买菜', false);
    expect(leavesOf(off).find(l => l.key === '生活/买菜')!.shelved).toBe(false);
  });

  it('编辑文本后，搁置状态按完整链保留', () => {
    const on = setLeafShelved(tree(), '学习/做题', true);
    const edited = linesToTree(parseTaskText(treeToText(on)), on);
    expect(leavesOf(edited).find(l => l.key === '学习/做题')!.shelved).toBe(true);
  });

  it('完成时记录 doneAt，撤销完成时清空', () => {
    const done = toggleLeafDone(tree(), '学习/看书');
    const leaf = leavesOf(done).find(l => l.key === '学习/看书')!;
    expect(leaf.done).toBe(true);
    expect(typeof leaf.doneAt).toBe('number');

    const undone = toggleLeafDone(done, '学习/看书');
    expect(leavesOf(undone).find(l => l.key === '学习/看书')!.doneAt).toBeUndefined();
  });

  it('prevLeafState 给出旧树的附加状态', () => {
    const on = setLeafShelved(tree(), '学习/看书', true);
    const map = prevLeafState(on);
    expect(map.get('学习/看书')!.shelved).toBe(true);
    expect(map.get('生活/买菜')!.shelved).toBeFalsy();
  });
});
describe('进编辑前清理已完成', () => {
  const base = (): TaskNode[] => linesToTree(parseTaskText('- 学习\n\t- 看书\n\t- 做题\n- 生活\n\t- 买菜'));

  it('只删已完成的末级，未完成保留', () => {
    const done = toggleLeafDone(base(), '学习/看书');
    const pruned = pruneDoneLeaves(done);
    const keys = leavesOf(pruned).map(l => l.key);
    expect(keys).toEqual(['学习/做题', '生活/买菜']);
  });

  it('父节点不会留下空壳', () => {
    let nodes = toggleLeafDone(base(), '学习/看书');
    nodes = toggleLeafDone(nodes, '学习/做题');
    const pruned = pruneDoneLeaves(nodes);
    expect(pruned.map(n => n.title)).toEqual(['生活']);
  });

  it('全部完成 → 清空', () => {
    let nodes = base();
    for (const k of ['学习/看书', '学习/做题', '生活/买菜']) nodes = toggleLeafDone(nodes, k);
    expect(pruneDoneLeaves(nodes)).toEqual([]);
  });

  it('没有完成项时结构不变', () => {
    const nodes = base();
    expect(treeToText(pruneDoneLeaves(nodes))).toBe(treeToText(nodes));
  });
});