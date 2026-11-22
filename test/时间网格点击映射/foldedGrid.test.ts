/**
 * foldedGrid 多段折叠网格测试
 *
 * 测试场景：课程表视图折叠凌晨（0:00-7:00）、午休（12:00-13:00）、深夜（22:00-24:00）
 * 三段不重要时段后，时间块在网格中的渲染位置。
 * 核心语义（与 blockRenderRect 贴边/最小 20px 对齐）：起止落入折叠段的边贴该段边界
 * （起点贴折叠条下方、终点贴折叠条顶部；末段起点贴网格底部），
 * 整块在折叠段内时贴在该段折叠条下方 20px。
 *
 * 被测对象：src/utils/time.ts 的 foldedGrid（真实源码 import，
 * CoursesPage.tsx 课表视图的折叠态网格调用它）。
 */

import { describe, it, expect } from 'vitest';
import { foldedGrid } from '../../src/utils/time';
import type { FoldRange } from '../../src/utils/time';

/** 课程表视图的三段不重要时段（整点对齐，不跨夜） */
const FOLDS: FoldRange[] = [
  { start: '00:00', end: '07:00' },
  { start: '12:00', end: '13:00' },
  { start: '22:00', end: '24:00' },
];

/** 默认几何：hourHeight=64、折叠条 24，可见 14 小时 → 网格总高 968 */
function defaultGrid() {
  return foldedGrid(FOLDS, 64, 24);
}

describe('foldedGrid — 网格几何', () => {
  it('网格总高 = 14 可见小时 + 3 条折叠条', () => {
    expect(defaultGrid().gridHeight).toBe(968); // 14*64 + 3*24
  });

  it('折叠条顶部：凌晨 0、午休 344、深夜 944', () => {
    expect(defaultGrid().barTops).toEqual([0, 344, 944]);
  });

  it('末条底 = 网格底', () => {
    const fg = defaultGrid();
    expect(fg.barTops[2] + 24).toBe(fg.gridHeight);
  });
});

describe('foldedGrid — mapMinute 分钟映射', () => {
  const fg = defaultGrid();

  it('折叠段内返回 -1', () => {
    expect(fg.mapMinute(0)).toBe(-1); // 00:00
    expect(fg.mapMinute(720)).toBe(-1); // 12:00
    expect(fg.mapMinute(1320)).toBe(-1); // 22:00
    expect(fg.mapMinute(1380)).toBe(-1); // 23:00
  });

  it('折叠段外按压缩映射定位', () => {
    expect(fg.mapMinute(420)).toBe(24); // 07:00 贴凌晨条下方
    expect(fg.mapMinute(480)).toBe(88); // 08:00
    expect(fg.mapMinute(660)).toBe(280); // 11:00
    expect(fg.mapMinute(780)).toBe(368); // 13:00 贴午休条下方
    expect(fg.mapMinute(1260)).toBe(880); // 21:00
    expect(fg.mapMinute(1440)).toBe(968); // 24:00 = 网格底
  });
});

describe('foldedGrid — rect 渲染矩形', () => {
  const fg = defaultGrid();

  it('普通块（08:00-09:40）按折叠映射定位', () => {
    const r = fg.rect('08:00', '09:40')!;
    expect(r.top).toBeCloseTo(88);
    expect(r.height).toBeCloseTo(106.67, 1); // 100 分钟
  });

  it('跨午休块（11:00-13:00）保持完整高度穿过折叠条', () => {
    const r = fg.rect('11:00', '13:00')!;
    expect(r.top).toBe(280);
    expect(r.height).toBe(88);
  });

  it('整块在午休内（12:00-13:00）贴午休条下方 20px', () => {
    expect(fg.rect('12:00', '13:00')).toEqual({ top: 368, height: 20 });
  });

  it('整块在午休内（12:30-12:45）同样贴午休条下方', () => {
    expect(fg.rect('12:30', '12:45')).toEqual({ top: 368, height: 20 });
  });

  it('终点在深夜段（21:00-22:30）截止到深夜条顶部', () => {
    expect(fg.rect('21:00', '22:30')).toEqual({ top: 880, height: 64 });
  });

  it('恰为深夜段（22:00-24:00）贴网格底部 20px', () => {
    expect(fg.rect('22:00', '24:00')).toEqual({ top: 948, height: 20 });
  });

  it('跨凌晨块（06:50-07:30）截取可见部分', () => {
    expect(fg.rect('06:50', '07:30')).toEqual({ top: 24, height: 32 });
  });

  it('边界时刻（07:00-08:00）从凌晨条下方开始', () => {
    expect(fg.rect('07:00', '08:00')).toEqual({ top: 24, height: 64 });
  });

  it('边界时刻（13:00-14:00）从午休条下方开始', () => {
    expect(fg.rect('13:00', '14:00')).toEqual({ top: 368, height: 64 });
  });

  it('跨夜块（21:50-00:10）起止贴边界后收 20px 于起点', () => {
    const r = fg.rect('21:50', '00:10')!;
    expect(r.top).toBeCloseTo(933.33, 1);
    expect(r.height).toBe(20);
  });
});

describe('foldedGrid — 参数与输入健壮性', () => {
  it('hourHeight 参数生效（32px/小时）', () => {
    const fg = foldedGrid(FOLDS, 32, 24);
    expect(fg.gridHeight).toBe(520); // 14*32 + 3*24
    expect(fg.mapMinute(480)).toBe(56); // 08:00
  });

  it('乱序 folds 内部按开始时间排序，结果不变', () => {
    const shuffled: FoldRange[] = [FOLDS[1], FOLDS[0], FOLDS[2]];
    expect(foldedGrid(shuffled, 64, 24).barTops).toEqual([0, 344, 944]);
  });

  it('非法时间返回 null', () => {
    const fg = defaultGrid();
    expect(fg.rect('', '08:00')).toBeNull();
    expect(fg.rect('abc', '08:00')).toBeNull();
    expect(fg.rect('08:00', '')).toBeNull();
  });
});
