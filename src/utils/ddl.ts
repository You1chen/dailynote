/**
 * DDL 截止时间计算（纯函数，本地时间语义）。
 * 注意：过期判断只能用 minutesUntilDeadline —— todayStr() 基于 UTC，
 * UTC+8 晚间会差一天。
 */
import { timeToMinutes } from './time';

/**
 * 距截止时间还有多少分钟（floor 到整数分钟；负值 = 已过期）。
 * 本地零点解析（与 courseSchedule.ts 的 parseLocal 一致，避免 UTC 偏移）。
 * 日期/时间格式或范围非法时返回 null（调用方显示「—」）。
 */
export function minutesUntilDeadline(
  ddl: { deadlineDate: string; deadlineTime: string },
  now: Date = new Date(),
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ddl.deadlineDate)) return null;
  // 时间可以不填：不填按当天 23:59 算（页面上不提示，保持克制）
  const time = (ddl.deadlineTime ?? '').trim() || DDL_DEFAULT_TIME;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  if (h > 23 || m > 59) return null; // 范围非法（如 25:00）
  const deadline = new Date(ddl.deadlineDate + 'T00:00:00');
  if (isNaN(deadline.getTime())) return null; // 范围非法日期（如 2026-13-40）
  deadline.setMinutes(deadline.getMinutes() + timeToMinutes(time));
  return Math.floor((deadline.getTime() - now.getTime()) / 60000);
}

/**
 * 剩余时间文案：<=0（含截止前最后 59 秒，floor 得 0）视为已过期，
 * 之后按分钟/小时/天逐级显示。
 */
export function ddlRemainText(minutes: number): string {
  if (minutes <= 0) return '已过期';
  if (minutes < 60) return `剩 ${minutes} 分钟`;
  if (minutes < 1440) return `剩 ${Math.floor(minutes / 60)} 小时`;
  return `剩 ${Math.floor(minutes / 1440)} 天`;
}

/** 时间未填时的默认截止时刻 */
export const DDL_DEFAULT_TIME = '23:59';

/** 「临近」阈值：一周（分钟） */
export const DDL_NEAR_MIN = 7 * 24 * 60;

/**
 * 侧栏红点：剩余不足一周的 DDL 条数（含已过期——过期更需要提醒）。
 * 格式非法的条目不计入。
 */
export function countDdlNear(
  ddls: { deadlineDate: string; deadlineTime: string }[],
  now: Date = new Date(),
): number {
  let n = 0;
  for (const d of ddls) {
    const m = minutesUntilDeadline(d, now);
    if (m !== null && m < DDL_NEAR_MIN) n++;
  }
  return n;
}

/** 「重要的事」的临近阈值：三天（分钟） */
export const IMPORTANT_NEAR_MIN = 3 * 24 * 60;

/** 「重要的事」过期后继续显示多久：一天（分钟），超过就收起来 */
export const IMPORTANT_KEEP_AFTER_MIN = 24 * 60;

/**
 * 把「带截止时间的事项」分成「还在显示」与「已收起来」两部分。
 * hideAfterMinutes 未给出时全部显示（DDL 的行为）；给出时，过期超过该时长的收进 hidden。
 * 时间非法的条目一律保留在 visible（不能因为解析失败就藏掉用户数据）。
 */
export function splitDeadlineItems<T extends { deadlineDate: string; deadlineTime: string }>(
  items: T[],
  now: Date = new Date(),
  hideAfterMinutes?: number,
): { visible: T[]; hidden: T[] } {
  if (hideAfterMinutes == null) return { visible: items, hidden: [] };
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const item of items) {
    const m = minutesUntilDeadline(item, now);
    if (m !== null && m < -hideAfterMinutes) hidden.push(item);
    else visible.push(item);
  }
  return { visible, hidden };
}

/** 侧栏红点：重要的事里剩余不足三天、且还没被收起来的条数 */
export function countImportantNear(
  items: { deadlineDate: string; deadlineTime: string }[],
  now: Date = new Date(),
): number {
  let n = 0;
  for (const d of items) {
    const m = minutesUntilDeadline(d, now);
    if (m !== null && m < IMPORTANT_NEAR_MIN && m > -IMPORTANT_KEEP_AFTER_MIN) n++;
  }
  return n;
}