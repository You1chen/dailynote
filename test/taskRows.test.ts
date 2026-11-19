import { describe, expect, it } from 'vitest';
import type { TaskNode } from '../src/types';
import { flattenTaskRows, newTaskRow, persistableTaskRows, removeTaskBranch, rowsToTree, setBranchShelved, shiftTaskBranch, withTrailingDraftRow } from '../src/utils/taskRows';
import { commitTaskRow, shouldActivateDraftOnBlur, shouldReuseAppendOnEnter } from '../src/utils/taskRowEditing';

const nodes: TaskNode[] = [
  { id: 'a', title: 'A', done: false, children: [
    { id: 'b', title: 'B', done: true, doneAt: 2, children: [
      { id: 'd', title: 'D', done: false, children: [] },
    ] },
  ] },
  { id: 'c', title: 'C', done: false, shelved: true, children: [] },
];

describe('task row tree editor', () => {
  it('roundtrips ids, done, doneAt and shelved metadata', () => {
    const rows = flattenTaskRows(nodes);
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(rows[1].done).toBe(true);
    expect(rows[1].doneAt).toBe(2);
    expect(rowsToTree(rows)).toEqual(nodes);
  });

  it('moves a whole branch and clamps to a valid hierarchy', () => {
    const rows = [
      { id: 'a', title: 'A', level: 0, done: false },
      { id: 'b', title: 'B', level: 1, done: false },
      { id: 'c', title: 'C', level: 0, done: false },
      { id: 'd', title: 'D', level: 1, done: false },
    ];
    expect(shiftTaskBranch(rows, 0, 1)).toBe(rows);
    const moved = shiftTaskBranch(rows, 2, 1);
    expect(moved[2].level).toBe(1);
    expect(moved[3].level).toBe(2);
    const back = shiftTaskBranch(moved, 2, -1);
    expect(back[2].level).toBe(0);
    expect(back[3].level).toBe(1);
  });

  it('keeps one append row after entering, switching rows and editing a previous title', () => {
    const initial = flattenTaskRows([{ id: 'saved-a', title: 'A', done: false, children: [] }, { id: 'saved-b', title: 'B', done: false, children: [] }]);
    const { rows, draftId } = withTrailingDraftRow(initial);
    expect(rows.map(row => row.id)).toEqual(['saved-a', 'saved-b', draftId]);
    expect(persistableTaskRows(rows).map(row => row.title)).toEqual(['A', 'B']);

    const edited = commitTaskRow(rows, 'saved-a', 'A changed');
    expect(edited[0].title).toBe('A changed');
    expect(shouldActivateDraftOnBlur('saved-a', draftId, null)).toBe(true);
    expect(shouldActivateDraftOnBlur('saved-a', draftId, 'saved-b')).toBe(false);
    expect(shouldReuseAppendOnEnter('saved-a', draftId, '')).toBe(true);

    const newRow = newTaskRow(0, 'C');
    const next = [...edited.slice(0, 2), { ...rows[2], title: newRow.title }];
    expect(next.map(row => row.id)).toEqual(['saved-a', 'saved-b', draftId]);
    expect(rowsToTree(persistableTaskRows(next)).map(node => node.title)).toEqual(['A changed', 'B', 'C']);
  });

  it('shelves/restores a whole branch and deletes it with descendants', () => {
    const rows = flattenTaskRows(nodes);
    const shelved = setBranchShelved(rows, 0, true);
    expect(shelved.slice(0, 2).every(row => row.shelved)).toBe(true);
    expect(removeTaskBranch(rows, 0).map(row => row.id)).toEqual(['c']);
  });

  it('commits an older row without losing the append row focus decision', () => {
    const rows = [
      { id: 'old', title: 'old', level: 0, done: false },
      { id: 'append', title: '', level: 0, done: false },
    ];
    expect(commitTaskRow(rows, 'old', ' changed ')[0].title).toBe('changed');
    expect(shouldActivateDraftOnBlur('old', 'append', null)).toBe(true);
    expect(shouldActivateDraftOnBlur('old', 'append', 'append')).toBe(false);
  });

  it('always gives the editor one trailing blank row', () => {
    const { rows, draftId } = withTrailingDraftRow([
      { id: 'a', title: 'A', level: 1, done: false },
    ]);
    expect(rows.map(row => row.id)).toEqual(['a', draftId]);
    expect(rows[1]).toMatchObject({ title: '', level: 1 });
  });

  it('reuses an existing trailing blank instead of accumulating draft rows', () => {
    const { rows, draftId } = withTrailingDraftRow([
      { id: 'a', title: 'A', level: 0, done: false },
      { id: 'draft', title: '  ', level: 1, done: false },
    ]);
    expect(rows.map(row => row.id)).toEqual(['a', 'draft']);
    expect(draftId).toBe('draft');
  });

  it('drops the UI-only trailing blank before persisting', () => {
    const rows = [
      { id: 'a', title: 'A', level: 0, done: false },
      { id: 'draft', title: '', level: 0, done: false },
    ];
    const persisted = persistableTaskRows(rows);
    expect(persisted.map(row => row.id)).toEqual(['a']);
    expect(rowsToTree(persisted)).toEqual([{ id: 'a', title: 'A', done: false, children: [] }]);
    expect(rowsToTree(rows)).toHaveLength(2);
  });

  it('Enter on an older row reuses the empty append row instead of inserting after it', () => {
    expect(shouldReuseAppendOnEnter('old', 'append', '')).toBe(true);
    expect(shouldReuseAppendOnEnter('old', 'append', 'typed')).toBe(false);
    expect(shouldReuseAppendOnEnter('append', 'append', '')).toBe(false);
  });
});
