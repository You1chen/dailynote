/**
 * 遗留问题的时间纯函数（无 React、无 IO）
 *
 * 关键约定：
 *   - 距今 / 具体日期 两种数字填法，保存时都折算成「起点时间戳」，历时由它算出
 *   - 文字填法（如"小时候"）不可量化，原样显示，不参与历时计算与排序
 */

import type { BacklogItem } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一周内新记/刚动过的不进气泡，避免刚记就被催 */
export const BADGE_GRACE_DAYS = 7;

/** 本地日期字符串 YYYY-MM-DD（不用 todayStr —— 那是 UTC） */
export function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 距今 N 年 M 月 D 日 → 起点时间戳。
 * 全为 0（或不填）时返回今天这一天的起点，即"起始就是今天"。
 * 先按年月回退（1 号起算避免月末溢出），再回退天数。
 */
export function startAtFromAge(years = 0, months = 0, days = 0, base = new Date()): number {
  const d = new Date(base.getTime());
  const y = Math.max(0, Math.trunc(Number(years) || 0));
  const m = Math.max(0, Math.trunc(Number(months) || 0));
  const dd = Math.max(0, Math.trunc(Number(days) || 0));
  if (y || m) {
    d.setDate(1);
    d.setFullYear(d.getFullYear() - y);
    d.setMonth(d.getMonth() - m);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(base.getDate(), lastDay));
  }
  d.setDate(d.getDate() - dd);
  return d.getTime();
}

/** 起点时间戳 → 距今 {年月日}（供编辑时回填三个输入框） */
export function ageFromStartAt(
  startAt: number,
  now = Date.now(),
): { years: number; months: number; days: number } {
  if (!Number.isFinite(startAt) || startAt > now) return { years: 0, months: 0, days: 0 };
  const a = new Date(startAt);
  const b = new Date(now);
  let years = b.getFullYear() - a.getFullYear();
  let months = b.getMonth() - a.getMonth();
  let days = b.getDate() - a.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(b.getFullYear(), b.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return { years: 0, months: 0, days: 0 };
  return { years, months, days };
}

/** 历时文案：距今 / 具体日期 都走这里 */
export function elapsedText(startAt: number | null, now = Date.now()): string {
  if (startAt == null || !Number.isFinite(startAt)) return '';
  const { years, months, days } = ageFromStartAt(startAt, now);
  if (years > 0 && months > 0) return `历时 ${years} 年 ${months} 个月`;
  if (years > 0) return `历时 ${years} 年`;
  if (months > 0) return `历时 ${months} 个月`;
  if (days > 0) return `历时 ${days} 天`;
  return '今天';
}

/** 卡片右上角显示的时间文案：文字填法原样显示，其余显示历时 */
export function backlogAgeText(item: BacklogItem, now = Date.now()): string {
  if (item.startMode === 'text') return (item.startText || '').trim() || '未填';
  return elapsedText(item.startAt, now);
}

/** 排序权重：起点越早（越久）越靠前；文字填法无法比较，排最后 */
export function backlogSortValue(item: BacklogItem): number {
  if (item.startMode === 'text' || item.startAt == null || !Number.isFinite(item.startAt)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return item.startAt;
}

/** 阻塞中按历时降序（久的在前），文字填法垫底 */
export function sortBacklog<T extends BacklogItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => backlogSortValue(a) - backlogSortValue(b) || a.createdAt - b.createdAt,
  );
}

/** 是否该进气泡：仍是阻塞中，且超过一周没动过 */
export function isBacklogDue(item: BacklogItem, now = Date.now()): boolean {
  return item.status === 'blocked' && now - item.updatedAt >= BADGE_GRACE_DAYS * DAY_MS;
}

/** 气泡数字：沉了一周以上的阻塞项条数 */
export function countBacklogBadge(items: BacklogItem[], now = Date.now()): number {
  return items.filter(i => isBacklogDue(i, now)).length;
}
