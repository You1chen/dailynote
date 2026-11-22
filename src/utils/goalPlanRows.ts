import { genId, type GoalNode } from '../types';

/** The hierarchy editor carries the actual node identity and metadata, not a title/path match. */
export type GoalPlanRow = Omit<GoalNode, 'children'> & { level: number };

export function flattenGoalPlanRows(nodes: GoalNode[]): GoalPlanRow[] {
  const rows: GoalPlanRow[] = [];
  function walk(siblings: GoalNode[], level: number) {
    for (const { children, ...node } of siblings) {
      rows.push({ ...node, level });
      walk(children, level + 1);
    }
  }
  walk(nodes, 0);
  return rows;
}

export function goalPlanRowsToNodes(rows: GoalPlanRow[]): GoalNode[] {
  const roots: GoalNode[] = [];
  const parents: GoalNode[] = [];
  for (const { level, ...node } of rows) {
    parents.length = level;
    const next: GoalNode = { ...node, children: [] };
    const siblings = level ? parents[level - 1].children : roots;
    siblings.push(next);
    parents.push(next);
  }
  return roots;
}

export function newGoalPlanRow(title: string, level: number): GoalPlanRow {
  return { id: genId(), title, level, completed: false, createdAt: Date.now() };
}

export function goalPlanBranchEnd(rows: GoalPlanRow[], start: number): number {
  let end = start + 1;
  while (end < rows.length && rows[end].level > rows[start].level) end += 1;
  return end;
}

export function shiftedGoalPlanLevel(rows: GoalPlanRow[], index: number, level: number, delta: number): number {
  return Math.max(0, Math.min(level + delta, index === 0 ? 0 : rows[index - 1].level + 1));
}

export function shiftGoalPlanBranch(rows: GoalPlanRow[], start: number, delta: number): GoalPlanRow[] {
  const level = rows[start].level;
  const shift = shiftedGoalPlanLevel(rows, start, level, delta) - level;
  if (shift === 0) return rows;
  const end = goalPlanBranchEnd(rows, start);
  const branch = rows.slice(start, end).map(row => ({ ...row, level: row.level + shift }));
  // Outdenting inserts the branch after its former ancestor, not before its old siblings.
  let insertAt = end;
  if (shift < 0) {
    const siblingLevel = level + shift;
    while (insertAt < rows.length && rows[insertAt].level > siblingLevel) insertAt += 1;
  }
  return [...rows.slice(0, start), ...rows.slice(end, insertAt), ...branch, ...rows.slice(insertAt)];
}
