/**
 * 时间网格点击映射测试
 *
 * 测试场景：折叠睡眠时段后，网格点击位置 → 时间 的映射是否准确。
 * 核心问题：点击的是 10:00 位置，是否会被错误映射为其他时间（如 01:00）？
 *
 * 两个被测对象：
 *   - DailyPlan.tsx   的 minutesToTop + handleGridClick 逆映射
 *   - FullscreenSchedule.tsx 的 minutesToTop + handleGridClick 逆映射
 */

import { describe, it, expect } from 'vitest';
// 真实源码里的坐标换算工具（唯一真正从源码 import 的被测对象）
import { gridClickY } from '../../src/utils/time';

// ============================================================
// 工具函数（从 src/utils/time.ts 复制）
// ============================================================
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ============================================================
// 被测函数：从 DailyPlan.tsx 提取的纯逻辑
// ============================================================

interface DailyPlanConfig {
  hideSleep: boolean;
  sleepStart: string;   // e.g. "23:00"
  sleepEnd: string;     // e.g. "07:00"
  hourHeight: number;   // e.g. 64
}

function makeDailyPlanConfig(overrides: Partial<DailyPlanConfig> = {}): DailyPlanConfig {
  return {
    hideSleep: true,
    sleepStart: '23:00',
    sleepEnd: '07:00',
    hourHeight: 64,
    ...overrides,
  };
}

/** DailyPlan.tsx 的 SLEEP_BAR_H */
function sleepBarH(c: DailyPlanConfig) {
  return c.hideSleep ? 28 : 0;
}

/** DailyPlan.tsx 的 minutesToTop — 正向映射：分钟数 → 网格 top px */
function dailyPlan_minutesToTop(minutes: number, c: DailyPlanConfig): number {
  if (!c.hideSleep) return (minutes / 60) * c.hourHeight;

  const s = timeToMinutes(c.sleepStart);
  const e = timeToMinutes(c.sleepEnd);
  const crosses = e < s;
  const barH = sleepBarH(c);

  if (crosses) {
    if (minutes >= e && minutes < s) {  // FIXED: < s (不含睡眠开始时刻)
      return ((minutes - e) / 60) * c.hourHeight + barH;
    }
    return -1;
  } else {
    if (minutes < s) return (minutes / 60) * c.hourHeight + barH;  // FIXED: 加上睡眠条偏移
    if (minutes >= e) return ((minutes - (e - s)) / 60) * c.hourHeight + barH;
    return -1;
  }
}

/** DailyPlan.tsx 的 handleGridClick — 逆向映射：网格 y px → 分钟数 */
function dailyPlan_gridClickToMinutes(y: number, c: DailyPlanConfig): number | null {
  const s = timeToMinutes(c.sleepStart);
  const e = timeToMinutes(c.sleepEnd);
  const crosses = e < s;
  const sleepDurationMin = crosses ? (1440 - s) + e : e - s;
  const barH = sleepBarH(c);

  let actualMinutes: number;

  if (c.hideSleep && crosses) {
    const adjustedY = y - barH;
    if (adjustedY < 0) return null;
    actualMinutes = (adjustedY * 60) / c.hourHeight + e;
    if (actualMinutes >= 1440) actualMinutes -= 1440;
    if (actualMinutes >= s) actualMinutes = s - 5;
  } else if (c.hideSleep) {
    // 不跨夜但隐藏睡眠
    const adjustedY = y - barH;
    if (adjustedY < 0) return null;
    actualMinutes = (adjustedY * 60) / c.hourHeight;
    // FIXED: 压缩空间中 >= s 意味着已越过睡眠间隙，直接加回 sleepDurationMin
    if (actualMinutes >= s) actualMinutes += sleepDurationMin;
  } else {
    actualMinutes = (y * 60) / c.hourHeight;
  }

  actualMinutes = Math.max(0, Math.min(1430, Math.round(actualMinutes / 5) * 5));
  return actualMinutes;
}

// ============================================================
// 被测函数：从 FullscreenSchedule.tsx 提取的纯逻辑
// ============================================================

/** FullscreenSchedule.tsx 的 minutesToTop — 正向映射 */
function fullscreen_minutesToTop(minutes: number, c: DailyPlanConfig): number {
  if (!c.hideSleep) return (minutes / 60) * c.hourHeight;

  const s = timeToMinutes(c.sleepStart);
  const e = timeToMinutes(c.sleepEnd);
  const crosses = e < s;
  const barH = 28; // FullscreenSchedule 硬编码 28

  if (crosses) {
    if (minutes >= e && minutes < s) {  // FIXED: < s
      return ((minutes - e) / 60) * c.hourHeight + barH;
    }
    return -1;
  } else {
    if (minutes < s) return (minutes / 60) * c.hourHeight + barH;  // FIXED
    if (minutes >= e) return ((minutes - (e - s)) / 60) * c.hourHeight + barH;
    return -1;
  }
}

/** FullscreenSchedule.tsx 的 handleGridClick — 逆向映射 */
function fullscreen_gridClickToMinutes(y: number, c: DailyPlanConfig): number | null {
  const s = timeToMinutes(c.sleepStart);
  const e = timeToMinutes(c.sleepEnd);
  const crosses = e < s;
  const sleepDurationMin = crosses ? (1440 - s) + e : e - s;
  const barH = 28; // 硬编码

  let actualMinutes: number;

  if (c.hideSleep) {
    const adjustedY = y - barH;
    if (adjustedY < 0) return null;

    if (crosses) {
      // FIXED: 跨夜与不跨夜分开处理
      actualMinutes = (adjustedY * 60) / c.hourHeight + e;
      if (actualMinutes >= 1440) actualMinutes -= 1440;
      if (actualMinutes >= s) actualMinutes = s - 5;
    } else {
      // 不跨夜：压缩空间中 >= s 意味着已越过睡眠间隙
      actualMinutes = (adjustedY * 60) / c.hourHeight;
      if (actualMinutes >= s) actualMinutes += sleepDurationMin;
    }
  } else {
    actualMinutes = (y * 60) / c.hourHeight;
  }

  actualMinutes = Math.max(0, Math.min(1430, Math.round(actualMinutes / 5) * 5));
  return actualMinutes;
}

// ============================================================
// 辅助：根据小时标签位置反推"用户点击该标签时应得的时间"
// ============================================================

/**
 * 计算某个整点小时标签在网格中的 top 位置。
 * 这是 getVisibleHourLabels 的逻辑。
 */
function hourLabelTop(hour: number, c: DailyPlanConfig): number | null {
  const s = timeToMinutes(c.sleepStart);
  const e = timeToMinutes(c.sleepEnd);
  const crosses = e < s;
  const sleepDurationMin = crosses ? (1440 - s) + e : e - s;
  const barH = sleepBarH(c);

  if (!c.hideSleep) {
    return hour * c.hourHeight;
  }

  if (crosses) {
    // 可见范围：e 到 s（如 07:00-23:00）
    const startH = Math.floor(e / 60);  // 7
    const endH = Math.floor(s / 60);    // 23
    // hour 必须在可见范围内
    if (hour === endH) {
      // 22:00 是最后一个可见小时; 23:00 不应该出现
      // 实际上 endH=23 不在可见范围（23:00开始睡眠）
    }
    // 简单判断：hour 从 startH 到 endH-1（含）
    if (hour >= startH && hour < endH) {
      const visualIndex = hour - startH;
      return barH + visualIndex * c.hourHeight;
    }
    // hour == endH 且正好等于 startH？比如 sleep 跨夜但只有一天
    return null;
  } else {
    // 不跨夜
    if (hour >= s / 60 && hour < e / 60) return null; // 在睡眠区
    const adjustedH = hour >= e / 60 ? hour - Math.round(sleepDurationMin / 60) : hour;  // FIXED: >=
    return barH + adjustedH * c.hourHeight;
  }
}

/** 根据标签 top 反推可见网格中的视觉序号 */
function topToVisualIndex(top: number, c: DailyPlanConfig): number {
  const barH = c.hideSleep ? 28 : 0;
  return (top - barH) / c.hourHeight;
}

// ============================================================
// 测试套件
// ============================================================

describe('时间网格点击映射 — 跨夜睡眠（默认 23:00-07:00）', () => {
  const defaultConfig = makeDailyPlanConfig({
    hideSleep: true,
    sleepStart: '23:00',
    sleepEnd: '07:00',
    hourHeight: 64,
  });

  // 测试用的小时点：从 07:00 到 22:00
  const visibleHours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

  describe('DailyPlan.tsx — 正向/逆向互逆性', () => {
    for (const h of visibleHours) {
      const minutes = h * 60;
      it(`整点 ${String(h).padStart(2, '0')}:00 — 正向→逆向应还原`, () => {
        const top = dailyPlan_minutesToTop(minutes, defaultConfig);
        expect(top).toBeGreaterThan(0); // 不应返回 -1

        const restored = dailyPlan_gridClickToMinutes(top, defaultConfig);
        expect(restored).not.toBeNull();
        // 允许 ±5 分钟的取整误差
        expect(Math.abs(restored! - minutes)).toBeLessThanOrEqual(5);
      });
    }

    it('点击 10:00 标签位置 → 应得到约 10:00', () => {
      const top = hourLabelTop(10, defaultConfig);
      expect(top).not.toBeNull();
      const result = dailyPlan_gridClickToMinutes(top!, defaultConfig);
      expect(result).not.toBeNull();
      const hour = Math.floor(result! / 60);
      expect(hour).toBe(10);
    });
  });

  describe('FullscreenSchedule.tsx — 正向/逆向互逆性', () => {
    for (const h of visibleHours) {
      const minutes = h * 60;
      it(`整点 ${String(h).padStart(2, '0')}:00 — 正向→逆向应还原`, () => {
        const top = fullscreen_minutesToTop(minutes, defaultConfig);
        expect(top).toBeGreaterThan(0);

        const restored = fullscreen_gridClickToMinutes(top, defaultConfig);
        expect(restored).not.toBeNull();
        expect(Math.abs(restored! - minutes)).toBeLessThanOrEqual(5);
      });
    }

    it('点击 10:00 标签位置 → 应得到约 10:00', () => {
      const top = hourLabelTop(10, defaultConfig);
      expect(top).not.toBeNull();
      const result = fullscreen_gridClickToMinutes(top!, defaultConfig);
      expect(result).not.toBeNull();
      const hour = Math.floor(result! / 60);
      expect(hour).toBe(10);
    });
  });
});

describe('时间网格点击映射 — 不跨夜睡眠（01:00-08:00）⚠️ 关键BUG场景', () => {
  const nonCrossConfig = makeDailyPlanConfig({
    hideSleep: true,
    sleepStart: '01:00',  // 凌晨1点
    sleepEnd: '08:00',    // 早上8点
    hourHeight: 64,
  });

  // 可见小时：00, 08-23
  const visibleHours = [0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

  describe('DailyPlan.tsx — 不跨夜正向/逆向', () => {
    for (const h of visibleHours) {
      const minutes = h * 60;
      it(`整点 ${String(h).padStart(2, '0')}:00 — 正向→逆向应还原`, () => {
        const top = dailyPlan_minutesToTop(minutes, nonCrossConfig);
        expect(top).toBeGreaterThan(0);

        const restored = dailyPlan_gridClickToMinutes(top, nonCrossConfig);
        expect(restored).not.toBeNull();
        // 允许 ±5 分钟取整误差
        expect(Math.abs(restored! - minutes)).toBeLessThanOrEqual(5);
      });
    }

    it('点击 10:00 标签位置 → 应得到约 10:00（不应被误判为睡眠时段）', () => {
      const top = hourLabelTop(10, nonCrossConfig);
      expect(top).not.toBeNull();
      const result = dailyPlan_gridClickToMinutes(top!, nonCrossConfig);
      // ★ 如果 result 为 null，说明被误判为睡眠时段 — 这就是 BUG！
      expect(result).not.toBeNull();
      if (result !== null) {
        const hour = Math.floor(result / 60);
        expect(hour).toBe(10);
      }
    });

    it('点击 00:00 标签位置 → 应得到约 00:00', () => {
      const top = hourLabelTop(0, nonCrossConfig);
      expect(top).not.toBeNull();
      const result = dailyPlan_gridClickToMinutes(top!, nonCrossConfig);
      expect(result).not.toBeNull();
      if (result !== null) {
        const hour = Math.floor(result / 60);
        expect(hour).toBe(0);
      }
    });

    it('点击 22:00 标签位置 → 应得到约 22:00', () => {
      const top = hourLabelTop(22, nonCrossConfig);
      expect(top).not.toBeNull();
      const result = dailyPlan_gridClickToMinutes(top!, nonCrossConfig);
      expect(result).not.toBeNull();
      if (result !== null) {
        const hour = Math.floor(result / 60);
        expect(hour).toBe(22);
      }
    });
  });

  describe('FullscreenSchedule.tsx — 不跨夜正向/逆向 ⚠️ 已知BUG', () => {
    for (const h of visibleHours) {
      const minutes = h * 60;
      it(`整点 ${String(h).padStart(2, '0')}:00 — 正向→逆向应还原`, () => {
        const top = fullscreen_minutesToTop(minutes, nonCrossConfig);
        expect(top).toBeGreaterThan(0);

        const restored = fullscreen_gridClickToMinutes(top, nonCrossConfig);
        expect(restored).not.toBeNull();
        // 允许 ±5 分钟取整误差
        expect(Math.abs(restored! - minutes)).toBeLessThanOrEqual(5);
      });
    }

    it('点击 10:00 标签位置 → 应得到约 10:00（不应偏移到 11:00）', () => {
      const top = hourLabelTop(10, nonCrossConfig);
      expect(top).not.toBeNull();
      const result = fullscreen_gridClickToMinutes(top!, nonCrossConfig);
      expect(result).not.toBeNull();
      if (result !== null) {
        const hour = Math.floor(result / 60);
        expect(hour).toBe(10);
      }
    });

    it('点击 00:00 标签位置 → 应得到约 00:00', () => {
      const top = hourLabelTop(0, nonCrossConfig);
      expect(top).not.toBeNull();
      const result = fullscreen_gridClickToMinutes(top!, nonCrossConfig);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(Math.floor(result / 60)).toBe(0);
      }
    });
  });
});

describe('时间网格点击映射 — 不同网格密度', () => {
  const densities = [
    { name: '紧凑 48px', hourHeight: 48 },
    { name: '标准 64px', hourHeight: 64 },
    { name: '宽松 80px', hourHeight: 80 },
  ];

  for (const d of densities) {
    describe(`密度: ${d.name}`, () => {
      const config = makeDailyPlanConfig({ hourHeight: d.hourHeight });

      it('DailyPlan: 所有可见小时正向→逆向互逆', () => {
        for (let h = 7; h <= 22; h++) {
          const top = dailyPlan_minutesToTop(h * 60, config);
          expect(top).toBeGreaterThan(0);
          const restored = dailyPlan_gridClickToMinutes(top, config);
          expect(restored).not.toBeNull();
          expect(Math.abs(restored! - h * 60)).toBeLessThanOrEqual(5);
        }
      });

      it('Fullscreen: 所有可见小时正向→逆向互逆', () => {
        for (let h = 7; h <= 22; h++) {
          const top = fullscreen_minutesToTop(h * 60, config);
          expect(top).toBeGreaterThan(0);
          const restored = fullscreen_gridClickToMinutes(top, config);
          expect(restored).not.toBeNull();
          expect(Math.abs(restored! - h * 60)).toBeLessThanOrEqual(5);
        }
      });
    });
  }
});

describe('标签位置与 minutesToTop 的一致性检查', () => {
  // 标签的 top 应当等于 minutesToTop 的结果
  // 否则渲染出来的时间块和标签会对不齐

  const configs = [
    { name: '跨夜 23-07', config: makeDailyPlanConfig() },
    { name: '不跨夜 01-08', config: makeDailyPlanConfig({ sleepStart: '01:00', sleepEnd: '08:00' }) },
    { name: '不跨夜 13-14', config: makeDailyPlanConfig({ sleepStart: '13:00', sleepEnd: '14:00' }) },
  ];

  for (const { name, config } of configs) {
    describe(`配置: ${name}`, () => {
      const allHours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

      for (const h of allHours) {
        const labelTop = hourLabelTop(h, config);
        if (labelTop === null) continue; // 该小时不可见

        it(`DailyPlan: 整点 ${String(h).padStart(2, '0')}:00 标签位置应 = minutesToTop`, () => {
          const forwardTop = dailyPlan_minutesToTop(h * 60, config);
          if (forwardTop < 0) return; // 睡眠时段
          expect(labelTop).toBe(forwardTop);
        });

        it(`Fullscreen: 整点 ${String(h).padStart(2, '0')}:00 标签位置应 = minutesToTop`, () => {
          const forwardTop = fullscreen_minutesToTop(h * 60, config);
          if (forwardTop < 0) return;
          expect(labelTop).toBe(forwardTop);
        });
      }
    });
  }
});

describe('边界情况', () => {
  it('不隐藏睡眠时，正向逆向应简单线性', () => {
    const config = makeDailyPlanConfig({ hideSleep: false });
    for (let h = 0; h < 24; h++) {
      const top = dailyPlan_minutesToTop(h * 60, config);
      expect(top).toBe(h * config.hourHeight);
      const restored = dailyPlan_gridClickToMinutes(top, config);
      expect(restored).toBe(h * 60);
    }
  });

  it('点击恰好在睡眠折叠条上 → 应返回 null（忽略）', () => {
    const config = makeDailyPlanConfig();
    // 睡眠条占据 top 0-28
    expect(dailyPlan_gridClickToMinutes(14, config)).toBeNull();
    expect(fullscreen_gridClickToMinutes(14, config)).toBeNull();
    expect(dailyPlan_gridClickToMinutes(0, config)).toBeNull();
  });

  it('跨夜睡眠：23:00 不可见（-1），07:00 可见', () => {
    const config = makeDailyPlanConfig();
    expect(dailyPlan_minutesToTop(23 * 60, config)).toBe(-1);
    expect(dailyPlan_minutesToTop(7 * 60, config)).toBeGreaterThan(0);
    expect(fullscreen_minutesToTop(23 * 60, config)).toBe(-1);
    expect(fullscreen_minutesToTop(7 * 60, config)).toBeGreaterThan(0);
  });

  it('跨夜睡眠：visibleHours 计算正确', () => {
    const config = makeDailyPlanConfig(); // 23:00-07:00 = 8h sleep → 16h visible
    const s = timeToMinutes(config.sleepStart);
    const e = timeToMinutes(config.sleepEnd);
    const sleepDurationMin = (1440 - s) + e; // 120 + 420 = 540 min = 9h
    // 实际上是 (24:00-23:00) + (07:00-00:00) = 1 + 7 = 8h
    // sleepDurationMin = (1440-1380) + 420 = 60 + 420 = 480 min = 8h
    const visibleHours = 24 - Math.round(sleepDurationMin / 60);
    expect(visibleHours).toBe(16);
  });
});

describe('真实手指点击路径 — 坐标换算层回归测试', () => {
  // 这是原测试缺失的关键一层：之前的测试只把"理想 top"直接喂给反函数，
  // 完全绕过真实 handleGridClick 的第一步：
  //   y = e.clientY - rect.top + scrollTop
  //
  // 真实 DOM 几何：
  //   .time-grid 是滚动容器（scrollRef）的第一个子元素，
  //   滚动 scrollTop 后，网格自身 getBoundingClientRect().top = containerTop - scrollTop。
  //   点击网格内容坐标 contentY 的点 → 浏览器里 clientY = containerTop - scrollTop + contentY。
  //
  // 正确写法（修复后）：rect 取滚动容器 → y = clientY - containerTop + scrollTop = contentY
  // 错误写法（修复前）：rect 取网格自身再 +scrollTop → y = contentY + scrollTop（双重补偿）

  function clientYForContent(containerTop: number, scrollTop: number, contentY: number): number {
    return containerTop - scrollTop + contentY;
  }

  const scenarios = [
    { name: '跨夜 23-07', config: makeDailyPlanConfig() },
    { name: '不跨夜 01-08', config: makeDailyPlanConfig({ sleepStart: '01:00', sleepEnd: '08:00' }) },
  ];

  for (const { name, config } of scenarios) {
    describe(name, () => {
      for (const scrollTop of [0, 200, 440, 800]) {
        it(`滚动 ${scrollTop}px 后点击可见 15:00 行 → 应映射回 15 点`, () => {
          const containerTop = 100;
          const h = 15;
          const labelTop = hourLabelTop(h, config)!;
          expect(labelTop).not.toBeNull();
          const contentY = labelTop + 20; // 点在行内 20px 处
          const clientY = clientYForContent(containerTop, scrollTop, contentY);

          // 修复后的真实链路：rect 取滚动容器
          const y = gridClickY(clientY, containerTop, scrollTop);
          expect(y).toBeCloseTo(contentY, 6);

          const result = dailyPlan_gridClickToMinutes(y, config);
          expect(result).not.toBeNull();
          expect(Math.floor(result! / 60)).toBe(h);
        });
      }

      it('回归防线：若误用网格自身 rect（top 已含滚动）再 +scrollTop，会偏移约 scrollTop 像素', () => {
        const containerTop = 100;
        const scrollTop = 440;
        const h = 15;
        const labelTop = hourLabelTop(h, config)!;
        const contentY = labelTop + 20;
        const clientY = clientYForContent(containerTop, scrollTop, contentY);

        // 修复前：e.currentTarget 是 .time-grid，其 rect.top = containerTop - scrollTop
        const gridRectTop = containerTop - scrollTop;
        const buggyY = clientY - gridRectTop + scrollTop;
        expect(buggyY).toBe(contentY + scrollTop); // 双重补偿，正是 bug 特征

        const buggyResult = dailyPlan_gridClickToMinutes(buggyY, config);
        // 结果不应落在正确小时
        expect(Math.floor(buggyResult! / 60)).not.toBe(h);
      });
    });
  }
});

describe('FullscreenSchedule 不跨夜场景的详细追踪', () => {
  // 这是最可能出 BUG 的场景：
  // sleep 01:00-08:00，点击 10:00 标签位置
  const config = makeDailyPlanConfig({
    sleepStart: '01:00',
    sleepEnd: '08:00',
  });

  it('追踪：10:00 标签的 top → click 反算 → 得到的小时', () => {
    const labelTop = hourLabelTop(10, config);
    console.log('10:00 标签 top:', labelTop);

    // Fullscreen 的逆向映射
    const fsResult = fullscreen_gridClickToMinutes(labelTop!, config);
    console.log('Fullscreen 反算结果:', fsResult, fsResult !== null ? `${Math.floor(fsResult / 60)}:${String(fsResult % 60).padStart(2, '0')}` : 'null');

    // DailyPlan 的逆向映射
    const dpResult = dailyPlan_gridClickToMinutes(labelTop!, config);
    console.log('DailyPlan 反算结果:', dpResult, dpResult !== null ? `${Math.floor(dpResult / 60)}:${String(dpResult % 60).padStart(2, '0')}` : 'null');
  });

  it('追踪：所有可见小时的 Fullscreen 反算', () => {
    const hours = [0, 8, 9, 10, 11, 12, 20, 22, 23];
    for (const h of hours) {
      const labelTop = hourLabelTop(h, config);
      if (labelTop === null) continue;
      const result = fullscreen_gridClickToMinutes(labelTop, config);
      const resultHour = result !== null ? Math.floor(result / 60) : null;
      console.log(`标签 ${h}:00 (top=${labelTop}) → Fullscreen 反算: ${resultHour}:00 (${result}min)`);
    }
  });
});
