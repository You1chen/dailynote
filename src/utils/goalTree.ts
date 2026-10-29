/**
 * 长期目标树：纯函数（不 import React、不做 IO）
 *
 * 约定：
 *   - 只有叶节点的 `completed` 直接生效；有子节点的父节点完成度由子树递归计算。
 *   - 同级节点权重默认 1，非法权重（非有限、≤0）在计算时按 1 处理。
 *   - 旧数据的扁平 `tasks` 惰性投影成一级节点；只要 `nodes` 存在（哪怕是空数组），
 *     就以 `nodes` 为唯一权威，绝不再用 `tasks` 补齐，避免删掉的节点复活。
 */

import type { GoalNode, GoalTask, LongTermGoal } from '../types';
import { genId } from '../types';

export const DEFAULT_WEIGHT = 1;

/** 权重归一化：只用于计算；非有限正数一律按默认权重 */
export function normalizeWeight(weight?: number): number {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : DEFAULT_WEIGHT;
}

/** 单个节点进度（0–100 浮点） */
export function nodeProgress(node: GoalNode): number {
  if (node.children.length === 0) return node.completed ? 100 : 0;

  let sum = 0;
  let total = 0;
  for (const child of node.children) {
    const weight = normalizeWeight(child.weight);
    sum += nodeProgress(child) * weight;
    total += weight;
  }
  return total > 0 ? sum / total : 0;
}

/** 整棵树的进度；空树返回 null（UI 显示「尚未拆解」，不是 0%） */
export function treeProgress(nodes: GoalNode[]): number | null {
  if (nodes.length === 0) return null;

  let sum = 0;
  let total = 0;
  for (const node of nodes) {
    const weight = normalizeWeight(node.weight);
    sum += nodeProgress(node) * weight;
    total += weight;
  }
  return total > 0 ? sum / total : 0;
}

/**
 * 进度 → 显示整数：四舍五入，但未完成的进度不能显示成 100%。
 * 例如 99.6% → 99%，避免看起来已经完成。
 */
export function percentLabel(progress: number | null): number | null {
  if (progress === null) return null;
  const clamped = Math.max(0, Math.min(100, progress));
  const rounded = Math.round(clamped);
  if (rounded >= 100 && clamped < 100) return 99;
  return rounded;
}

/** 叶节点统计：总项数 / 已勾选数 */
export function treeStats(nodes: GoalNode[]): { total: number; done: number } {
  let total = 0;
  let done = 0;
  const walk = (list: GoalNode[]) => {
    for (const node of list) {
      if (node.children.length === 0) {
        total += 1;
        if (node.completed) done += 1;
      } else {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return { total, done };
}

/** 旧扁平任务 → 一级节点（保留 id / 标题 / 完成状态 / 创建时间） */
export function tasksToNodes(tasks: GoalTask[]): GoalNode[] {
  return (tasks ?? []).map(task => ({
    id: task.id,
    title: task.title,
    completed: !!task.completed,
    children: [],
    createdAt: task.createdAt,
  }));
}

/**
 * 取得目标的有效树。
 * - 大愿望不使用树，返回空数组（里程碑仍走 `tasks`）。
 * - `nodes` 存在即权威，包括空数组。
 * - 只有旧目标（`nodes === undefined`）才用 `tasks` 投影。
 */
export function effectiveNodes(goal: LongTermGoal): GoalNode[] {
  if (goal.kind === 'wish') return [];
  if (goal.nodes !== undefined) return goal.nodes;
  return tasksToNodes(goal.tasks);
}

// ============ 树内定位与不可变修改 ============

function cloneNodes(nodes: GoalNode[]): GoalNode[] {
  return nodes.map(node => ({ ...node, children: cloneNodes(node.children) }));
}

interface Located {
  siblings: GoalNode[];
  index: number;
  node: GoalNode;
  parent: GoalNode | null;
}

function locate(nodes: GoalNode[], id: string, parent: GoalNode | null = null): Located | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.id === id) return { siblings: nodes, index: i, node, parent };
    if (node.children.length > 0) {
      const hit = locate(node.children, id, node);
      if (hit) return hit;
    }
  }
  return null;
}

/** 按 id 查找节点（返回原引用，只读用途） */
export function findNode(nodes: GoalNode[], id: string): GoalNode | null {
  return locate(nodes, id)?.node ?? null;
}

/** 追加节点；`parentId=null` 表示加到根层 */
export function addNode(nodes: GoalNode[], parentId: string | null, title: string): GoalNode[] {
  const text = title.trim();
  if (!text) return nodes;

  const next = cloneNodes(nodes);
  const node: GoalNode = {
    id: genId(),
    title: text,
    completed: false,
    children: [],
    createdAt: Date.now(),
  };

  if (parentId === null) {
    next.push(node);
    return next;
  }

  const parent = findNode(next, parentId);
  if (!parent) return nodes;

  // 给已完成的叶节点加子项：父节点回到未完成，进度交给子树计算
  if (parent.children.length === 0 && parent.completed) parent.completed = false;
  parent.children.push(node);
  return next;
}

/** 改标题；空白标题不生效 */
export function updateNodeTitle(nodes: GoalNode[], id: string, title: string): GoalNode[] {
  const text = title.trim();
  if (!text) return nodes;

  const next = cloneNodes(nodes);
  const hit = locate(next, id);
  if (!hit) return nodes;
  hit.node.title = text;
  return next;
}

/** 设置/清除权重；`undefined` 表示恢复默认 */
export function setNodeWeight(nodes: GoalNode[], id: string, weight: number | undefined): GoalNode[] {
  const next = cloneNodes(nodes);
  const hit = locate(next, id);
  if (!hit) return nodes;
  if (weight === undefined) delete hit.node.weight;
  else hit.node.weight = weight;
  return next;
}

/** 勾选/取消叶节点；父节点由子树决定，不直接翻转 */
export function toggleNode(nodes: GoalNode[], id: string): GoalNode[] {
  const next = cloneNodes(nodes);
  const hit = locate(next, id);
  if (!hit || hit.node.children.length > 0) return nodes;
  hit.node.completed = !hit.node.completed;
  return next;
}

/** 删除节点（含整棵子树）；父节点失去全部子项后回到未完成叶节点 */
export function removeNode(nodes: GoalNode[], id: string): GoalNode[] {
  const next = cloneNodes(nodes);
  const hit = locate(next, id);
  if (!hit) return nodes;

  hit.siblings.splice(hit.index, 1);
  if (hit.parent && hit.parent.children.length === 0) hit.parent.completed = false;
  return next;
}

/** 缩进：成为前一个同级节点的最后一个子节点；已是首个同级则不动 */
export function indentNode(nodes: GoalNode[], id: string): GoalNode[] {
  const next = cloneNodes(nodes);
  const hit = locate(next, id);
  if (!hit || hit.index === 0) return nodes;

  const [node] = hit.siblings.splice(hit.index, 1);
  const prev = hit.siblings[hit.index - 1];
  prev.children.push(node);
  prev.completed = false;
  return next;
}

/** 缩退：成为父节点的后一个兄弟；已在根层则不动 */
export function outdentNode(nodes: GoalNode[], id: string): GoalNode[] {
  const next = cloneNodes(nodes);
  const hit = locate(next, id);
  if (!hit || !hit.parent) return nodes;

  const parent = hit.parent;
  const [node] = hit.siblings.splice(hit.index, 1);

  const parentHit = locate(next, parent.id);
  if (!parentHit) return nodes;
  parentHit.siblings.splice(parentHit.index + 1, 0, node);

  if (parent.children.length === 0) parent.completed = false;
  return next;
}

/** 该节点是否还能缩进（不是同级第一个） */
export function canIndent(nodes: GoalNode[], id: string): boolean {
  const hit = locate(nodes, id);
  return !!hit && hit.index > 0;
}

/** 该节点是否还能缩退（不在根层） */
export function canOutdent(nodes: GoalNode[], id: string): boolean {
  return !!locate(nodes, id)?.parent;
}
