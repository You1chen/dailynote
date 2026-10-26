/**
 * 「只看未来」折叠窗口测试
 *
 * 被测对象：src/utils/time.ts 的 futureFoldStart / futureWindow（真实源码 import）。
 * 参数取自日计划页的真实配置：hourHeight=64、折叠条 24px。
 *
 * 场景：11:15 打开日计划并开启「只看未来」→ 折叠 00:00–11:00，
 * 网格从 11:00 开始，块、小时标签、点击反算都必须落在同一套坐标系里。
 */

import { describe, it, expect } from 'vitest';
import { futureFoldStart, futureWindow, minutesToTop } from '../../src/utils/time';

const HOUR = 64;
const BAR = 24;

describe('futureFoldStart — 折叠起点取当前小时起点', () => {
  it('11:15 → 11:00', () => {
    expect(futureFoldStart(11 * 60 + 15)).toBe(660);
  });

  it('整点不越界：11:00 → 11:00', () => {
    expect(futureFoldStart(660)).toBe(660);
  });

  it('00:xx 没有可折叠内容 → 0', () => {
    expect(futureFoldStart(0)).toBe(0);
    expect(futureFoldStart(59)).toBe(0);
  });

  it('23:59 → 23:00（仍保留当天最后一小时）', () => {
    expect(futureFoldStart(23 * 60 + 59)).toBe(1380);
  });

  it('非法输入按不折叠处理', () => {
    expect(futureFoldStart(Number.NaN)).toBe(0);
  });
});

describe('futureWindow — 11:00 起点（真实页面参数）', () => {
  const g = futureWindow(660, HOUR, BAR);

  it('总高 = 折叠条 + 13 小时', () => {
    expect(g.gridHeight).toBe(856); // 24 + 13 * 64
  });

  it('折叠条之后从起点开始，逐小时线性下降', () => {
    expect(g.minuteToTop(660)).toBe(24);
    expect(g.minuteToTop(720)).toBe(88);  // 12:00
    expect(g.minuteToTop(1380)).toBe(792); // 23:00（起点后 12 小时）
    expect(g.minuteToTop(1440)).toBe(856); // 次日 00:00 = 网格底部
  });

  it('起点之前一律折叠（返回 -1）', () => {
    expect(g.minuteToTop(0)).toBe(-1);
    expect(g.minuteToTop(659)).toBe(-1);
  });

  it('分钟 → top → 分钟 往返一致（点击反算用）', () => {
    for (const m of [660, 700, 780, 900, 1200, 1439]) {
      expect(g.topToMinutes(g.minuteToTop(m))).toBeCloseTo(m, 6);
    }
  });

  it('点在折叠条上按起点算（不会落到已折叠区间）', () => {
    expect(g.topToMinutes(0)).toBe(660);
    expect(g.topToMinutes(10)).toBe(660);
  });

  it('整块落在已折叠区间 → 不显示', () => {
    expect(g.rect('08:00', '09:30')).toBeNull();
    expect(g.rect('10:00', '11:00')).toBeNull();
  });

  it('跨折叠起点的块 → 从折叠条下方开始，保留真实结束时间', () => {
    const r = g.rect('10:00', '11:40')!;
    expect(r.top).toBe(24);
    expect(r.top + r.height).toBeCloseTo(24 + (40 / 60) * HOUR, 6);
  });

  it('整块在未来 → 按真实起止定位', () => {
    expect(g.rect('14:00', '15:00')).toEqual({ top: 24 + 3 * HOUR, height: HOUR });
  });

  it('结束时间跨到次日（00:00）按当天末尾算', () => {
    const r = g.rect('23:00', '00:00')!;
    expect(r.top).toBe(24 + 12 * HOUR);
    expect(r.top + r.height).toBe(856);
  });

  it('极短的未来块保底 20px', () => {
    const r = g.rect('18:00', '18:02')!;
    expect(r.height).toBe(20);
  });

  it('非法时间 → null', () => {
    expect(g.rect('abc', '18:00')).toBeNull();
  });
});

describe('futureWindow — 边界起点', () => {
  it('起点 23:00 只剩 1 小时', () => {
    const g = futureWindow(1380, HOUR, BAR);
    expect(g.gridHeight).toBe(88); // 24 + 64
    expect(g.minuteToTop(1380)).toBe(24);
    expect(g.minuteToTop(1440)).toBe(88);
  });

  it('不同密度（hourHeight=52）也保持比例', () => {
    const g = futureWindow(600, 52, 20);
    expect(g.gridHeight).toBe(20 + 14 * 52);
    expect(g.minuteToTop(720)).toBe(20 + 2 * 52);
  });

  it('与睡眠折叠的映射互不干扰：只看未来时不走 minutesToTop', () => {
    // 睡眠折叠下 12:00 有 28px 折叠条偏移 + 07:00 起点 → 324；只看未来 → 24 + 64
    const sleepMapped = minutesToTop(720, {
      hideSleep: true, sleepStart: '23:00', sleepEnd: '07:00',
      hourHeight: HOUR, barHeight: 28, gridHeight: 16 * HOUR + 28,
    });
    expect(sleepMapped).toBe(28 + 5 * HOUR);
    expect(futureWindow(660, HOUR, BAR).minuteToTop(720)).toBe(88);
  });
});
