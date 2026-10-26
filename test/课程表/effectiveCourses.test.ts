/**
 * 「有效课程」测试（DDL 关联用）
 *
 * 有效 = 本学期已开学 + 今天所在周在课程周期内（含单双周）。
 * 覆盖用户点名的两种情况：上学期的课/还没开讲的课不算。
 */

import { describe, it, expect } from 'vitest';
import { effectiveCourses, currentWeekOf } from '../../src/utils/courseSchedule';
import type { Course, SemesterRecord } from '../../src/types';

/** 开学：2026-09-07（周一） */
const START = '2026-09-07';
/** 2026-11-02（周一）= 第 9 周（单周）；2026-11-09 = 第 10 周（双周） */
const WEEK9 = '2026-11-02';
const WEEK10 = '2026-11-09';

function semester(startDate: string | null = START): SemesterRecord {
  return { id: 1, startDate, specialDates: [], updatedAt: 0 };
}

let seq = 0;
function course(name: string, over: Partial<Course> = {}): Course {
  seq += 1;
  return {
    id: seq,
    name,
    teacher: '',
    location: '',
    dayOfWeek: [1],
    startTime: '08:00',
    endTime: '09:40',
    weekType: 'all',
    startWeek: 1,
    weekCount: 16,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const names = (list: Course[]) => list.map(c => c.name);

describe('effectiveCourses — 学期前提', () => {
  it('没有学期记录 → 没有有效课程', () => {
    expect(effectiveCourses([course('高数')], undefined, WEEK9)).toEqual([]);
  });

  it('没设开学时间 → 没有有效课程', () => {
    expect(effectiveCourses([course('高数')], semester(null), WEEK9)).toEqual([]);
  });

  it('还没开学（开学前一周）→ 没有有效课程', () => {
    expect(effectiveCourses([course('高数')], semester(), '2026-09-01')).toEqual([]);
  });
});

describe('effectiveCourses — 课程周期', () => {
  it('本周还在周期内 → 有效', () => {
    expect(names(effectiveCourses([course('高数', { startWeek: 1, weekCount: 16 })], semester(), WEEK9)))
      .toEqual(['高数']);
  });

  it('还没开讲（第 10 周才开始，本周第 9 周）→ 不算', () => {
    expect(effectiveCourses([course('还没上', { startWeek: 10 })], semester(), WEEK9)).toEqual([]);
  });

  it('已经结课（第 1-8 周，本周第 9 周）→ 不算', () => {
    expect(effectiveCourses([course('已结课', { startWeek: 1, weekCount: 8 })], semester(), WEEK9)).toEqual([]);
  });

  it('周期边界：第 9 周开始 / 第 9 周结束都算有效', () => {
    const c1 = course('第9周开', { startWeek: 9, weekCount: 3 });
    const c2 = course('第9周结', { startWeek: 2, weekCount: 8 });
    expect(names(effectiveCourses([c1, c2], semester(), WEEK9))).toEqual(['第9周结', '第9周开']);
  });

  it('单双周：第 9 周只有单周课有效，第 10 周只有双周课有效', () => {
    const odd = course('单周课', { weekType: 'odd' });
    const even = course('双周课', { weekType: 'even' });
    const all = course('每周课', { weekType: 'all' });

    const w9 = names(effectiveCourses([odd, even, all], semester(), WEEK9));
    expect(w9).toHaveLength(2);
    expect(w9).toContain('单周课');
    expect(w9).toContain('每周课');

    const w10 = names(effectiveCourses([odd, even, all], semester(), WEEK10));
    expect(w10).toHaveLength(2);
    expect(w10).toContain('双周课');
    expect(w10).toContain('每周课');
  });
});

describe('effectiveCourses — 输出顺序', () => {
  it('按课程名排序，同名的按开始时间', () => {
    // 用拉丁字母避免中文本地化排序差异，只验证「先名字、后时间」这两层
    const list = [
      course('Beta', { startTime: '10:00' }),
      course('Apple', { startTime: '14:00' }),
      course('Apple', { startTime: '08:00', id: 99 }),
    ];
    const out = effectiveCourses(list, semester(), WEEK9);
    expect(out.map(c => `${c.name}@${c.startTime}`)).toEqual(['Apple@08:00', 'Apple@14:00', 'Beta@10:00']);
  });

  it('不修改传入数组', () => {
    const list = [course('Beta'), course('Apple')];
    const before = list.map(c => c.name);
    effectiveCourses(list, semester(), WEEK9);
    expect(list.map(c => c.name)).toEqual(before);
  });
});

describe('currentWeekOf — 关联面板上的「第 N 周」', () => {
  it('正常学期：第 9 周', () => {
    expect(currentWeekOf(semester(), WEEK9)).toBe(9);
  });

  it('没开学时间 / 还没开学 → 0', () => {
    expect(currentWeekOf(undefined, WEEK9)).toBe(0);
    expect(currentWeekOf(semester(), '2026-09-01')).toBe(0);
  });
});
