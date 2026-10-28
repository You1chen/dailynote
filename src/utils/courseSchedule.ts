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

/** 所属学期匹配；缺字段的旧课程由存储层补齐前保持兼容，不在纯计算中重绑。 */
export function isCourseInSemester(course: Course, semester: SemesterRecord | undefined): boolean {
  return course.semesterStartDate === undefined || course.semesterStartDate === semester?.startDate;
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
    .filter(c => isCourseInSemester(c, semester) && c.dayOfWeek.includes(dw) && isCourseActiveOnWeek(c, week))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
}

/**
 * 「有效课程」：本学期、且当前周还在课程周期内的课程（供 DDL 关联用）。
 * - 未设置开学时间 / 还没开学 → 空
 * - 显式归属其他学期的课程 → 不算；缺字段旧课程兼容
 * - 课程还没开讲（startWeek 大于本周）或已经结课（超过 startWeek+weekCount-1）→ 不算
 * - 单双周课程在本周不上 → 不算
 * 按课程名排序，保证选择列表顺序稳定。
 */
export function effectiveCourses(
  courses: Course[],
  semester: SemesterRecord | undefined,
  dateStr: string,
): Course[] {
  if (!semester?.startDate) return [];
  const week = weekIndex(dateStr, semester.startDate);
  if (week < 1) return [];
  return courses
    .filter(c => isCourseInSemester(c, semester) && isCourseActiveOnWeek(c, week))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.startTime.localeCompare(b.startTime));
}

/** 当前学期周次（未设置开学时间或未开学 → 0），供「第 N 周」文案使用 */
export function currentWeekOf(semester: SemesterRecord | undefined, dateStr: string): number {
  if (!semester?.startDate) return 0;
  return weekIndex(dateStr, semester.startDate);
}
