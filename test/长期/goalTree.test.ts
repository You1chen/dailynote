/**
 * 长期目标树：递归进度与树编辑纯函数
 *
 * 重点验证：
 *   - 父子递归等权，不是把全部叶节点平铺平均
 *   - 空树与 0% 区分
 *   - 旧扁平 tasks 惰性投影，nodes: [] 为唯一权威
 *   - 改名 / 缩进 / 缩退 / 勾选不丢节点 ID 与完成状态
 *   - 已完成叶节点加子项、删掉最后一个子项的行为
 */

import { describe, it, expect } from 'vitest';
import type { GoalNode, LongTermGoal } from '../../src/types';
import {
  addNode, canIndent, canOutdent, effectiveNodes, findNode, goalLinesToNodes,
  goalNodesToLines, goalNodesToText, indentNode, nodeProgress, normalizeWeight,
  outdentNode, parseGoalText, percentLabel, removeNode, setNodeWeight, tasksToNodes,
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

  it('遗留权重不影响根节点或子节点的等权进度', () => {
    const tree = [
      node('a', 'A', {
        weight: 5,
        children: [node('a1', 'A1', { completed: true, weight: 100 }), node('a2', 'A2')],
      }),
      node('b', 'B', { completed: true, weight: 3 }),
    ];
    expect(nodeProgress(tree[0])).toBe(50);
    expect(treeProgress(tree)).toBe(75);
  });

  it('空树返回 null；有节点但未完成返回 0', () => {
    expect(treeProgress([])).toBeNull();
    expect(treeProgress([node('a', 'A')])).toBe(0);
  });

  it('显示百分比保留三位小数，但不把未完成显示成 100%', () => {
    expect(percentLabel(null)).toBeNull();
    expect(percentLabel(100 / 24)).toBe(4.167);
    expect(percentLabel(33.45678)).toBe(33.457);
    expect(percentLabel(99.9999)).toBe(99.999);
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

});

describe('标准文本互转', () => {
  it('西湖示例：24 个叶项完成 1 项时进度可显示为 4.167%', () => {
    const text = ['- 游览西湖', ...Array.from({ length: 24 }, (_, index) => `\t- 景点 ${index + 1}`)].join('\n');
    const parsed = parseGoalText(text);
    expect(parsed.error).toBeUndefined();
    const tree = goalLinesToNodes(parsed.lines);
    expect(goalNodesToText(tree)).toBe(text);
    expect(goalNodesToLines(tree)).toEqual(parsed.lines);
    expect(treeStats(tree)).toEqual({ total: 24, done: 0 });
    expect(percentLabel(treeProgress(toggleNode(tree, tree[0].children[0].id)))).toBe(4.167);
  });

  it('西湖三分支：牙刷完成后行李 12.5%、根 4.167%，不是平铺平均', () => {
    const luggage = [node('toothbrush', '牙刷', { completed: true }), ...Array.from({ length: 7 }, (_, i) => node(`item${i}`, `物品${i}`))];
    const tree = [node('west-lake', '西湖', { children: [
      node('luggage', '行李', { children: luggage }),
      node('travel', '出行', { children: [node('ticket', '车票', { children: [node('train', '火车'), node('bus', '汽车')] }), node('rent', '租房')] }),
      node('plan', '计划', { children: [node('day1', '第一天'), node('day2', '第二天')] }),
    ] })];
    expect(nodeProgress(tree[0].children[0])).toBe(12.5);
    expect(treeProgress(tree)).toBeCloseTo(100 / 24);
    expect(percentLabel(treeProgress(tree))).toBe(4.167);
  });

  it('两空格及四空格 Markdown 均可导入，导出仍规范为 Tab', () => {
    const expected = '- 西湖\n\t- 行李\n\t\t- 牙刷\n\t- 出行';
    for (const width of [2, 4]) {
      const input = `- 西湖\n${' '.repeat(width)}- 行李\n${' '.repeat(width * 2)}- 牙刷\n${' '.repeat(width)}- 出行`;
      const parsed = parseGoalText(input);
      expect(parsed.error).toBeUndefined();
      expect(goalNodesToText(goalLinesToNodes(parsed.lines))).toBe(expected);
    }
    expect(parseGoalText('- 西湖\n  - 行李\n    - 牙刷').lines.map(row => row.level)).toEqual([0, 1, 2]);
    expect(parseGoalText('- 西湖\n    - 行李\n        - 牙刷').lines.map(row => row.level)).toEqual([0, 1, 2]);
    expect(parseGoalText('- 西湖\n  - 行李\n    - 子项\n      - 后续').lines.map(row => row.level)).toEqual([0, 1, 2, 3]);
  });

  it('无效行与层级跳跃报告行号，不默默丢失；直接转换行同样拒绝跳跃', () => {
    expect(parseGoalText('- 正常\n错误行')).toMatchObject({ lines: [], error: expect.stringContaining('第 2 行') });
    expect(parseGoalText('- 正常\n   - 不完整缩进')).toMatchObject({ lines: [], error: expect.stringContaining('第 2 行') });
    expect(parseGoalText('- 正常\n  - 子项\n\t- 混用')).toMatchObject({ lines: [], error: expect.stringContaining('第 3 行') });
    expect(parseGoalText('- 正常\n\t\t- 跳跃')).toMatchObject({ lines: [], error: expect.stringContaining('第 2 行层级跳跃') });
    expect(parseGoalText('\t- 首行缩进')).toMatchObject({ lines: [], error: expect.stringContaining('第 1 行层级跳跃') });
    expect(parseGoalText('- 正常\n- ')).toMatchObject({ lines: [], error: expect.stringContaining('第 2 行') });
    expect(() => goalLinesToNodes([{ title: '根', level: 1 }])).toThrow('第 1 行');
  });

  it('同路径重复标题按出现序号保留独立状态，其他路径同名不串状态', () => {
    const prev = [
      node('a', '区域', { children: [
        node('a1', '重复', { completed: true, createdAt: 11, weight: 2 }),
        node('a2', '重复', { completed: false, createdAt: 22, weight: 3 }),
      ] }),
      node('b', '其他区域', { children: [node('b1', '重复', { completed: true, createdAt: 33 })] }),
    ];
    const text = '- 区域\n\t- 重复\n\t- 重复\n- 其他区域\n\t- 重复';
    const edited = goalLinesToNodes(parseGoalText(text).lines, prev);
    expect(edited[0].children.map(({ id, completed, createdAt, weight }) => ({ id, completed, createdAt, weight }))).toEqual([
      { id: 'a1', completed: true, createdAt: 11, weight: 2 },
      { id: 'a2', completed: false, createdAt: 22, weight: 3 },
    ]);
    expect(edited[1].children[0].id).toBe('b1');
    expect(edited[1].children[0].completed).toBe(true);
  });

  it('重命名已完成叶节点和父节点后保留整条分支的状态与元数据', () => {
    const prev = [node('parent', '旧父', { completed: true, createdAt: 1, weight: 5, children: [
      node('leaf', '旧叶', { completed: true, createdAt: 2, weight: 7 }),
      node('other', '其他', { completed: false, createdAt: 3 }),
    ] })];
    const leafRename = goalLinesToNodes(parseGoalText('- 旧父\n\t- 新叶\n\t- 其他').lines, prev);
    expect(leafRename[0].children[0]).toMatchObject({ id: 'leaf', title: '新叶', completed: true, createdAt: 2, weight: 7 });
    const parentRename = goalLinesToNodes(parseGoalText('- 新父\n\t- 旧叶\n\t- 其他').lines, prev);
    expect(parentRename[0]).toMatchObject({ id: 'parent', title: '新父', completed: true, createdAt: 1, weight: 5 });
    expect(parentRename[0].children.map(child => child.id)).toEqual(['leaf', 'other']);
    expect(parentRename[0].children[0].completed).toBe(true);
    const both = goalLinesToNodes(parseGoalText('- 新父\n\t- 新叶\n\t- 其他').lines, prev);
    expect(both[0].id).toBe('parent');
    expect(both[0].children[0].id).toBe('leaf');
    expect(both[0].children[0].completed).toBe(true);
  });

  it('兄弟重排优先按完整路径，插入行不可窃取后续精确命中', () => {
    const prev = [node('a', '甲', { completed: true }), node('b', '乙', { completed: false }), node('c', '丙', { completed: true })];
    const reordered = goalLinesToNodes(parseGoalText('- 丙\n- 甲\n- 乙').lines, prev);
    expect(reordered.map(item => item.id)).toEqual(['c', 'a', 'b']);
    const inserted = goalLinesToNodes(parseGoalText('- 新增\n- 甲\n- 乙\n- 丙').lines, prev);
    expect(inserted[0].id).not.toBe('a');
    expect(inserted.slice(1).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('文本编辑移动、插入、删除时仅匹配完整路径，完成节点不被清理', () => {
    const prev = [
      node('root', '根', { completed: true, createdAt: 1, weight: 7, children: [
        node('done', '完成', { completed: true, createdAt: 2, weight: 5 }),
        node('pending', '待办', { completed: false, createdAt: 3 }),
      ] }),
    ];
    const edited = goalLinesToNodes(parseGoalText('- 根\n\t- 完成\n\t- 新项\n- 待办').lines, prev);
    expect(edited[0]).toMatchObject({ id: 'root', completed: true, createdAt: 1, weight: 7 });
    expect(edited[0].children[0]).toMatchObject({ id: 'done', completed: true, createdAt: 2, weight: 5 });
    expect(edited[0].children[1]).toMatchObject({ completed: false, title: '新项' });
    expect(edited[0].children[1].id).not.toBe('pending');
    expect(edited[1].id).not.toBe('pending');
    expect(prev[0].children.map(child => child.id)).toEqual(['done', 'pending']);
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
