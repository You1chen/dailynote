import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayStr } from '../../src/types';

afterEach(() => vi.useRealTimers());

describe('todayStr 使用本地日历日期', () => {
  it.each([
    [2026, 9, 28, 0, 0, '2026-10-28'],
    [2026, 9, 28, 7, 59, '2026-10-28'],
    [2027, 0, 1, 0, 0, '2027-01-01'],
    [2026, 9, 27, 18, 0, '2026-10-27'],
    [2026, 9, 28, 23, 59, '2026-10-28'],
  ])('本地 %i/%i/%i %i:%i → %s', (year, month, day, hour, minute, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, month, day, hour, minute));
    expect(todayStr()).toBe(expected);
  });
});
