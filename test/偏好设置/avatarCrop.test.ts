/**
 * 头像裁剪纯函数测试
 *
 * 被测对象：src/utils/avatarCrop.ts 的 fitCoverScale / clampPan / zoomAround /
 * cropSourceRect（真实源码 import，AvatarCropper 组件直接调用它们）。
 *
 * 分工说明：renderAvatarToDataURL / downscaleImage 依赖 canvas，node 环境不可测，
 * 由真实浏览器端到端验证覆盖（导入图片 → 裁剪 → 确认落 localStorage）。
 */

import { describe, it, expect } from 'vitest';
import { fitCoverScale, clampPan, zoomAround, cropSourceRect } from '../../src/utils/avatarCrop';

const V = 280; // 视口边长

// ============ fitCoverScale ============

describe('fitCoverScale — 铺满视口的最小缩放', () => {
  it('横图 1600×900 → 以高为准', () => {
    expect(fitCoverScale(V, 1600, 900)).toBeCloseTo(280 / 900, 10);
  });

  it('竖图 900×1600 → 以宽为准', () => {
    expect(fitCoverScale(V, 900, 1600)).toBeCloseTo(280 / 900, 10);
  });

  it('方图 1000×1000', () => {
    expect(fitCoverScale(V, 1000, 1000)).toBeCloseTo(0.28, 10);
  });

  it('小图 100×50 → 放大到覆盖', () => {
    expect(fitCoverScale(V, 100, 50)).toBeCloseTo(5.6, 10);
  });
});

// ============ clampPan ============

describe('clampPan — 图片边缘不露进视口', () => {
  // 横图 1600×900，s = 280/900：rw = 1600*(280/900) ≈ 497.78 > 280；rh = 280
  const s = fitCoverScale(V, 1600, 900);

  it('居中合法值不变', () => {
    const x = (V - 1600 * s) / 2;
    const y = (V - 900 * s) / 2;
    const r = clampPan(x, y, s, V, 1600, 900);
    expect(r.x).toBeCloseTo(x, 10);
    expect(r.y).toBeCloseTo(y, 10);
  });

  it('正值越界 → 钳到 0（左/上边界）', () => {
    const r = clampPan(999, 999, s, V, 1600, 900);
    expect(r).toEqual({ x: 0, y: 0 });
  });

  it('负值越界 → 钳到 V-rw / V-rh（右/下边界）', () => {
    const r = clampPan(-9999, -9999, s, V, 1600, 900);
    expect(r.x).toBeCloseTo(V - 1600 * s, 10);
    expect(r.y).toBeCloseTo(V - 900 * s, 10);
  });

  it('某维度恰好等于视口 → 该维度唯一合法值为 0', () => {
    // 900×900 方图放大到 rh = 280：s = 280/900，rw = 280 恰好等于视口
    const s2 = fitCoverScale(V, 900, 900);
    const r = clampPan(50, -50, s2, V, 900, 900);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });
});

// ============ zoomAround ============

describe('zoomAround — 围绕视口点缩放像素不动', () => {
  it('围绕视口中心缩放：中心点映射不变', () => {
    const x = -100, y = -50, s = 0.5;
    const r = zoomAround(x, y, s, V / 2, V / 2, 0.8);
    // 中心点下图像坐标不变：(px - x)/s === (px - x')/s'
    expect((V / 2 - r.x) / 0.8).toBeCloseTo((V / 2 - x) / s, 10);
    expect((V / 2 - r.y) / 0.8).toBeCloseTo((V / 2 - y) / s, 10);
  });

  it('围绕任意点放大：该点下图像像素不动', () => {
    const x = -30, y = -20, s = 0.4, px = 87, py = 123;
    const r = zoomAround(x, y, s, px, py, 0.9);
    expect((px - r.x) / 0.9).toBeCloseTo((px - x) / s, 10);
    expect((py - r.y) / 0.9).toBeCloseTo((py - y) / s, 10);
  });

  it('缩小同样成立', () => {
    const x = -30, y = -20, s = 0.9, px = 87, py = 123;
    const r = zoomAround(x, y, s, px, py, 0.4);
    expect((px - r.x) / 0.4).toBeCloseTo((px - x) / s, 10);
    expect((py - r.y) / 0.4).toBeCloseTo((py - y) / s, 10);
  });
});

// ============ cropSourceRect ============

describe('cropSourceRect — 视口区域映射回原图坐标', () => {
  it('横图 1600×900 中心态：公式 sx=(w-V/s)/2', () => {
    const s = fitCoverScale(V, 1600, 900);
    const x = (V - 1600 * s) / 2;
    const y = (V - 900 * s) / 2;
    const r = cropSourceRect(x, y, s, V, 1600, 900);
    expect(r.sx).toBeCloseTo((1600 - V / s) / 2, 10);
    expect(r.sy).toBeCloseTo((900 - V / s) / 2, 10);
    expect(r.sw).toBeCloseTo(V / s, 10);
    expect(r.sh).toBeCloseTo(V / s, 10);
  });

  it('竖图 900×1600 中心态同理', () => {
    const s = fitCoverScale(V, 900, 1600);
    const x = (V - 900 * s) / 2;
    const y = (V - 1600 * s) / 2;
    const r = cropSourceRect(x, y, s, V, 900, 1600);
    expect(r.sx).toBeCloseTo((900 - V / s) / 2, 10);
    expect(r.sy).toBeCloseTo((1600 - V / s) / 2, 10);
  });

  it('往返映射：中心态下视口中心 ↔ 图像中心', () => {
    const s = fitCoverScale(V, 1600, 900);
    const x = (V - 1600 * s) / 2;
    const y = (V - 900 * s) / 2;
    const r = cropSourceRect(x, y, s, V, 1600, 900);
    expect(r.sx + r.sw / 2).toBeCloseTo(800, 10);
    expect(r.sy + r.sh / 2).toBeCloseTo(450, 10);
  });

  it('钳制后的角落状态：裁剪矩形完全落在原图内', () => {
    const s = fitCoverScale(V, 1600, 900) * 2; // 放大 2 倍后贴角落
    const c = clampPan(-9999, 9999, s, V, 1600, 900);
    const r = cropSourceRect(c.x, c.y, s, V, 1600, 900);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.sw).toBeLessThanOrEqual(1600 + 1e-9);
    expect(r.sy + r.sh).toBeLessThanOrEqual(900 + 1e-9);
  });

  it('随机模糊：100 组钳制区间内合法状态，裁剪矩形恒在原图内', () => {
    // 确定性伪随机（避免 Math.random 与测试平台差异）
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const sFit = fitCoverScale(V, 1600, 900);
    for (let i = 0; i < 100; i++) {
      const s = sFit + rand() * (4 * sFit - sFit);
      const c = clampPan(
        (rand() * 2 - 1) * 1000,
        (rand() * 2 - 1) * 1000,
        s, V, 1600, 900,
      );
      const r = cropSourceRect(c.x, c.y, s, V, 1600, 900);
      expect(r.sx).toBeGreaterThanOrEqual(-1e-9);
      expect(r.sy).toBeGreaterThanOrEqual(-1e-9);
      expect(r.sx + r.sw).toBeLessThanOrEqual(1600 + 1e-9);
      expect(r.sy + r.sh).toBeLessThanOrEqual(900 + 1e-9);
    }
  });

  it('小图放大到覆盖后中心态裁剪区域合法（sw = 原图短边）', () => {
    // 100×50 小图，sFit = 5.6：rw=560、rh=280（恰好等于视口），垂直无平移空间
    const s = fitCoverScale(V, 100, 50);
    const x = (V - 100 * s) / 2; // -140
    const y = (V - 50 * s) / 2;  // 0
    const r = cropSourceRect(x, y, s, V, 100, 50);
    expect(r.sx).toBeCloseTo(25, 10); // 水平居中：取中间 50px
    expect(r.sy).toBeCloseTo(0, 10);  // 垂直取满
    expect(r.sw).toBeCloseTo(50, 10);
    expect(r.sx + r.sw).toBeLessThanOrEqual(100 + 1e-9);
  });
});
