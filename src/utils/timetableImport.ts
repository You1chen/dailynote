export interface ImportedCourseRow {
  name: string;
  location: string;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
}

const DAY_MAP: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function time(value: string): string {
  const [hour, minute] = value.split(/[:：]/).map(Number);
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
      dayOfWeek: [DAY_MAP[day[1]]],
      startTime: time(`${range[1]}:${range[2]}`),
      endTime: time(`${range[3]}:${range[4]}`),
    });
  }
  return { rows, errors };
}
