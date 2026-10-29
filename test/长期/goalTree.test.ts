/**
 * 长期目标树：递归进度与树编辑纯函数
 *
 * 重点验证：
 *   - 父子递归加权，不是把全部叶节点平铺平均
 *   - 空树与 0% 区分
 *   - 旧扁平 tasks 惰性投影，nodes: [] 为唯一权威
 *   - 改名 / 缩进 / 缩退 / 勾选不丢节点 ID 与完成状态
 *   - 已完成叶节点加子项、删掉最后一个子项的行为
 */

import { describe, it, expect } from 'vitest';
import type { GoalNode, LongTermGoal } from '../../src/types';
import {
  addNode, canIndent, canOutdent, effectiveNodes, findNode, indentNode, nodeProgress,
  normalizeWeight, outdentNode, percentLabel, removeNode, setNodeWeight, tasksToNodes,
  toggleNode, treeProgress, treeStats, updateNodeTitle,
} from '../../src/utils/goalTree';

const node = (id: string, title: string, over: Partial<GoalNode> = {}): GoalNode => ({
  id,
  title,
  completed: false,
  children: [],
  ...over,
});

const goal = (over: Partial<LongTermGoal> = {}): LongTermGoal => ({
  title: '目标',
  description: '',
  category: '学业',
  tasks: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('weight / progress', () => {
  it('默认权重按 1 计算，非法权重也按 1 处理', () => {
    expect(normalizeWeight(undefined)).toBe(1);
    expect(normalizeWeight(0)).toBe(1);
    expect(normalizeWeight(-3)).toBe(1);
    expect(normalizeWeight(Number.NaN)).toBe(1);
    expect(normalizeWeight(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeWeight(2.5)).toBe(2.5);
  });

  it('叶节点只有完成 / 未完成两种进度', () => {
    expect(nodeProgress(node('a', 'A'))).toBe(0);
    expect(nodeProgress(node('a', 'A', { completed: true }))).toBe(100);
  });

  it('三层递归：父节点先算子节点，再逐层向上汇总', () => {
    const tree = [
      node('a', 'A', {
        children: [
          node('a1', 'A1', { completed: true }),
          node('a2', 'A2', {
            children: [
              node('a2a', 'A2a', { completed: true }),
              node('a2b', 'A2b'),
            ],
          }),
        ],
      }),
    ];
    // A2 = 50，A = (100 + 50) / 2 = 75
    expect(nodeProgress(tree[0])).toBe(75);
    expect(treeProgress(tree)).toBe(75);
  });

  it('不对称树按层级加权：根 A 完成 + 根 B 三个未完成子项 = 50%，不是 25%', () => {
    const tree = [
      node('a', 'A', { completed: true }),
      node('b', 'B', {
        children: [node('b1', 'B1'), node('b2', 'B2'), node('b3', 'B3')],
      }),
    ];
    expect(treeProgress(tree)).toBe(50);
  });

  it('同级权重改变结果', () => {
    const tree = [
      node('a', 'A', { completed: true }),
      node('b', 'B', { weight: 3 }),
    ];
    // (100*1 + 0*3) / 4 = 25
    expect(treeProgress(tree)).toBe(25);
  });

  it('父节点的权重只影响上一级，不改变自身子树的百分比', () => {
    const tree = [
      node('a', 'A', {
        weight: 5,
        children: [node('a1', 'A1', { completed: true }), node('a2', 'A2')],
      }),
      node('b', 'B', { completed: true }),
    ];
    expect(nodeProgress(tree[0])).toBe(50);
    // (50*5 + 100*1) / 6
    expect(treeProgress(tree)).toBeCloseTo(58.33, 2);
  });

  it('空树返回 null；有节点但未完成返回 0', () => {
    expect(treeProgress([])).toBeNull();
    expect(treeProgress([node('a', 'A')])).toBe(0);
  });

  it('显示百分比四舍五入，但不把未完成显示成 100%', () => {
    expect(percentLabel(null)).toBeNull();
    expect(percentLabel(33.4)).toBe(33);
    expect(percentLabel(99.6)).toBe(99);
    expect(percentLabel(100)).toBe(100);
    expect(percentLabel(0)).toBe(0);
    expect(percentLabel(120)).toBe(100);
  });

  it('统计只数叶节点', () => {
    const tree = [
      node('a', 'A', {
        completed: true,
        children: [node('a1', 'A1', { completed: true }), node('a2', 'A2')],
      }),
      node('b', 'B', { completed: true }),
    ];
    expect(treeStats(tree)).toEqual({ total: 3, done: 2 });
  });
});

describe('旧数据投影', () => {
  it('扁平 tasks 逐项变成一级节点，保留 id / 标题 / 完成状态 / 创建时间', () => {
    const tasks = [
      { id: 't1', title: '第一步', completed: true, createdAt: 11 },
      { id: 't2', title: '第二步', completed: false, createdAt: 22 },
    ];
    expect(tasksToNodes(tasks)).toEqual([
      { id: 't1', title: '第一步', completed: true, children: [], createdAt: 11 },
      { id: 't2', title: '第二步', completed: false, children: [], createdAt: 22 },
    ]);
  });

  it('nodes 缺省时用 tasks；nodes 为空数组时不再回填，避免删掉的节点复活', () => {
    const legacy = goal({ tasks: [{ id: 't1', title: '旧任务', completed: true, createdAt: 1 }] });
    expect(effectiveNodes(legacy).map(n => n.title)).toEqual(['旧任务']);

    const cleared = goal({ tasks: legacy.tasks, nodes: [] });
    expect(effectiveNodes(cleared)).toEqual([]);

    const emptied = goal({ tasks: legacy.tasks, nodes: [{ id: 'n1', title: '新节点', completed: false, children: [] }] });
    expect(effectiveNodes(emptied).map(n => n.id)).toEqual(['n1']);
  });

  it('大愿望不使用树，里程碑继续留在 tasks', () => {
    const wish = goal({ kind: 'wish', tasks: [{ id: 'm1', title: '里程碑', completed: true, createdAt: 1 }] });
    expect(effectiveNodes(wish)).toEqual([]);
  });
});

describe('树编辑', () => {
  it('添加根节点与子节点', () => {
    let tree = addNode([], null, '根');
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toEqual([]);

    const rootId = tree[0].id;
    tree = addNode(tree, rootId, '子');
    expect(tree[0].children.map(n => n.title)).toEqual(['子']);
  });

  it('给已完成的叶节点加子项：父节点回到未完成，进度交给子树', () => {
    let tree = addNode([], null, '父');
    tree = toggleNode(tree, tree[0].id);
    expect(tree[0].completed).toBe(true);

    tree = addNode(tree, tree[0].id, '子');
    expect(tree[0].completed).toBe(false);
    expect(treeProgress(tree)).toBe(0);
  });

  it('删除最后一个子项后，父节点成为未完成叶节点', () => {
    let tree = addNode([], null, '父');
    const parentId = tree[0].id;
    tree = addNode(tree, parentId, '子');
    const childId = tree[0].children[0].id;

    tree = removeNode(tree, childId);
    expect(tree[0].children).toEqual([]);
    expect(tree[0].completed).toBe(false);
    expect(treeProgress(tree)).toBe(0);
  });

  it('删除非叶节点会带走整棵子树', () => {
    let tree = addNode([], null, '父');
    const parentId = tree[0].id;
    tree = addNode(tree, parentId, '子');
    const childId = tree[0].children[0].id;
    tree = addNode(tree, childId, '孙');
    expect(tree[0].children[0].children).toHaveLength(1);

    tree = removeNode(tree, childId);
    expect(tree[0].children).toEqual([]);
  });

  it('改名、缩进、缩退、改权重都保留节点 ID 和完成状态', () => {
    let tree = addNode([], null, 'A');
    tree = addNode(tree, null, 'B');
    tree = toggleNode(tree, tree[0].id);
    const aId = tree[0].id;
    const bId = tree[1].id;

    tree = updateNodeTitle(tree, aId, 'A 改名');
    expect(findNode(tree, aId)!.title).toBe('A 改名');
    expect(findNode(tree, aId)!.completed).toBe(true);

    tree = indentNode(tree, bId);
    expect(tree).toHaveLength(1);
    expect(findNode(tree, bId)).toBeTruthy();
    expect(findNode(tree, aId)!.children.map(n => n.id)).toEqual([bId]);

    tree = outdentNode(tree, bId);
    expect(tree).toHaveLength(2);
    expect(tree.map(n => n.id)).toEqual([aId, bId]);

    tree = setNodeWeight(tree, bId, 3);
    expect(findNode(tree, bId)!.weight).toBe(3);
    tree = setNodeWeight(tree, bId, undefined);
    expect(findNode(tree, bId)!.weight).toBeUndefined();
  });

  it('缩进只作用于同一层的兄弟：首个节点不能再缩进', () => {
    let tree = addNode([], null, 'A');
    const aId = tree[0].id;
    expect(canIndent(tree, aId)).toBe(false);
    expect(outdentNode(tree, aId)).toEqual(tree);

    tree = addNode(tree, null, 'B');
    expect(canIndent(tree, tree[1].id)).toBe(true);
    expect(canOutdent(tree, tree[1].id)).toBe(false);
  });

  it('父节点不能直接勾选完成，只有叶节点能被翻转', () => {
    let tree = addNode([], null, '父');
    const parentId = tree[0].id;
    tree = addNode(tree, parentId, '子');
    expect(toggleNode(tree, parentId)).toEqual(tree);

    const childId = tree[0].children[0].id;
    tree = toggleNode(tree, childId);
    expect(tree[0].children[0].completed).toBe(true);
    expect(treeProgress(tree)).toBe(100);
  });

  it('空白标题不生效', () => {
    let tree = addNode([], null, 'A');
    tree = addNode(tree, null, '   ');
    expect(tree).toHaveLength(1);
    expect(updateNodeTitle(tree, tree[0].id, '  ')).toBe(tree);
  });
});
