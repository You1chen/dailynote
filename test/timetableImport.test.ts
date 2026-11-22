import { describe, expect, it } from 'vitest';
import { parseTimetableText } from '../src/utils/timetableImport';

describe('timetable paste import', () => {
  it('parses day, time, name and location from common text', () => {
    const result = parseTimetableText('周一 08:00-09:40 高等数学 @教1-101\n星期三 14:30~16:10 大学物理 | 物理楼');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: '高等数学', location: '教1-101', dayOfWeek: [1], startTime: '08:00', endTime: '09:40' },
      { name: '大学物理', location: '物理楼', dayOfWeek: [3], startTime: '14:30', endTime: '16:10' },
    ]);
  });

  it('reports incomplete or invalid lines without adding partial courses', () => {
    const result = parseTimetableText('周一 高等数学\n08:00-09:40 没有星期\n周二 25:00-26:00 线性代数\n周三 10:00-09:00 倒序\n周四 10:00-11:00 正常课');
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(4);
  });
});
