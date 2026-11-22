import type { TaskNode } from '../types';
import { genId } from '../types';

export interface TaskRow extends Omit<TaskNode, 'children'> {
  level: number;
}

export function flattenTaskRows(nodes: TaskNode[]): TaskRow[] {
  const out: TaskRow[] = [];
  const walk = (list: TaskNode[], level: number) => {
    for (const node of list) {
      const { children, ...row } = node;
      out.push({ ...row, level });
      if (children.length) walk(children, level + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

/** Rebuild without changing ids or done/shelved metadata. */
export function rowsToTree(rows: TaskRow[]): TaskNode[] {
  const root: TaskNode[] = [];
  const stack: TaskNode[] = [];
  for (const row of rows) {
    const level = Math.max(0, Math.min(row.level, stack.length));
    stack.length = level;
    const { level: _level, ...fields } = row;
    const node: TaskNode = { ...fields, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root.push(node);
    stack.push(node);
  }
  return root;
}

export function branchEnd(rows: TaskRow[], index: number): number {
  if (index < 0 || index >= rows.length) return index;
  const level = rows[index].level;
  let end = index + 1;
  while (end < rows.length && rows[end].level > level) end++;
  return end;
}

/** Shift a whole branch by one level, clamped to a valid parent. */
export function shiftTaskBranch(rows: TaskRow[], index: number, delta: number): TaskRow[] {
  if (!rows[index] || !delta) return rows;
  const end = branchEnd(rows, index);
  const max = index === 0 ? 0 : rows[index - 1].level + 1;
  const min = 0;
  const allowed = delta > 0 ? Math.min(delta, max - rows[index].level) : Math.max(delta, min - rows[index].level);
  if (!allowed) return rows;
  return rows.map((row, i) => i >= index && i < end ? { ...row, level: row.level + allowed } : row);
}

/** Move a whole branch to the previous/next sibling slot, keeping its children. */
export function moveTaskBranch(rows: TaskRow[], index: number, direction: -1 | 1): { rows: TaskRow[]; index: number } {
  const row = rows[index];
  if (!row) return { rows, index };
  const level = row.level;
  const end = branchEnd(rows, index);
  if (direction < 0) {
    let prev = index - 1;
    while (prev >= 0 && rows[prev].level > level) prev--;
    if (prev < 0 || rows[prev].level !== level) return { rows, index };
    return {
      rows: [...rows.slice(0, prev), ...rows.slice(index, end), ...rows.slice(prev, index), ...rows.slice(end)],
      index: prev,
    };
  }
  const after = rows[end];
  if (!after || after.level !== level) return { rows, index };
  const afterEnd = branchEnd(rows, end);
  return {
    rows: [...rows.slice(0, index), ...rows.slice(end, afterEnd), ...rows.slice(index, end), ...rows.slice(afterEnd)],
    index: index + (afterEnd - end),
  };
}

export function removeTaskBranch(rows: TaskRow[], index: number): TaskRow[] {
  const end = branchEnd(rows, index);
  return rows.filter((_, i) => i < index || i >= end);
}

export function setBranchShelved(rows: TaskRow[], index: number, shelved: boolean): TaskRow[] {
  const end = branchEnd(rows, index);
  return rows.map((row, i) => i >= index && i < end ? { ...row, shelved: shelved || undefined } : row);
}

export function newTaskRow(level = 0, title = ''): TaskRow {
  return { id: genId(), title, level, done: false };
}

/** Ensure one dedicated blank append row exists, without disturbing saved rows. */
export function ensureAppendRow(rows: TaskRow[]): TaskRow[] {
  const meaningful = rows.filter(row => row.title.trim());
  const tail = rows[rows.length - 1];
  if (tail && !tail.title.trim() && !tail.shelved && !tail.done) return [...rows];
  const level = tail?.level ?? 0;
  return [...meaningful, newTaskRow(level)];
}

/** Empty editor rows are UI state only and must not be persisted. */
export function persistableTaskRows(rows: TaskRow[]): TaskRow[] {
  return rows.filter(row => row.title.trim());
}

/** Every editor session owns exactly one trailing blank row for the next input.
 * Reuse an existing trailing blank so an older interrupted save cannot accumulate blanks.
 */
export function withTrailingDraftRow(rows: TaskRow[]): { rows: TaskRow[]; draftId: string } {
  const normalized = ensureAppendRow(rows);
  return { rows: normalized, draftId: normalized[normalized.length - 1].id };
}
