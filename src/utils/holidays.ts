// ============ 内置中国法定节假日（放假日期） ============
//
// 数据来源与维护说明：
// - 2026 年：按国务院办公厅公布的放假安排录入（精确）。
// - 2027 年：春节/清明/端午/中秋的农历日期可确定，放假区间为**推定**，待国务院公布后需更新。
// - 只收录「放假日期」（课程抑制）；调休上班日不内置（本应用不做「周六补周五课」的星期映射，
//   如学校在周末补课，请在课程表页手动添加「补课」特殊日期）。
// - 未知年份一律返回 false。

/** 生成 [start, start+days) 的连续日期字符串（本地时区） */
function range(start: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(start + 'T00:00:00');
  for (let i = 0; i < days; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${dd}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export const BUILTIN_HOLIDAYS: string[] = [
  // ---- 2026（国务院已公布） ----
  ...range('2026-01-01', 3), // 元旦 1/1-1/3
  ...range('2026-02-15', 9), // 春节 2/15-2/23
  ...range('2026-04-04', 3), // 清明 4/4-4/6
  ...range('2026-05-01', 5), // 劳动节 5/1-5/5
  ...range('2026-06-19', 3), // 端午 6/19-6/21
  ...range('2026-09-25', 3), // 中秋 9/25-9/27
  ...range('2026-10-01', 7), // 国庆 10/1-10/7
  // ---- 2027（推定，待国务院公布后校正） ----
  ...range('2027-01-01', 3), // 元旦 1/1-1/3
  ...range('2027-02-05', 7), // 春节 除夕2/5 - 初六2/11
  ...range('2027-04-03', 3), // 清明 4/3-4/5
  ...range('2027-05-01', 5), // 劳动节 5/1-5/5
  ...range('2027-06-09', 3), // 端午 6/9-6/11
  ...range('2027-09-15', 3), // 中秋 9/15-9/17
  ...range('2027-10-01', 7), // 国庆 10/1-10/7
];

/** 是否为内置法定节假日（放假） */
export function isBuiltinHoliday(dateStr: string): boolean {
  return BUILTIN_HOLIDAYS.includes(dateStr);
}
