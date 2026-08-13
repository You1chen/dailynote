/** 将 "HH:mm" 转为当天分钟数 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 分钟数转 "HH:mm" */
export function minutesToTime(m: number): string {
  const hh = Math.floor(m / 60) % 24;
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 取整到最近10分钟 */
export function roundTo10(minutes: number): number {
  return Math.round(minutes / 10) * 10;
}

/**
 * 判断睡眠时段是否跨夜（sleepEnd < sleepStart）
 * 例如：sleepStart=23:00, sleepEnd=07:00 → 跨夜
 */
export function sleepCrossesMidnight(sleepStart: string, sleepEnd: string): boolean {
  return timeToMinutes(sleepEnd) < timeToMinutes(sleepStart);
}

/**
 * 判断给定分钟数是否在睡眠时段内
 */
export function isInSleepPeriod(minutes: number, sleepStart: string, sleepEnd: string): boolean {
  const s = timeToMinutes(sleepStart);
  const e = timeToMinutes(sleepEnd);
  if (e < s) {
    // 跨夜：23:00-07:00 → 分钟 >= s 或 分钟 < e
    return minutes >= s || minutes < e;
  } else {
    return minutes >= s && minutes < e;
  }
}

/**
 * 获取可见小时数（排除睡眠时段）
 */
export function getVisibleHours(sleepStart: string, sleepEnd: string): number {
  const s = timeToMinutes(sleepStart);
  const e = timeToMinutes(sleepEnd);
  if (e < s) {
    // 跨夜：睡眠 = (24:00 - s) + e 分钟
    const sleepMinutes = (1440 - s) + e;
    return 24 - Math.round(sleepMinutes / 60);
  } else {
    return 24 - Math.round((e - s) / 60);
  }
}

/**
 * 网格点击 → 网格内容坐标系 y（px）。
 *
 * @param clientY       事件 clientY（视口坐标）
 * @param containerTop  getBoundingClientRect().top —— 必须是滚动容器本身，
 *                      因为滚动容器的 top 不随内部滚动而变化
 * @param scrollTop     容器当前 scrollTop
 *
 * ⚠️ 不要传子元素（如 .time-grid）的 rect.top：
 * 子元素的 getBoundingClientRect().top 已经随滚动偏移，
 * 若再 +scrollTop 会双重补偿，导致点击映射偏移约 scrollTop 像素。
 */
export function gridClickY(clientY: number, containerTop: number, scrollTop: number): number {
  return clientY - containerTop + scrollTop;
}

/**
 * 睡眠时段的显示标签
 * 例如：sleepStart=23:00, sleepEnd=07:00 → "23:00 - 07:00"
 */
export function sleepLabel(sleepStart: string, sleepEnd: string): string {
  return sleepCrossesMidnight(sleepStart, sleepEnd)
    ? `${sleepStart} - ${sleepEnd}（次日）`
    : `${sleepStart} - ${sleepEnd}`;
}

// ============ 时间块渲染矩形 ============

/** 时间网格几何参数（与 DailyPlan / FullscreenSchedule 的 minutesToTop 一致） */
export interface BlockRectGeometry {
  hideSleep: boolean;
  sleepStart: string;
  sleepEnd: string;
  hourHeight: number;   // px/小时
  barHeight: number;    // 折叠条在映射中的偏移（两处均为 28）
  gridHeight: number;   // 网格总高（含折叠条）
}

/**
 * 计算时间块在（可能折叠睡眠时段的）时间网格中的渲染矩形 { top, height }。
 *
 * 旧行为：起止任一落入折叠睡眠时段就 return null 丢弃 —— 导致 ⚡即时 任务
 * （startTime=当前时刻）在睡眠时段创建后完全不可见。现改为贴到折叠窗口对应边界：
 * 跨夜时 23:00-24:00 贴网格底部、00:00-07:00 贴折叠条下方（非跨夜一律贴折叠条下方），
 * 块上时间标签仍显示真实起止时间。返回 null 表示时间非法（或理论上不可见）。
 */
export function blockRenderRect(
  startTime: string,
  endTime: string,
  g: BlockRectGeometry,
): { top: number; height: number } | null {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;

  const s = timeToMinutes(g.sleepStart);
  const e = timeToMinutes(g.sleepEnd);
  const crosses = e < s;

  // 分钟 → 网格 top（与两个视图组件内的 minutesToTop 同一公式）
  const map = (m: number): number => {
    if (!g.hideSleep) return (m / 60) * g.hourHeight;
    if (crosses) {
      return m >= e && m < s ? ((m - e) / 60) * g.hourHeight + g.barHeight : -1;
    }
    if (m < s) return (m / 60) * g.hourHeight + g.barHeight;
    if (m >= e) return ((m - (e - s)) / 60) * g.hourHeight + g.barHeight;
    return -1;
  };

  let top = map(startMin);
  let btm = map(endMin);

  if (g.hideSleep) {
    // 落入折叠时段的边贴边界：23:00-24:00 贴底部（离最后一小时最近），其余贴折叠条下方
    const bottomSide = (m: number) => crosses && m >= s;
    if (top < 0) top = bottomSide(startMin) ? g.gridHeight : g.barHeight;
    if (btm < 0) btm = bottomSide(endMin) ? g.gridHeight : g.barHeight;
    // 起止都贴到同一边界（整块在折叠时段内）：给 20px 最小高度，收进网格内
    if (btm <= top) {
      const atBottom = top >= g.gridHeight || btm >= g.gridHeight;
      top = atBottom ? g.gridHeight - 20 : g.barHeight;
      btm = top + 20;
    }
  }

  return { top, height: Math.max(20, btm - top) };
}
