import { afterEach, describe, expect, it, vi } from 'vitest';
import { elapsedTaskMs, formatTaskElapsed } from '../src/utils/taskTiming';
import { DEFAULT_TODO_CONFIRMATIONS, readTodoConfirmations } from '../src/utils/todoConfirmations';

const after = 1_000_000;
afterEach(() => vi.unstubAllGlobals());

describe('TODO timing and confirmations', () => {
  it('includes accumulated time and real elapsed time even after the app was suspended', () => {
    expect(elapsedTaskMs({ elapsedMs: 8000, startedAt: 1000 }, after)).toBe(1_007_000);
    expect(elapsedTaskMs({ elapsedMs: 8000, startedAt: after + 1 }, after)).toBe(8000);
    expect(formatTaskElapsed(90_061_500)).toBe('25:01:01');
  });

  it('keeps old settings compatible and independently disables confirmations', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"todoConfirmations":{"stopTimer":false}}' });
    expect(readTodoConfirmations()).toEqual({ startTimer: true, stopTimer: false, moveToBacklog: true });
    vi.stubGlobal('localStorage', { getItem: () => 'bad json' });
    expect(readTodoConfirmations()).toEqual(DEFAULT_TODO_CONFIRMATIONS);
  });
});
