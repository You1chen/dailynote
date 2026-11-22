import { describe, expect, it } from 'vitest';
import { taskDragLayout } from '../src/utils/taskDragLayout';

const rows = [{ top: 0, bottom: 40 }, { top: 40, bottom: 100 }, { top: 100, bottom: 140 }];

describe('task drag previews', () => {
  it('keeps the source under the pointer and displaces rows down as it moves up', () => {
    expect(taskDragLayout(rows, 2, -22)).toEqual({ targetIndex: 2, offsets: [0, 0, -22] });
    expect(taskDragLayout(rows, 2, -35)).toEqual({ targetIndex: 1, offsets: [0, 40, -35] });
    expect(taskDragLayout(rows, 2, -90)).toEqual({ targetIndex: 0, offsets: [40, 40, -90] });
  });

  it('gives way by the full height of a branch, and reverses the preview when pulled back', () => {
    expect(taskDragLayout(rows, 1, 25)).toEqual({ targetIndex: 2, offsets: [0, 25, -60] });
    expect(taskDragLayout(rows, 1, 10)).toEqual({ targetIndex: 1, offsets: [0, 10, 0] });
  });
});
