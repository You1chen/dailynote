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
  if (!/^\d{2}:\d{2}$/.test(ddl.deadlineTime)) return null;
  const [h, m] = ddl.deadlineTime.split(':').map(Number);
  if (h > 23 || m > 59) return null; // 范围非法（如 25:00）
  const deadline = new Date(ddl.deadlineDate + 'T00:00:00');
  if (isNaN(deadline.getTime())) return null; // 范围非法日期（如 2026-13-40）
  deadline.setMinutes(deadline.getMinutes() + timeToMinutes(ddl.deadlineTime));
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
