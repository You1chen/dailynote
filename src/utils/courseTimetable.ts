import type { Course } from '../types';
import { isValidCourseTime, type CourseTimeCombination } from './courseTimeCombinations';

const DAY_END = 24 * 60;
const FOLD_HEIGHT = 28;
const SNAP_MINUTES = 5;
const DEFAULT_DURATION = 60;

export const TIMETABLE_WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const TIMETABLE_FULL_WEEK = [...TIMETABLE_WEEKDAYS, 6, 0] as const;

interface Interval {
  start: number;
  end: number;
}

interface Band extends Interval {
  folded: boolean;
  top: number;
  height: number;
}

type ScheduledCourse = Pick<Course, 'dayOfWeek' | 'startTime' | 'endTime'>;
export type CourseSlot = Pick<Course, 'dayOfWeek' | 'startTime' | 'endTime'>;

export function timetableMinute(time: string): number {
  if (time === '24:00') return DAY_END;
  if (!isValidCourseTime(time)) return NaN;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function timetableTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function interval(course: ScheduledCourse): Interval | undefined {
  const start = timetableMinute(course.startTime);
  const end = timetableMinute(course.endTime);
  return start < end ? { start, end } : undefined;
}

/** Partition the day using the union of valid intervals on visible weekdays. */
export function createTimetable(courses: readonly ScheduledCourse[], days: readonly number[], hourHeight: number) {
  const intervals = courses.flatMap(course => {
    const range = course.dayOfWeek.some(day => days.includes(day)) && interval(course);
    return range ? [range] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const union: Interval[] = [];
  for (const range of intervals) {
    const last = union[union.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else union.push(range);
  }

  const pxPerMinute = (Number.isFinite(hourHeight) && hourHeight > 0 ? hourHeight : 60) / 60;
  const bands: Band[] = [];
  let height = 0;
  function add(start: number, end: number, folded: boolean) {
    if (start >= end) return;
    const bandHeight = folded ? FOLD_HEIGHT : (end - start) * pxPerMinute;
    bands.push({ start, end, folded, top: height, height: bandHeight });
    height += bandHeight;
  }
  let lastEnd = 0;
  for (const { start, end } of union) {
    add(lastEnd, start, true);
    add(start, end, false);
    lastEnd = end;
  }
  add(lastEnd, DAY_END, true);

  // The folded bands still map continuously to their real times for clicking and dragging.
  function yAtMinute(minute: number) {
    if (minute <= 0) return 0;
    const band = bands.find(b => minute < b.end);
    return band ? band.top + (minute - band.start) / (band.end - band.start) * band.height : height;
  }
  function minuteAtY(y: number) {
    if (y <= 0) return 0;
    const band = bands.find(b => y < b.top + b.height);
    return band ? band.start + (y - band.top) / band.height * (band.end - band.start) : DAY_END;
  }
  return { bands, height, yAtMinute, minuteAtY };
}

/** Keep overlapping templates independently clickable, including alternate weeks at identical times. */
export function timetableDayBlocks<T extends ScheduledCourse>(courses: readonly T[], day: number) {
  const intervals = courses.flatMap(course => {
    const range = course.dayOfWeek.includes(day) && interval(course);
    return range ? [{ course, ...range }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: (typeof intervals[number] & { lane: number; laneCount: number })[] = [];
  let laneEnds: number[] = [];
  let groupStart = 0;
  let groupEnd = 0;
  const finishGroup = () => {
    for (let i = groupStart; i < blocks.length; i++) blocks[i].laneCount = laneEnds.length;
  };
  for (const range of intervals) {
    if (range.start >= groupEnd) {
      finishGroup();
      laneEnds = [];
      groupStart = blocks.length;
    }
    const free = laneEnds.findIndex(end => end <= range.start);
    const lane = free < 0 ? laneEnds.length : free;
    laneEnds[lane] = range.end;
    blocks.push({ ...range, lane, laneCount: 1 });
    groupEnd = Math.max(groupEnd, range.end);
  }
  finishGroup();
  return blocks;
}

/** A tap picks a default duration; a drag picks its own range, independent of saved combinations. */
export function timetableSlot(
  day: number,
  from: number,
  to?: number,
  combinations: readonly CourseTimeCombination[] = [],
): CourseSlot {
  const snap = (minute: number) => Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;
  // Native time inputs accept 23:59 as their last value, not 24:00.
  const start = Math.min(DAY_END - SNAP_MINUTES, Math.max(0, snap(to === undefined ? from : Math.min(from, to))));
  const startTime = timetableTime(start);
  const matchedEnd = combinations.find(pair => pair.startTime === startTime)?.endTime;
  const end = to === undefined
    ? matchedEnd && isValidCourseTime(matchedEnd) && matchedEnd > startTime ? timetableMinute(matchedEnd) : start + DEFAULT_DURATION
    : Math.max(start + SNAP_MINUTES, snap(Math.max(from, to)));
  return { dayOfWeek: [day], startTime, endTime: timetableTime(Math.min(DAY_END - 1, end)) };
}
