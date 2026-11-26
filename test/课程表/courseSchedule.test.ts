// 课程表日程计算纯函数测试（import 真实源码）
// 日历事实：2026-08-10 周一、2026-08-13 周四、2026-08-16 周日、2026-12-28 周一、2027-01-04 周一
import { describe, it, expect } from 'vitest';
import {
  weekdayOf,
  mondayOf,
  weekIndex,
  isCourseActiveOnWeek,
  isDayHoliday,
  computeDayCourses,
  isCourseInSemester,
} from '../../src/utils/courseSchedule';
import type { Course, SemesterRecord } from '../../src/types';
import { normalizeCourseDayOfWeek } from '../../src/types';

function makeCourse(partial: Partial<Course>): Course {
  return {
    name: '数学',
    teacher: '',
    location: '',
    dayOfWeek: [1],
    startTime: '08:00',
    endTime: '09:40',
    weekType: 'all',
    startWeek: 1,
    weekCount: 18,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function makeSemester(startDate: string | null, specialDates: SemesterRecord['specialDates'] = []): SemesterRecord {
  return { id: 1, startDate, specialDates, updatedAt: 1 };
}

describe('weekdayOf / mondayOf', () => {
  it('2026-08-13 是周四（4）', () => {
    expect(weekdayOf('2026-08-13')).toBe(4);
  });
  it('2026-08-16 是周日（0）', () => {
    expect(weekdayOf('2026-08-16')).toBe(0);
  });
  it('mondayOf：周中日期回到本周一，周一/周日自洽', () => {
    expect(mondayOf('2026-08-13')).toBe('2026-08-10');
    expect(mondayOf('2026-08-10')).toBe('2026-08-10');
    expect(mondayOf('2026-08-16')).toBe('2026-08-10');
  });
});

describe('weekIndex（开学时间所在周 = 第 1 周，周一对齐）', () => {
  it('周一开学：开学当天 = 1，同周任意天 = 1', () => {
    expect(weekIndex('2026-08-10', '2026-08-10')).toBe(1);
    expect(weekIndex('2026-08-13', '2026-08-10')).toBe(1);
    expect(weekIndex('2026-08-16', '2026-08-10')).toBe(1);
  });
  it('次周 = 2，五周后 = 6', () => {
    expect(weekIndex('2026-08-17', '2026-08-10')).toBe(2);
    expect(weekIndex('2026-09-14', '2026-08-10')).toBe(6);
  });
  it('早于开学 → 0', () => {
    expect(weekIndex('2026-08-09', '2026-08-10')).toBe(0);
    expect(weekIndex('2026-01-01', '2026-08-10')).toBe(0);
  });
  it('周中开学（周三）：所在周周一仍为第 1 周', () => {
    expect(weekIndex('2026-08-31', '2026-09-02')).toBe(1);
    expect(weekIndex('2026-09-02', '2026-09-02')).toBe(1);
    expect(weekIndex('2026-08-30', '2026-09-02')).toBe(0);
    expect(weekIndex('2026-09-07', '2026-09-02')).toBe(2);
  });
  it('跨年：2026-12-28 开学，2027-01-04 为第 2 周', () => {
    expect(weekIndex('2026-12-31', '2026-12-28')).toBe(1);
    expect(weekIndex('2027-01-04', '2026-12-28')).toBe(2);
  });
});

describe('isCourseActiveOnWeek（周数区间 + 单双周）', () => {
  it('每周课程：区间内活跃，区间外不活跃', () => {
    const c = makeCourse({ weekType: 'all', startWeek: 2, weekCount: 3 });
    expect(isCourseActiveOnWeek(c, 2)).toBe(true);
    expect(isCourseActiveOnWeek(c, 4)).toBe(true); // 边界：startWeek+count-1
    expect(isCourseActiveOnWeek(c, 1)).toBe(false);
    expect(isCourseActiveOnWeek(c, 5)).toBe(false);
  });
  it('单周：奇数周活跃', () => {
    const c = makeCourse({ weekType: 'odd', startWeek: 1, weekCount: 18 });
    expect(isCourseActiveOnWeek(c, 1)).toBe(true);
    expect(isCourseActiveOnWeek(c, 3)).toBe(true);
    expect(isCourseActiveOnWeek(c, 2)).toBe(false);
    expect(isCourseActiveOnWeek(c, 4)).toBe(false);
  });
  it('双周：偶数周活跃', () => {
    const c = makeCourse({ weekType: 'even', startWeek: 1, weekCount: 18 });
    expect(isCourseActiveOnWeek(c, 2)).toBe(true);
    expect(isCourseActiveOnWeek(c, 4)).toBe(true);
    expect(isCourseActiveOnWeek(c, 1)).toBe(false);
    expect(isCourseActiveOnWeek(c, 3)).toBe(false);
  });
  it('单双周 + 区间组合：第 5 周区间外即使奇偶匹配也不活跃', () => {
    const c = makeCourse({ weekType: 'odd', startWeek: 2, weekCount: 3 }); // 2,3,4 周
    expect(isCourseActiveOnWeek(c, 3)).toBe(true);  // 奇数且区间内
    expect(isCourseActiveOnWeek(c, 5)).toBe(false); // 奇数但区间外
    expect(isCourseActiveOnWeek(c, 2)).toBe(false); // 区间内但偶数
  });
});

describe('isCourseInSemester（学期归属兼容）', () => {
  it('显式归属只匹配完全相同的开学时间，不按同一周视为同一学期', () => {
    const c = makeCourse({ semesterStartDate: '2026-08-10' });
    expect(isCourseInSemester(c, makeSemester('2026-08-10'))).toBe(true);
    expect(isCourseInSemester(c, makeSemester('2026-08-12'))).toBe(false);
    expect(isCourseInSemester(c, makeSemester('2027-02-22'))).toBe(false);
    expect(isCourseInSemester(c, makeSemester(null))).toBe(false);
    expect(isCourseInSemester(c, undefined)).toBe(false);
  });

  it('缺字段旧课程保持兼容，纯判断不写回归属', () => {
    const c = makeCourse({});
    expect(isCourseInSemester(c, makeSemester('2026-08-10'))).toBe(true);
    expect(isCourseInSemester(c, makeSemester('2027-02-22'))).toBe(true);
    expect(c).not.toHaveProperty('semesterStartDate');
  });
});

describe('isDayHoliday（仅使用手动特殊日期）', () => {
  const sem = makeSemester('2026-08-10');
  it.each(['2026-10-01', '2027-01-01'])('不会自动将 %s 标记为放假', date => {
    expect(isDayHoliday(date, sem)).toBe(false);
    expect(isDayHoliday(date, undefined)).toBe(false);
  });
  it('普通上课日不放假', () => {
    expect(isDayHoliday('2026-08-13', sem)).toBe(false);
  });
  it('手动放假：普通日被标记后放假', () => {
    const s = makeSemester('2026-08-10', [{ id: 1, date: '2026-08-13', kind: 'holiday' }]);
    expect(isDayHoliday('2026-08-13', s)).toBe(true);
  });
  it('手动补课：不标记为放假', () => {
    const s = makeSemester('2026-08-10', [{ id: 1, date: '2026-10-01', kind: 'makeup' }]);
    expect(isDayHoliday('2026-10-01', s)).toBe(false);
  });
});

describe('computeDayCourses', () => {
  const start = '2026-08-10'; // 周一
  const thursday = makeCourse({ dayOfWeek: [4], name: '数学' });   // 周四
  const mondayA = makeCourse({ dayOfWeek: [1], name: '英语', startTime: '10:00', endTime: '11:30' });
  const mondayB = makeCourse({ dayOfWeek: [1], name: '物理', startTime: '08:00', endTime: '09:40' });

  it('无学期 / 未设置开学时间 → []', () => {
    expect(computeDayCourses([thursday], undefined, '2026-08-13')).toEqual([]);
    expect(computeDayCourses([thursday], makeSemester(null), '2026-08-13')).toEqual([]);
  });
  it('早于开学 → []', () => {
    expect(computeDayCourses([thursday], makeSemester(start), '2026-08-06')).toEqual([]);
  });
  it('排除其他学期课程，保留当前学期及缺字段旧课，且不改变输入', () => {
    const current = makeCourse({ name: '当前课', dayOfWeek: [4], semesterStartDate: start });
    const previous = makeCourse({ name: '上学期课', dayOfWeek: [4], semesterStartDate: '2026-02-23' });
    const future = makeCourse({ name: '下学期课', dayOfWeek: [4], semesterStartDate: '2027-02-22' });
    const legacy = makeCourse({ name: '旧格式课', dayOfWeek: [4] });
    const list = [previous, current, future, legacy];
    const before = JSON.stringify(list);
    expect(computeDayCourses(list, makeSemester(start), '2026-08-13').map(c => c.name))
      .toEqual(['当前课', '旧格式课']);
    expect(JSON.stringify(list)).toBe(before);
  });
  it('同一课程切换学期后不再上课，切回原学期恢复', () => {
    const c = makeCourse({ semesterStartDate: start });
    expect(computeDayCourses([c], makeSemester(start), start)).toEqual([c]);
    expect(computeDayCourses([c], makeSemester('2027-02-22'), '2027-02-22')).toEqual([]);
    expect(computeDayCourses([c], makeSemester(start), start)).toEqual([c]);
    expect(c.semesterStartDate).toBe(start);
  });
  it('星期过滤：周四只有周四的课', () => {
    const day = computeDayCourses([thursday, mondayA], makeSemester(start), '2026-08-13');
    expect(day.map(c => c.name)).toEqual(['数学']);
  });
  it('按开始时间排序（输入乱序）', () => {
    const day = computeDayCourses([mondayA, mondayB], makeSemester(start), '2026-08-10');
    expect(day.map(c => c.name)).toEqual(['物理', '英语']);
  });
  it('周数过滤：第 2 周才开始的课，第 1 周不显示', () => {
    const late = makeCourse({ dayOfWeek: [4], name: '实验', startWeek: 2, weekCount: 3 });
    expect(computeDayCourses([late], makeSemester(start), '2026-08-13')).toEqual([]);
    expect(computeDayCourses([late], makeSemester(start), '2026-08-20').map(c => c.name)).toEqual(['实验']);
  });
  it('单双周：双周课程第 1 周不显示，第 2 周显示', () => {
    const even = makeCourse({ dayOfWeek: [4], name: '双周课', weekType: 'even' });
    expect(computeDayCourses([even], makeSemester(start), '2026-08-13')).toEqual([]);
    expect(computeDayCourses([even], makeSemester(start), '2026-08-20').map(c => c.name)).toEqual(['双周课']);
  });
  it('原内置放假日 2026-10-01（周四，第 8 周）按常规课表上课', () => {
    expect(computeDayCourses([thursday], makeSemester(start), '2026-10-01')).toEqual([thursday]);
    const holiday = makeSemester(start, [{ id: 1, date: '2026-10-01', kind: 'holiday' }]);
    expect(computeDayCourses([thursday], holiday, '2026-10-01')).toEqual([]);
  });
  it('手动补课保留常规星期和周次过滤', () => {
    const sem = makeSemester(start, [{ id: 1, date: '2026-10-01', kind: 'makeup' }]);
    const odd = makeCourse({ dayOfWeek: [4], weekType: 'odd' });
    expect(computeDayCourses([thursday, mondayA, odd], sem, '2026-10-01')).toEqual([thursday]);
  });
  it('手动放假抑制普通上课日', () => {
    const sem = makeSemester(start, [{ id: 1, date: '2026-08-13', kind: 'holiday' }]);
    expect(computeDayCourses([thursday], sem, '2026-08-13')).toEqual([]);
  });
  it('多天课程：周一+周四同一门课，两天都显示，其他天不显示', () => {
    const multi = makeCourse({ dayOfWeek: [1, 4], name: '大学物理' });
    expect(computeDayCourses([multi], makeSemester(start), '2026-08-10').map(c => c.name)).toEqual(['大学物理']);
    expect(computeDayCourses([multi], makeSemester(start), '2026-08-13').map(c => c.name)).toEqual(['大学物理']);
    expect(computeDayCourses([multi], makeSemester(start), '2026-08-14')).toEqual([]);
    expect(computeDayCourses([multi], makeSemester(start), '2026-08-16')).toEqual([]);
  });
});

describe('normalizeCourseDayOfWeek（旧数据兼容）', () => {
  it('单数字 → 数组；数组原样返回', () => {
    expect(normalizeCourseDayOfWeek({ ...makeCourse('x'), dayOfWeek: 4 } as Course).dayOfWeek).toEqual([4]);
    expect(normalizeCourseDayOfWeek({ ...makeCourse('x'), dayOfWeek: [2, 4] }).dayOfWeek).toEqual([2, 4]);
  });
});
