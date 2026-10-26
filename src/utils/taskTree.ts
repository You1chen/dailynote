/**
 * 任务树（taskboard）纯函数：文本结构 ⇄ 层级 ⇄ 末级并列
 *
 * 约定：
 *   - 标准文本结构：每行以 `- ` 开头，Tab 递进一层（只认这种）
 *   - 内部 key 用标题链（"实验/近代物理学实验/实验报告"）——
 *     必须用完整链，不能只用"父-子"，否则两个实验下同名的「实验报告」会串状态
 *   - 列表显示只取末级：`父-子`；一级节点本身是末级时不带前缀
 */

import type { TaskLeaf, TaskNode } from '../types';
import { genId } from '../types';

export interface TaskLine {
  title: string;
  level: number;
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

/**
 * 行 → 树。
 * - 层级不能跳：超过当前可缩进的层数会被压到最深一层（避免出现断层）
 * - `prev` 给出旧树时，按完整链回填 done（同名条目保留原状态）
 */
export function linesToTree(lines: TaskLine[], prev?: TaskNode[]): TaskNode[] {
  const doneMap = prev ? prevDoneMap(prev) : new Map<string, boolean>();
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
    const prevDone = doneMap.get(leafKey(chain));
    if (prevDone !== undefined) node.done = prevDone;
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

/**
 * 取末级并列列表。
 * `order` 是用户拖动后的顺序（完整链数组）；不在 order 里的按树的顺序追加到末尾。
 */
export function leavesOf(nodes: TaskNode[], order: string[] = []): TaskLeaf[] {
  const raw: TaskLeaf[] = [];
  walkLeaves(nodes, (node, chain) => {
    raw.push({ key: leafKey(chain), label: leafLabel(chain), chain, done: node.done });
  });

  const idx = new Map<string, number>();
  order.forEach((k, i) => idx.set(k, i));

  return raw
    .map((leaf, i) => ({ leaf, i }))
    .sort((a, b) => {
      const ai = idx.get(a.leaf.key);
      const bi = idx.get(b.leaf.key);
      if (ai === undefined && bi === undefined) return a.i - b.i;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    })
    .map(x => x.leaf);
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

/** 按完整链翻转末级的完成状态 */
export function toggleLeafDone(nodes: TaskNode[], key: string): TaskNode[] {
  const parts = key.split('/');
  const rec = (list: TaskNode[], depth: number): TaskNode[] =>
    list.map(n => {
      if (n.title !== parts[depth]) return n;
      if (depth === parts.length - 1) return { ...n, done: !n.done };
      return { ...n, children: rec(n.children, depth + 1) };
    });
  return rec(nodes, 0);
}

/** 按完整链删掉一个末级；删空的父节点一并清理（不留空壳） */
export function removeLeaf(nodes: TaskNode[], key: string): TaskNode[] {
  const parts = key.split('/');

  const rec = (list: TaskNode[], depth: number): TaskNode[] => {
    const out: TaskNode[] = [];
    for (const n of list) {
      if (n.title !== parts[depth]) { out.push(n); continue; }
      // 命中链上节点
      if (depth === parts.length - 1 && n.children.length === 0) continue; // 末级：丢掉
      const children = rec(n.children, depth + 1);
      if (children.length > 0) out.push({ ...n, children });               // 父节点还有别的孩子就保留
      // 否则父节点变成空壳，一并丢掉
    }
    return out;
  };

  return rec(nodes, 0);
}

/** 拖动排序：把 from 移到 to 的位置 */
export function moveKey(order: string[], from: string, to: string): string[] {
  if (from === to) return order;
  const next = order.filter(k => k !== from);
  const at = next.indexOf(to);
  if (at < 0) return [...next, from];
  next.splice(at, 0, from);
  return next;
}

/** 保证 order 覆盖当前所有末级：去掉已消失的，补上新出现的（按树顺序追加） */
export function normalizeOrder(nodes: TaskNode[], order: string[]): string[] {
  const keys = leavesOf(nodes).map(l => l.key);
  const keep = order.filter(k => keys.includes(k));
  for (const k of keys) if (!keep.includes(k)) keep.push(k);
  return keep;
}
