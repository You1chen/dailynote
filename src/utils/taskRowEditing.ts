import type { TaskRow } from './taskRows';

/** Write the active input draft back to its row without changing the active row. */
export function commitTaskRow(rows: TaskRow[], activeId: string | null, draft: string): TaskRow[] {
  if (!activeId) return rows;
  return rows.map(row => row.id === activeId ? { ...row, title: draft.trim() } : row);
}

/**
 * A blur caused by tapping another row must not steal focus back to the persistent
 * append row; that click will activate its own target. A blur with no target should
 * return to the append row so the newest row stays ready for input.
 */
export function shouldActivateDraftOnBlur(activeId: string | null, draftRowId: string | null, pendingTargetId: string | null): boolean {
  return !!draftRowId && activeId !== draftRowId && !pendingTargetId;
}

/** Enter on an older row should reuse the empty append row, not insert after the old row. */
export function shouldReuseAppendOnEnter(activeId: string | null, draftRowId: string | null, appendTitle: string | null | undefined): boolean {
  return !!draftRowId && activeId !== draftRowId && !(appendTitle ?? '').trim();
}
