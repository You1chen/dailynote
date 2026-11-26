/**
 * 任务树（taskboard）纯函数：文本结构 ⇄ 层级 ⇄ 末级并列
 *
 * 约定：
 *   - 标准文本结构：每行以 `- ` 开头，Tab 递进一层（只认这种）
 *   - 执行清单以节点 ID 为 key；旧版标题链（"实验/近代物理学实验/实验报告"）仍可读取
 *   - 列表显示只取末级：`父-子`；一级节点本身是末级时不带前缀
 */

import type { TaskLeaf, TaskNode } from '../types';
import { genId } from '../types';
import { elapsedTaskMs } from './taskTiming';

export interface TaskLine {
  title: string;
  level: number;
}

/** 插入一行空白任务，紧跟在指定行之后，并继承该行缩进。 */
export function insertTaskLineAfter(lines: TaskLine[], index: number, title = ''): TaskLine[] {
  if (index < 0 || index >= lines.length) return [...lines];
  const current = lines[index];
  return [...lines.slice(0, index + 1), { title, level: current.level }, ...lines.slice(index + 1)];
}

/** 序列化/保存前丢弃编辑器中尚未填写的空白行。 */
export function withoutBlankTaskLines(lines: TaskLine[]): TaskLine[] {
  return lines.filter(line => line.title.trim().length > 0);
}

/** 完整链 → key */
export function leafKey(chain: string[]): string {
  return chain.join('/');
}

/** 列表显示文案：父-子；一级末级则只有自己 */
export function leafLabel(chain: string[]): string {
  if (chain.length <= 1) return chain[0] ?? '';
  return `${chain[chain.length - 2]}-${chain[chain.length - 1]}`;
}

/** 完整链 → 弹窗文案：一级到末级用 `-` 连起来 */
export function chainText(chain: string[]): string {
  return chain.join('-');
}

// ============ 文本 ⇄ 行 ============

/** 解析标准文本结构：`- 标题` + Tab 缩进。不符合结构的行忽略 */
export function parseTaskText(text: string): TaskLine[] {
  const out: TaskLine[] = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(\t*)\s*-\s*(.+)$/);
    if (!m) continue;
    const title = m[2].trim();
    if (!title) continue;
    out.push({ title, level: m[1].length });
  }
  return out;
}

/** 行 → 文本（层级模式切到文本模式时用） */
export function linesToText(lines: TaskLine[]): string {
  return lines
    .map(l => `${'\t'.repeat(Math.max(0, l.level))}- ${l.title}`)
    .join('\n');
}

/** 树 → 行 */
export function treeToLines(nodes: TaskNode[]): TaskLine[] {
  const out: TaskLine[] = [];
  const walk = (list: TaskNode[], level: number) => {
    for (const n of list) {
      out.push({ title: n.title, level });
      if (n.children.length) walk(n.children, level + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

/** 树 → 文本 */
export function treeToText(nodes: TaskNode[]): string {
  return linesToText(treeToLines(nodes));
}

// ============ 行 → 树（带完成状态回填） ============

/** 收集上一棵树里所有末级的完成状态：完整链 → done */
export function prevDoneMap(nodes: TaskNode[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  walkLeaves(nodes, (node, chain) => {
    map.set(leafKey(chain), node.done);
  });
  return map;
}

/** 旧树里末级的附加状态（搁置 / 完成时刻），编辑文本后按完整链回填 */
export function prevLeafState(nodes: TaskNode[]): Map<string, { shelved?: boolean; doneAt?: number }> {
  const map = new Map<string, { shelved?: boolean; doneAt?: number }>();
  walkLeaves(nodes, (node, chain) => {
    map.set(leafKey(chain), { shelved: node.shelved, doneAt: node.doneAt });
  });
  return map;
}

/**
 * 行 → 树。
 * - 层级不能跳：超过当前可缩进的层数会被压到最深一层（避免出现断层）
 * - `prev` 给出旧树时，按完整链回填 done（同名条目保留原状态）
 */
export function linesToTree(lines: TaskLine[], prev?: TaskNode[]): TaskNode[] {
  const doneMap = prev ? prevDoneMap(prev) : new Map<string, boolean>();
  const extraMap = prev ? prevLeafState(prev) : new Map<string, { shelved?: boolean; doneAt?: number }>();
  const root: TaskNode[] = [];
  const stack: TaskNode[] = [];

  for (const line of lines) {
    const level = Math.max(0, Math.min(line.level, stack.length));
    stack.length = level;
    const node: TaskNode = { id: genId(), title: line.title, done: false, children: [] };
    if (stack.length === 0) root.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  walkLeaves(root, (node, chain) => {
    const key = leafKey(chain);
    const prevDone = doneMap.get(key);
    if (prevDone !== undefined) node.done = prevDone;
    const extra = extraMap.get(key);
    if (extra) {
      if (extra.shelved) node.shelved = true;
      if (extra.doneAt) node.doneAt = extra.doneAt;
    }
  });

  return root;
}

// ============ 末级 ============

/** 遍历末级节点（无子节点者），回调带完整标题链 */
export function walkLeaves(
  nodes: TaskNode[],
  cb: (node: TaskNode, chain: string[]) => void,
  chain: string[] = [],
): void {
  for (const n of nodes) {
    const next = [...chain, n.title];
    if (n.children.length === 0) cb(n, next);
    else walkLeaves(n.children, cb, next);
  }
}

// This prefix separates generated IDs from previously persisted title paths.
const NODE_KEY_PREFIX = 'task-id:';

function executionKey(node: TaskNode, chain: string[]): string {
  return node.id ? `${NODE_KEY_PREFIX}${node.id}` : leafKey(chain);
}

/** 旧版末级列表调用方仍可按标题链识别条目。 */
export function leavesOf(nodes: TaskNode[], order: string[] = []): TaskLeaf[] {
  return executionLeavesOf(nodes, order).map(leaf => ({ ...leaf, key: leafKey(leaf.chain) }));
}

/** 执行清单：输出节点 ID key，兼容标题链顺序，未排序的末级按树顺序追加。 */
export function executionLeavesOf(nodes: TaskNode[], order: string[] = []): TaskLeaf[] {
  const raw: TaskLeaf[] = [];
  const byKey = new Map<string, TaskLeaf>();
  const byPath = new Map<string, TaskLeaf[]>();
  walkLeaves(nodes, (node, chain) => {
    const leaf: TaskLeaf = {
      key: executionKey(node, chain),
      label: leafLabel(chain),
      chain,
      done: node.done,
      shelved: !!node.shelved,
      doneAt: node.doneAt,
      ...(node.mindLinked ? { mindLinked: true } : {}),
      ...(node.taskTiming ? { taskTiming: node.taskTiming } : {}),
    };
    raw.push(leaf);
    byKey.set(leaf.key, leaf);
    const path = leafKey(chain);
    const matches = byPath.get(path);
    if (matches) matches.push(leaf);
    else byPath.set(path, [leaf]);
  });

  const ordered = new Set<TaskLeaf>();
  for (const key of order) {
    const leaf = byKey.get(key);
    if (leaf) ordered.add(leaf);
    else for (const match of byPath.get(key) ?? []) ordered.add(match);
  }
  for (const leaf of raw) ordered.add(leaf);
  return [...ordered];
}

/** 未结束条数（球上的数字） */
export function countUndone(leaves: TaskLeaf[]): number {
  return leaves.filter(l => !l.done).length;
}

/**
 * 勾掉 `key` 之后清单是否正好全部完成（「全部完成」庆祝的判定）。
 * 已完成的项、不存在的 key、空清单都返回 false。
 */
export function completesAll(leaves: TaskLeaf[], key: string): boolean {
  const target = leaves.find(l => l.key === key);
  if (!target || target.done) return false;
  return leaves.every(l => l.key === key || l.done);
}

// ============ 变更（不可变） ============

export function updateLeaf(
  nodes: TaskNode[], key: string, update: (node: TaskNode) => TaskNode | null, chain: string[] = [],
): TaskNode[] {
  const byId = key.startsWith(NODE_KEY_PREFIX);
  const rec = (list: TaskNode[], path: string[], matchId: boolean): TaskNode[] => {
    let changed = false;
    const next: TaskNode[] = [];
    for (const node of list) {
      const nextPath = [...path, node.title];
      let result: TaskNode | null = node;
      if (!node.children.length) {
        const candidate = matchId ? executionKey(node, nextPath) : leafKey(nextPath);
        if (candidate === key) result = update(node);
      } else {
        const children = rec(node.children, nextPath, matchId);
        if (children !== node.children) result = children.length ? { ...node, children } : null;
      }
      if (result !== node) changed = true;
      if (result) next.push(result);
    }
    return changed ? next : list;
  };
  const result = rec(nodes, chain, byId);
  // A legacy title may itself begin with the prefix.
  return byId && result === nodes ? rec(nodes, chain, false) : result;
}

/** 按节点 ID 或旧版标题链翻转末级的完成状态 */
export function toggleLeafDone(nodes: TaskNode[], key: string, now = Date.now()): TaskNode[] {
  return updateLeaf(nodes, key, node => {
    const done = !node.done;
    const next = { ...node, done, doneAt: done ? now : undefined };
    if (done && node.taskTiming?.startedAt !== undefined) next.taskTiming = { elapsedMs: elapsedTaskMs(node.taskTiming, now) };
    return next;
  });
}

/** 删除指定末级；删空的父节点一并清理（不留空壳） */
export function removeLeaf(nodes: TaskNode[], key: string): TaskNode[] {
  return updateLeaf(nodes, key, () => null);
}

/** 旧版排序：将 from 插在 to 前面 */
export function moveKey(order: string[], from: string, to: string): string[] {
  if (from === to) return order;
  const next = order.filter(k => k !== from);
  const at = next.indexOf(to);
  if (at < 0) return [...next, from];
  next.splice(at, 0, from);
  return next;
}

/** Move to the destination's original slot, including when moving down. */
export function moveKeyToTargetSlot(order: string[], from: string, to: string): string[] {
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return order;
  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}

/** 保留旧版标题链输出，便于旧调用方继续使用。 */
export function normalizeOrder(nodes: TaskNode[], order: string[]): string[] {
  return [...new Set(leavesOf(nodes, order).map(leaf => leaf.key))];
}

/** 将旧版标题链转换为 ID key，去掉已消失的末级，补上新末级。 */
export function normalizeExecutionOrder(nodes: TaskNode[], order: string[]): string[] {
  return executionLeavesOf(nodes, order).map(leaf => leaf.key);
}

/** Resolve legacy action keys against current leaves; stale keys are no-ops. */
export function reorderExecutionLeaves(nodes: TaskNode[], order: string[], from: string, to: string): string[] {
  const leaves = executionLeavesOf(nodes, order);
  const resolve = (key: string) => leaves.find(leaf => leaf.key === key)
    ?? leaves.find(leaf => leafKey(leaf.chain) === key);
  const source = resolve(from);
  const target = resolve(to);
  if (!source || !target || source === target) return order;
  return moveKeyToTargetSlot(leaves.map(leaf => leaf.key), source.key, target.key);
}

/** 搁置 / 撤销搁置某个末级（保持链结构不动，只改标记） */
export function setLeafShelved(
  nodes: TaskNode[],
  key: string,
  shelved: boolean,
  chain: string[] = [],
): TaskNode[] {
  return updateLeaf(nodes, key, node => node.shelved === shelved ? node : { ...node, shelved }, chain);
}
/**
 * 清掉已完成的末级；父节点因此变空壳的也一并清掉。
 * 全部完成时返回空数组（调用方据此把清单清空）。
 */
export function pruneDoneLeaves(nodes: TaskNode[], shouldRemove = (node: TaskNode) => node.done): TaskNode[] {
  let changed = false;
  const kept: TaskNode[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) {
      if (shouldRemove(node)) changed = true;
      else kept.push(node);
      continue;
    }
    const children = pruneDoneLeaves(node.children, shouldRemove);
    if (children !== node.children) changed = true;
    if (children.length) kept.push(children === node.children ? node : { ...node, children });
  }
  return changed ? kept : nodes;
}

export const TASK_UNDO_MS = 30_000;

export function isExpiredTask(node: TaskNode, now: number): boolean {
  return node.done && (node.doneAt === undefined || node.doneAt + TASK_UNDO_MS <= now);
}

export function pruneExpiredTasks(nodes: TaskNode[], now = Date.now()): TaskNode[] {
  return pruneDoneLeaves(nodes, node => isExpiredTask(node, now));
}