/** Small date helpers for the v2 shell. Local-time only, "YYYY-MM-DD" keys. */

export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;
export const WEEKDAY_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function dateObj(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function shiftDate(date: string, days: number): string {
  const d = dateObj(date);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** Monday-first week containing `date`. */
export function weekOf(date: string): string[] {
  const dow = dateObj(date).getDay();
  const monday = shiftDate(date, -((dow === 0 ? 7 : dow) - 1));
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

export function monthDay(date: string): string {
  const d = dateObj(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function weekdayName(date: string): string {
  return WEEKDAY_FULL[dateObj(date).getDay()];
}

export function yearMonth(date: string): string {
  const d = dateObj(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function shortDate(date: string): string {
  const d = dateObj(date);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function isToday(date: string): boolean {
  return date === todayKey();
}

/** "08:30" -> minutes from midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(1439, h * 60 + m));
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function durationLabel(start: string, end: string): string {
  const minutes = Math.max(0, timeToMinutes(end) - timeToMinutes(start));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

export function relativeDay(timestamp: number, now = Date.now()): string {
  const then = new Date(timestamp);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const diff = Math.round((start - day) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (diff > 2 && diff < 7) return `${diff} 天前`;
  return then.getFullYear() === today.getFullYear()
    ? `${then.getMonth() + 1}月${then.getDate()}日`
    : `${then.getFullYear()}年${then.getMonth() + 1}月${then.getDate()}日`;
}

/** Default semester start used when importing a timetable without one. */
export function mondayThisWeek(date = todayKey()): string {
  const d = dateObj(date);
  const dow = d.getDay();
  return shiftDate(date, -((dow === 0 ? 7 : dow) - 1));
}

export function addWeeks(date: string, weeks: number): string {
  return shiftDate(date, weeks * 7);
}
