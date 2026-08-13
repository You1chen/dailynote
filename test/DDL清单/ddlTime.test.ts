/**
 * DDL 截止时间计算测试（utils/ddl.ts）
 *
 * 本地时间语义：过期判断不能用 UTC 的 todayStr()（UTC+8 晚间会差一天）。
 */

import { describe, it, expect } from 'vitest';
import { minutesUntilDeadline, ddlRemainText } from '../../src/utils/ddl';

const NOW = new Date('2026-08-13T12:00:00'); // 本地时间固定基准

describe('minutesUntilDeadline', () => {
  it('未来截止：返回正分钟数', () => {
    const m = minutesUntilDeadline({ deadlineDate: '2026-08-20', deadlineTime: '18:30' }, NOW);
    expect(m).toBe(10470); // 7 天 + 6.5 小时
  });

  it('已过截止：返回负分钟数', () => {
    const m = minutesUntilDeadline({ deadlineDate: '2026-08-10', deadlineTime: '08:00' }, NOW);
    expect(m).toBe(-4560);
  });

  it('恰为截止时刻 → 0（floor 语义：截止前最后 59 秒 floor 到 0，归入已过期，倾向紧迫）', () => {
    expect(minutesUntilDeadline({ deadlineDate: '2026-08-13', deadlineTime: '12:00' }, NOW)).toBe(0);
    expect(minutesUntilDeadline(
      { deadlineDate: '2026-08-13', deadlineTime: '12:00' },
      new Date('2026-08-13T11:59:30'),
    )).toBe(0);
  });

  it('跨零点：今晚 23:00 到次日 00:30 剩 90 分钟', () => {
    const m = minutesUntilDeadline(
      { deadlineDate: '2026-08-14', deadlineTime: '00:30' },
      new Date('2026-08-13T23:00:00'),
    );
    expect(m).toBe(90);
  });

  it('非法日期 → null（UI 显示 —）', () => {
    expect(minutesUntilDeadline({ deadlineDate: '2026/08/20', deadlineTime: '18:30' }, NOW)).toBeNull();
    expect(minutesUntilDeadline({ deadlineDate: '20260820', deadlineTime: '18:30' }, NOW)).toBeNull();
    expect(minutesUntilDeadline({ deadlineDate: '2026-8-20', deadlineTime: '18:30' }, NOW)).toBeNull();
    expect(minutesUntilDeadline({ deadlineDate: '', deadlineTime: '18:30' }, NOW)).toBeNull();
    expect(minutesUntilDeadline({ deadlineDate: '2026-13-40', deadlineTime: '18:30' }, NOW)).toBeNull(); // 格式合法但日期不存在
  });

  it('非法时间 → null（UI 显示 —）', () => {
    expect(minutesUntilDeadline({ deadlineDate: '2026-08-20', deadlineTime: '25:00' }, NOW)).toBeNull();
    expect(minutesUntilDeadline({ deadlineDate: '2026-08-20', deadlineTime: '18:99' }, NOW)).toBeNull();
    expect(minutesUntilDeadline({ deadlineDate: '2026-08-20', deadlineTime: '18-30' }, NOW)).toBeNull();
    expect(minutesUntilDeadline({ deadlineDate: '2026-08-20', deadlineTime: '' }, NOW)).toBeNull();
  });
});

describe('ddlRemainText', () => {
  it('-1 → 已过期', () => {
    expect(ddlRemainText(-1)).toBe('已过期');
  });

  it('0（截止前最后 59 秒，floor 得 0）→ 已过期，不出现「剩 0 分钟」死文案', () => {
    expect(ddlRemainText(0)).toBe('已过期');
  });

  it('59 分钟 → 剩 59 分钟', () => {
    expect(ddlRemainText(59)).toBe('剩 59 分钟');
  });

  it('60 分钟 → 剩 1 小时', () => {
    expect(ddlRemainText(60)).toBe('剩 1 小时');
  });

  it('1439 分钟 → 剩 23 小时', () => {
    expect(ddlRemainText(1439)).toBe('剩 23 小时');
  });

  it('1440 分钟 → 剩 1 天', () => {
    expect(ddlRemainText(1440)).toBe('剩 1 天');
  });

  it('10080 分钟 → 剩 7 天', () => {
    expect(ddlRemainText(10080)).toBe('剩 7 天');
  });
});
