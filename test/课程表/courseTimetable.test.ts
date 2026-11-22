import { describe, expect, it } from 'vitest';
import { createTimetable, timetableDayBlocks, timetableSlot, timetableTime, TIMETABLE_FULL_WEEK, TIMETABLE_WEEKDAYS } from '../../src/utils/courseTimetable';

const course = (dayOfWeek: number[], startTime: string, endTime: string) => ({ dayOfWeek, startTime, endTime });
const foldedTimes = (grid: ReturnType<typeof createTimetable>) => grid.bands.filter(b => b.folded).map(b => [timetableTime(b.start), timetableTime(b.end)]);

describe('课表折叠与选时', () => {
  it('uses all displayed weekdays together, merging overlap and adjacency at exact minutes', () => {
    const courses = [course([1], '07:15', '08:00'), course([2], '07:45', '09:20'), course([3], '09:20', '09:49'), course([5], '12:05', '13:20'), course([6], '09:49', '12:05'), course([0], '00:00', '07:15')];
    const weekdayGrid = createTimetable(courses, TIMETABLE_WEEKDAYS, 60);
    expect(foldedTimes(weekdayGrid)).toEqual([['00:00', '07:15'], ['09:49', '12:05'], ['13:20', '24:00']]);
    expect(foldedTimes(createTimetable(courses, TIMETABLE_FULL_WEEK, 60))).toEqual([['13:20', '24:00']]);
    expect(courses.at(-1)?.dayOfWeek).toEqual([0]);
  });

  it('provides a selectable whole-day band on an empty grid and maps folded/unfolded boundaries reversibly', () => {
    const empty = createTimetable([course([1], '08:00', '07:00'), course([4], 'bad', '18:00')], TIMETABLE_WEEKDAYS, 60);
    expect(foldedTimes(empty)).toEqual([['00:00', '24:00']]);
    expect(empty.minuteAtY(empty.height / 2)).toBe(720);
    const grid = createTimetable([course([1], '08:17', '09:42')], TIMETABLE_WEEKDAYS, 64);
    for (const minute of [0, 20, 497, 520, 582, 1340, 1440]) {
      expect(grid.minuteAtY(grid.yAtMinute(minute))).toBeCloseTo(minute);
    }
    expect(grid.minuteAtY(-5)).toBe(0);
    expect(grid.minuteAtY(grid.height + 5)).toBe(1440);
  });

  it('defaults taps, preserves reverse drags instead of applying a time combination, and clamps midnight', () => {
    const combinations = [{ startTime: '08:00', endTime: '09:40' }];
    expect(timetableSlot(5, 481, undefined, combinations)).toEqual({ dayOfWeek: [5], startTime: '08:00', endTime: '09:40' });
    expect(timetableSlot(5, 555, 481, combinations)).toEqual({ dayOfWeek: [5], startTime: '08:00', endTime: '09:15' });
    expect(timetableSlot(0, 1440)).toEqual({ dayOfWeek: [0], startTime: '23:55', endTime: '23:59' });
  });

  it('gives overlapping blocks separate targets and restarts lanes after each collision group', () => {
    const courses = [course([1], '08:00', '09:00'), course([1], '08:00', '09:00'), course([1], '08:30', '09:30'), course([1], '09:30', '10:00'), course([4], '08:00', '10:00')];
    expect(timetableDayBlocks(courses, 1).map(b => [b.lane, b.laneCount])).toEqual([[0, 3], [1, 3], [2, 3], [0, 1]]);
  });
});
