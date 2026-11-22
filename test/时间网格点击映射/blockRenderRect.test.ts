/**
 * blockRenderRect 渲染矩形测试
 *
 * 测试场景：睡眠折叠时段下，时间块在网格中的渲染位置。
 * 核心回归：⚡即时 任务（startTime=当前时刻）在睡眠折叠时段内创建后
 * 必须可见（贴到折叠窗口对应边界），而不是被 `top<0` 丢弃。
 *
 * 被测对象：src/utils/time.ts 的 blockRenderRect（真实源码 import，
 * DailyPlan.tsx 与 FullscreenSchedule.tsx 的时间块渲染均调用它）。
 */

import { describe, it, expect } from 'vitest';
import { blockRenderRect } from '../../src/utils/time';
import type { BlockRectGeometry } from '../../src/utils/time';

/** 默认几何：跨夜睡眠 23:00-07:00，hourHeight=64，折叠条偏移 28，16 可见小时 */
function crossingGeometry(overrides: Partial<BlockRectGeometry> = {}): BlockRectGeometry {
  return {
    hideSleep: true,
    sleepStart: '23:00',
    sleepEnd: '07:00',
    hourHeight: 64,
    barHeight: 28,
    gridHeight: 16 * 64 + 28, // 1052
    ...overrides,
  };
}

/** 不跨夜：睡眠 03:00-06:00，21 可见小时 */
function nonCrossingGeometry(): BlockRectGeometry {
  return {
    hideSleep: true,
    sleepStart: '03:00',
    sleepEnd: '06:00',
    hourHeight: 64,
    barHeight: 28,
    gridHeight: 21 * 64 + 28, // 1372
  };
}

describe('blockRenderRect — 不折叠睡眠', () => {
  const g: BlockRectGeometry = {
    hideSleep: false,
    sleepStart: '23:00',
    sleepEnd: '07:00',
    hourHeight: 64,
    barHeight: 0,
    gridHeight: 24 * 64,
  };

  it('正常块按真实分钟定位', () => {
    expect(blockRenderRect('10:00', '11:00', g)).toEqual({ top: 640, height: 64 });
  });

  it('跨日块（结束早于开始）保持旧行为：20px 最小高度', () => {
    const r = blockRenderRect('23:00', '01:00', g)!;
    expect(r).not.toBeNull();
    expect(r!.top).toBeCloseTo(1472);
    expect(r!.height).toBe(20);
  });
});

describe('blockRenderRect — 折叠跨夜（23:00-07:00）', () => {
  const g = crossingGeometry();

  it('可见时段的块按折叠映射定位', () => {
    expect(blockRenderRect('10:00', '11:00', g)).toEqual({ top: 220, height: 64 });
  });

  it('⚡即时清单任务（23:36-23:46）贴网格底部可见，不被丢弃', () => {
    const r = blockRenderRect('23:36', '23:46', g)!;
    expect(r).not.toBeNull();
    expect(r!.top).toBeCloseTo(1032);
    expect(r!.height).toBe(20);
  });

  it('凌晨块（01:00-01:10）贴折叠条下方可见', () => {
    expect(blockRenderRect('01:00', '01:10', g)).toEqual({ top: 28, height: 20 });
  });

  it('起点在睡眠时段、终点可见（06:50-07:30）截取可见部分', () => {
    expect(blockRenderRect('06:50', '07:30', g)).toEqual({ top: 28, height: 32 });
  });

  it('起点可见、终点在睡眠时段（22:50-23:10）截止到网格底部', () => {
    const r = blockRenderRect('22:50', '23:10', g)!;
    expect(r!.top).toBeCloseTo(1041.33, 1);
    expect(r!.height).toBe(20); // 可见部分仅 10 分钟，取 20px 最小高度
  });

  it('起止都贴底部边界时（23:50-00:10）仍给 20px 收进网格内', () => {
    expect(blockRenderRect('23:50', '00:10', g)).toEqual({ top: 1032, height: 20 });
  });

  it('起点可见、终点贴顶（22:50-00:10）整体贴折叠条下方', () => {
    expect(blockRenderRect('22:50', '00:10', g)).toEqual({ top: 28, height: 20 });
  });

  it('恰好在睡眠开始边界（23:00-23:10）贴底部', () => {
    expect(blockRenderRect('23:00', '23:10', g)).toEqual({ top: 1032, height: 20 });
  });

  it('恰好在睡眠结束边界（00:00-00:10）贴顶部', () => {
    expect(blockRenderRect('00:00', '00:10', g)).toEqual({ top: 28, height: 20 });
  });
});

describe('blockRenderRect — 折叠不跨夜（03:00-06:00，罕见）', () => {
  const g = nonCrossingGeometry();

  it('可见时段的块按压缩映射定位', () => {
    expect(blockRenderRect('10:00', '11:00', g)).toEqual({ top: 476, height: 64 });
  });

  it('睡眠时段内的块贴折叠条下方可见', () => {
    expect(blockRenderRect('04:00', '04:30', g)).toEqual({ top: 28, height: 20 });
  });
});

describe('blockRenderRect — 非法时间', () => {
  const g = crossingGeometry();

  it('空字符串起点返回 null', () => {
    expect(blockRenderRect('', '23:46', g)).toBeNull();
  });

  it('空字符串终点返回 null', () => {
    expect(blockRenderRect('23:36', '', g)).toBeNull();
  });

  it('非时间格式返回 null', () => {
    expect(blockRenderRect('abc', '23:46', g)).toBeNull();
  });
});
