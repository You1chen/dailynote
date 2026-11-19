export interface ImportedCourseRow {
  name: string;
  location: string;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
}

const DAY_MAP: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function time(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Parse pasted timetable lines such as "周一 08:00-09:40 高等数学 @教1-101". */
export function parseTimetableText(text: string): { rows: ImportedCourseRow[]; errors: string[] } {
  const rows: ImportedCourseRow[] = [];
  const errors: string[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const day = line.match(/(?:周|星期)([一二三四五六日天])/);
    const range = line.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (!day || !range) {
      errors.push(`第 ${index + 1} 行缺少星期或时间`);
      continue;
    }
    const dayOfWeek = DAY_MAP[day[1]];
    const startHour = Number(range[1]), startMinute = Number(range[2]);
    const endHour = Number(range[3]), endMinute = Number(range[4]);
    if (dayOfWeek === undefined || startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
      errors.push(`第 ${index + 1} 行星期或时间无效`);
      continue;
    }
    const startTime = time(startHour, startMinute);
    const endTime = time(endHour, endMinute);
    if (endTime <= startTime) {
      errors.push(`第 ${index + 1} 行结束时间必须晚于开始时间`);
      continue;
    }
    let rest = line.replace(day[0], '').replace(range[0], '').trim();
    rest = rest.replace(/^[|,\t]+/, '').trim();
    const [namePart, ...locationParts] = rest.split(/\s*[@|｜\t]\s*/);
    const name = namePart.trim();
    if (!name) {
      errors.push(`第 ${index + 1} 行缺少课程名`);
      continue;
    }
    rows.push({
      name,
      location: locationParts.join(' ').trim(),
      dayOfWeek: [dayOfWeek],
      startTime,
      endTime,
    });
  }
  return { rows, errors };
}
