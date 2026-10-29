/**
 * 长期目标树：纯函数（不 import React、不做 IO）
 *
 * 约定：
 *   - 只有叶节点的 `completed` 直接生效；有子节点的父节点完成度由子树递归计算。
 *   - 每层节点严格等权；旧数据的 weight 字段保留，但不影响进度。
 *   - 旧数据的扁平 `tasks` 惰性投影成一级节点；只要 `nodes` 存在（哪怕是空数组），
 *     就以 `nodes` 为唯一权威，绝不再用 `tasks` 补齐，避免删掉的节点复活。
 */

import type { GoalNode, GoalTask, LongTermGoal } from '../types';
import { genId } from '../types';
import { linesToText, parseTaskText, type TaskLine } from './taskTree';

export const DEFAULT_WEIGHT = 1;

/** 遗留权重归一化，供旧数据兼容；进度不使用权重。 */
export function normalizeWeight(weight?: number): number {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : DEFAULT_WEIGHT;
}

/** 单个节点进度（0–100 浮点） */
export function nodeProgress(node: GoalNode): number {
  if (node.children.length === 0) return node.completed ? 100 : 0;

  return node.children.reduce((sum, child) => sum + nodeProgress(child), 0) / node.children.length;
}

/** 整棵树的进度；空树返回 null（UI 显示「尚未拆解」，不是 0%） */
export function treeProgress(nodes: GoalNode[]): number | null {
  if (nodes.length === 0) return null;

  return nodes.reduce((sum, node) => sum + nodeProgress(node), 0) / nodes.length;
}

/**
 * 进度 → 显示数值：保留最多三位小数，且未完成不能显示成 100%。
 * 例如 1/24 → 4.167%，99.9999% → 99.999%。
 */
export function percentLabel(progress: number | null): number | null {
  if (progress === null) return null;
  const clamped = Math.max(0, Math.min(100, progress));
  const rounded = Math.round(clamped * 1000) / 1000;
  if (rounded >= 100 && clamped < 100) return 99.999;
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

// ============ 标准文本与目标树 ============

/** 树的先序行；标题和缩进与 taskTree 的 TaskLine 一致。 */
export function goalNodesToLines(nodes: GoalNode[]): TaskLine[] {
  const lines: TaskLine[] = [];
  const walk = (siblings: GoalNode[], level: number) => {
    for (const node of siblings) {
      lines.push({ title: node.title, level });
      walk(node.children, level + 1);
    }
  };
  walk(nodes, 0);
  return lines;
}

export function goalNodesToText(nodes: GoalNode[]): string {
  return linesToText(goalNodesToLines(nodes));
}

/** 校验 Tab 或一致的两/四空格 Markdown 缩进，再复用 taskTree 的解析语义。 */
export function parseGoalText(text: string): { lines: TaskLine[]; error?: string } {
  let previousLevel = -1;
  let spaceWidth: 2 | 4 | undefined;
  let usedTabs = false;
  const normalized: string[] = [];
  const rows = (text ?? '').split(/\r?\n/);
  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    if (!raw.trim()) continue;
    const match = /^([\t ]*)- (.+)$/.exec(raw);
    if (!match || !match[2].trim()) {
      return { lines: [], error: `第 ${index + 1} 行格式无效：请使用 Tab 或一致的空格缩进和「- 标题」` };
    }
    const indent = match[1];
    if (indent.includes('\t') && indent.includes(' ')) {
      return { lines: [], error: `第 ${index + 1} 行缩进无效：不能混用 Tab 和空格` };
    }
    let level = indent.length;
    if (indent.includes(' ')) {
      if (usedTabs) {
        return { lines: [], error: `第 ${index + 1} 行缩进无效：不能混用 Tab 和空格` };
      }
      if (spaceWidth === undefined) {
        if (indent.length !== 2 && indent.length !== 4) {
          return { lines: [], error: `第 ${index + 1} 行缩进无效：首次空格缩进须为两或四空格` };
        }
        spaceWidth = indent.length;
      }
      if (indent.length % spaceWidth !== 0) {
        return { lines: [], error: `第 ${index + 1} 行缩进无效：请保持每层 ${spaceWidth} 个空格` };
      }
      level = indent.length / spaceWidth;
    } else if (indent.includes('\t')) {
      if (spaceWidth !== undefined) {
        return { lines: [], error: `第 ${index + 1} 行缩进无效：不能混用 Tab 和空格` };
      }
      usedTabs = true;
    }
    if (level > previousLevel + 1) {
      return { lines: [], error: `第 ${index + 1} 行层级跳跃：最多只能比上一行多缩进一层` };
    }
    previousLevel = level;
    normalized.push(`${'\t'.repeat(level)}- ${match[2]}`);
  }
  return { lines: parseTaskText(normalized.join('\n')) };
}

/** 完整路径优先；仅在同父节点下将剩余同位置节点视为改名。 */
export function goalLinesToNodes(lines: TaskLine[], prev: GoalNode[] = []): GoalNode[] {
  interface Draft { title: string; children: Draft[]; previous?: GoalNode }
  const root: Draft[] = [];
  const stack: Draft[] = [];
  for (const [index, line] of lines.entries()) {
    if (!Number.isInteger(line.level) || line.level < 0 || line.level > stack.length || !line.title.trim()) {
      throw new Error(`第 ${index + 1} 行层级或标题无效`);
    }
    stack.length = line.level;
    const draft: Draft = { title: line.title.trim(), children: [] };
    if (line.level === 0) root.push(draft);
    else stack[line.level - 1].children.push(draft);
    stack.push(draft);
  }

  const oldByPath = new Map<string, GoalNode[]>();
  const newTitles = new Set<string>();
  const collectOld = (siblings: GoalNode[], chain: string[]) => {
    for (const node of siblings) {
      const path = [...chain, node.title];
      const key = JSON.stringify(path);
      const matches = oldByPath.get(key) ?? [];
      matches.push(node);
      oldByPath.set(key, matches);
      collectOld(node.children, path);
    }
  };
  collectOld(prev, []);
  const collectTitles = (siblings: Draft[]) => {
    for (const draft of siblings) {
      newTitles.add(draft.title);
      collectTitles(draft.children);
    }
  };
  collectTitles(root);

  const used = new Set<GoalNode>();
  // Reserve every exact path before falling back, so an early rename cannot steal a later exact match.
  const reserveExact = (siblings: Draft[], chain: string[]) => {
    for (const draft of siblings) {
      const path = [...chain, draft.title];
      const match = oldByPath.get(JSON.stringify(path))?.find(node => !used.has(node));
      if (match) { draft.previous = match; used.add(match); }
      reserveExact(draft.children, path);
    }
  };
  reserveExact(root, []);

  const reconcile = (siblings: Draft[], oldSiblings: GoalNode[]): GoalNode[] => {
    // Under a renamed parent, original child titles remain reliable even though full paths changed.
    for (const draft of siblings) {
      if (draft.previous) continue;
      const match = oldSiblings.find(node => !used.has(node) && node.title === draft.title);
      if (match) { draft.previous = match; used.add(match); }
    }
    return siblings.map((draft, index) => {
      if (!draft.previous) {
        const candidate = oldSiblings[index];
        if (candidate && !used.has(candidate) && !newTitles.has(candidate.title)) {
          draft.previous = candidate;
          used.add(candidate);
        }
      }
      const previous = draft.previous;
      const children = reconcile(draft.children, previous?.children ?? []);
      return previous
        ? { ...previous, title: draft.title, children }
        : { id: genId(), title: draft.title, completed: false, children, createdAt: Date.now() };
    });
  };
  return reconcile(root, prev);
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
