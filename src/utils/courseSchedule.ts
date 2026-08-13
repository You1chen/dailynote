// ============ 课程表日程计算（纯函数） ============
//
// 周定义：开学时间所在周（周一对齐）为第 1 周；早于开学 → 0（无课）。
// 日期一律本地时区解析（new Date('YYYY-MM-DD' + 'T00:00:00')），与 DayNavigator 约定一致。

import type { Course, SemesterRecord } from '../types';
import { isBuiltinHoliday } from './holidays';

function parseLocal(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function formatLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 星期几：0-6，0=周日 */
export function weekdayOf(dateStr: string): number {
  return parseLocal(dateStr).getDay();
}

/** 该日期所在周的周一（"YYYY-MM-DD"） */
export function mondayOf(dateStr: string): string {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return formatLocal(d);
}

/** 学期周次：开学时间所在周 = 第 1 周；早于开学 → 0 */
export function weekIndex(dateStr: string, semesterStart: string): number {
  const a = parseLocal(mondayOf(dateStr));
  const b = parseLocal(mondayOf(semesterStart));
  const diffDays = Math.round((a.getTime() - b.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return week < 1 ? 0 : week;
}

/** 课程在第 week 周是否上课（周数区间 + 单双周） */
export function isCourseActiveOnWeek(course: Course, week: number): boolean {
  if (week < course.startWeek || week > course.startWeek + course.weekCount - 1) return false;
  if (course.weekType === 'odd') return week % 2 === 1;
  if (course.weekType === 'even') return week % 2 === 0;
  return true;
}

/** 某天是否为不上课日：手动特殊日期优先，其次内置法定节假日 */
export function isDayHoliday(dateStr: string, semester: SemesterRecord | undefined): boolean {
  const special = semester?.specialDates.find(s => s.date === dateStr);
  if (special) return special.kind === 'holiday';
  return isBuiltinHoliday(dateStr);
}

/** 计算某天要上的课（按开始时间排序）。无开学时间 / 未开学 / 节假日 → 空数组 */
export function computeDayCourses(
  courses: Course[],
  semester: SemesterRecord | undefined,
  dateStr: string,
): Course[] {
  if (!semester?.startDate) return [];
  const week = weekIndex(dateStr, semester.startDate);
  if (week < 1) return [];
  if (isDayHoliday(dateStr, semester)) return [];
  const dw = weekdayOf(dateStr);
  return courses
    .filter(c => c.dayOfWeek.includes(dw) && isCourseActiveOnWeek(c, week))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
}
