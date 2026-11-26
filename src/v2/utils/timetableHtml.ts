export interface ParsedCourseRow {
  name: string;
  teacher?: string;
  location?: string;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  startWeek?: number;
  weekCount?: number;
  weekType?: 'all' | 'odd' | 'even';
}

export interface TimetableParseResult {
  rows: ParsedCourseRow[];
  warnings: string[];
}

/** Default times for 第1节..第12节 (45-minute periods with breaks). */
export const DEFAULT_PERIOD_TIMES: readonly { start: string; end: string }[] = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' },
  { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' },
  { start: '16:55', end: '17:40' },
  { start: '19:00', end: '19:45' },
  { start: '19:55', end: '20:40' },
  { start: '20:50', end: '21:35' },
  { start: '21:45', end: '22:30' },
];

interface RawCell {
  text: string;
  rowspan: number;
  colspan: number;
}

type GridCell = RawCell | undefined;
type Grid = GridCell[][];

interface HeaderInfo {
  rowIndex: number;
  dayByCol: Map<number, number>;
  dayCount: number;
}

interface ParsedTable {
  grid: Grid;
  header?: HeaderInfo;
  contentCells: number;
}

interface ParsedCourseParts {
  name: string;
  teacher: string;
  location: string;
  startTime?: string;
  endTime?: string;
  startWeek?: number;
  weekCount?: number;
  weekType?: 'all' | 'odd' | 'even';
}

interface WeekInfo {
  text: string;
  startWeek?: number;
  weekCount?: number;
  weekType?: 'all' | 'odd' | 'even';
}

interface ClockRange {
  start: string;
  end: string;
  matched: string;
}

interface PeriodRange {
  start: string;
  end: string;
  matched: string;
}

interface RowCandidate {
  row: ParsedCourseRow;
  gridRow: number;
  column: number;
}

const DAY_BY_CHAR = new Map<string, number>([
  ['一', 1],
  ['二', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['日', 0],
  ['天', 0],
]);

const ENGLISH_DAY_BY_PREFIX = new Map<string, number>([
  ['mon', 1],
  ['tue', 2],
  ['wed', 3],
  ['thu', 4],
  ['fri', 5],
  ['sat', 6],
  ['sun', 0],
]);

const NAMED_ENTITIES = new Map<string, string>([
  ['nbsp', ' '],
  ['ensp', ' '],
  ['emsp', ' '],
  ['thinsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

const CLOCK_RANGE_RE = /(\d{1,2})\s*[:：]\s*(\d{2})\s*[-–—－~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/;
const LOCATION_MARKER_RE = /教|实验|室|馆|场|楼|园|区|号|机房|操场/;
const TEACHER_SUFFIX_RE = /(?:老师|教师|教授)$/;
const SHORT_CJK_RE = /^[\u4e00-\u9fff·]{2,8}$/;
const PLACEHOLDER_RE = /^(?:无|没有|无课|空|空闲|休息|午休|晚休|--|-|—|–|－|n\/a|none|·|\.)$/i;

function stripCommentsAndScripts(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
}

function collectTableBlocks(html: string): string[] {
  const blocks: string[] = [];
  const stack: number[] = [];
  const tagRe = /<\/?table\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith('</')) {
      const innerStart = stack.pop();
      if (innerStart !== undefined) blocks.push(html.slice(innerStart, match.index));
    } else {
      stack.push(tagRe.lastIndex);
    }
  }
  for (const innerStart of stack) {
    const tail = html.slice(innerStart);
    if (tail.trim()) blocks.push(tail);
  }
  return blocks;
}

function stripNestedTables(content: string): string {
  let result = '';
  let depth = 0;
  let lastIndex = 0;
  const tagRe = /<\/?table\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(content))) {
    if (depth === 0) result += content.slice(lastIndex, match.index);
    if (match[0].startsWith('</')) {
      if (depth > 0) depth -= 1;
    } else {
      depth += 1;
    }
    lastIndex = tagRe.lastIndex;
  }
  if (depth === 0) result += content.slice(lastIndex);
  return result;
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole: string, entity: string) => {
    if (entity.startsWith('#')) {
      const hexadecimal = entity[1] !== undefined && entity[1].toLowerCase() === 'x';
      const digits = entity.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES.get(entity.toLowerCase()) ?? whole;
  });
}

function htmlFragmentToText(fragment: string): string {
  // Raw newlines that merely separate tags are source formatting. Newlines
  // inside text content are kept as line breaks; <br> and block tags also
  // become line breaks through markers so source whitespace can be collapsed.
  let text = fragment.replace(/\r\n?/g, '\n');
  text = text.replace(/>[ \t]*\n/g, '> ').replace(/\n[ \t]*(?=<)/g, ' ');
  text = text
    .replace(/<br\s*\/?>/gi, '\u0000')
    .replace(/<\/?(?:p|div|li|h[1-6]|section|article|header|footer|ul|ol|tr|td|th|table)\b[^>]*>/gi, '\u0001')
    .replace(/<hr\b[^>]*\/?>/gi, '\u0001');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/[ \t\f\v]+/g, ' ');
  text = text.replace(/\u0001(?: *\u0001)+/g, '\u0001');
  text = text.replace(/\u0000/g, '\n').replace(/\u0001/g, '\n');
  text = text.replace(/[ \t]*\n[ \t]*/g, '\n');
  text = decodeEntities(text).replace(/\u00a0/g, ' ').replace(/\u3000/g, ' ');
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

function readSpan(attributes: string, name: 'rowspan' | 'colspan'): number {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"\\s*(\\d+)\\s*"|'\\s*(\\d+)\\s*'|(\\d+))`, 'i'));
  if (!match) return 1;
  const value = Number(match[1] ?? match[2] ?? match[3]);
  return Number.isFinite(value) && value > 1 ? Math.min(Math.floor(value), 100) : 1;
}

function parseCells(rowHtml: string): RawCell[] {
  const cells: RawCell[] = [];
  const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRe.exec(rowHtml))) {
    const attributes = match[2] ?? '';
    cells.push({
      text: htmlFragmentToText(match[3] ?? ''),
      rowspan: readSpan(attributes, 'rowspan'),
      colspan: readSpan(attributes, 'colspan'),
    });
  }
  return cells;
}

function buildGrid(content: string): Grid {
  const grid: Grid = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  let match: RegExpExecArray | null;
  let rowIndex = 0;
  while ((match = rowRe.exec(content))) {
    const currentIndex = rowIndex;
    while (grid.length <= currentIndex) grid.push([]);
    const cells = parseCells(match[1] ?? '');
    const current = grid[currentIndex];
    rowIndex += 1;
    let column = 0;
    for (const cell of cells) {
      while (current[column] !== undefined) column += 1;
      for (let dr = 0; dr < cell.rowspan; dr += 1) {
        const targetRow = currentIndex + dr;
        while (grid.length <= targetRow) grid.push([]);
        const target = grid[targetRow];
        for (let dc = 0; dc < cell.colspan; dc += 1) {
          const targetColumn = column + dc;
          if (target[targetColumn] === undefined) target[targetColumn] = cell;
        }
      }
      column += cell.colspan;
    }
  }
  return grid;
}

function parseDayHeader(text: string): number | undefined {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return undefined;
  const chinese = compact.match(/(?:星期|礼拜|周)([一二三四五六日天])/);
  if (chinese) return DAY_BY_CHAR.get(chinese[1]);
  const bare = compact.match(/^([一二三四五六日天])$/);
  if (bare) return DAY_BY_CHAR.get(bare[1]);
  const english = compact.match(/^(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i);
  if (english) return ENGLISH_DAY_BY_PREFIX.get(english[1].slice(0, 3).toLowerCase());
  return undefined;
}

function findHeader(grid: Grid): HeaderInfo | undefined {
  let best: HeaderInfo | undefined;
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    if (!row) continue;
    const dayByCol = new Map<number, number>();
    const coveredColumns = new Set<number>();
    for (let column = 0; column < row.length; column += 1) {
      if (coveredColumns.has(column)) continue;
      const cell = row[column];
      if (!cell) continue;
      const day = parseDayHeader(cell.text);
      for (let dc = 0; dc < cell.colspan; dc += 1) {
        coveredColumns.add(column + dc);
        if (day !== undefined && !dayByCol.has(column + dc)) dayByCol.set(column + dc, day);
      }
    }
    const dayCount = new Set(dayByCol.values()).size;
    if (dayCount === 0) continue;
    if (!best || dayCount > best.dayCount) {
      best = { rowIndex, dayByCol, dayCount };
    }
  }
  return best;
}

function firstDayColumn(header: HeaderInfo): number {
  let first = Number.POSITIVE_INFINITY;
  for (const column of header.dayByCol.keys()) first = Math.min(first, column);
  return Number.isFinite(first) ? first : 0;
}

function isPlaceholderText(text: string): boolean {
  const compact = text.replace(/[\s\u200b\ufeff]/g, '');
  return compact === '' || PLACEHOLDER_RE.test(compact);
}

function analyzeTable(inner: string): ParsedTable {
  const grid = buildGrid(stripNestedTables(inner));
  const header = findHeader(grid);
  let contentCells = 0;
  if (header) {
    for (let rowIndex = header.rowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex];
      if (!row) continue;
      for (const column of header.dayByCol.keys()) {
        const cell = row[column];
        if (cell && !isPlaceholderText(cell.text)) contentCells += 1;
      }
    }
  }
  return { grid, header, contentCells };
}

function tableScore(table: ParsedTable, header: HeaderInfo): number {
  const tier = header.dayCount >= 3 ? 1 : 0;
  return tier * 1_000_000 + Math.min(table.contentCells, 9999) * 100 + header.dayCount;
}

function selectTable(tables: ParsedTable[], warnings: string[]): (ParsedTable & { header: HeaderInfo }) | undefined {
  const withHeader = tables.filter((table): table is ParsedTable & { header: HeaderInfo } => table.header !== undefined);
  if (!withHeader.length) {
    warnings.push('未识别到星期表头');
    return undefined;
  }
  withHeader.sort((a, b) => tableScore(b, b.header) - tableScore(a, a.header));
  const best = withHeader[0];
  if (best.header.dayCount < 3) {
    warnings.push(`星期表头不完整，仅识别到 ${best.header.dayCount} 天`);
  }
  return best;
}

function toClock(hour: number, minute: number): string | undefined {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function extractClockRange(text: string): ClockRange | undefined {
  const match = CLOCK_RANGE_RE.exec(text);
  if (!match) return undefined;
  const start = toClock(Number(match[1]), Number(match[2]));
  const end = toClock(Number(match[3]), Number(match[4]));
  if (!start || !end || end <= start) return undefined;
  return { start, end, matched: match[0] };
}

function hasClockRange(text: string): boolean {
  return CLOCK_RANGE_RE.test(text);
}

function clampPeriod(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(DEFAULT_PERIOD_TIMES.length, Math.max(1, Math.floor(value)));
}

function periodRange(match: RegExpMatchArray): PeriodRange {
  const first = clampPeriod(Number(match[1]));
  const second = clampPeriod(match[2] !== undefined ? Number(match[2]) : Number(match[1]));
  const startIndex = Math.min(first, second);
  const endIndex = Math.max(first, second);
  return {
    start: DEFAULT_PERIOD_TIMES[startIndex - 1].start,
    end: DEFAULT_PERIOD_TIMES[endIndex - 1].end,
    matched: match[0],
  };
}

function extractPeriodRange(text: string): PeriodRange | undefined {
  const patterns: RegExp[] = [
    /第\s*(\d{1,2})\s*[-–—－~～至]\s*第?\s*(\d{1,2})\s*节/,
    /第\s*(\d{1,2})\s*节\s*[-–—－~～至]\s*第?\s*(\d{1,2})\s*节/,
    /(\d{1,2})\s*[-–—－~～至]\s*(\d{1,2})\s*节/,
    /(\d{1,2})\s*[、,，]\s*(\d{1,2})\s*节/,
    /第\s*(\d{1,2})\s*节/,
    /(\d{1,2})\s*节/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return periodRange(match);
  }
  const bare = text.replace(/\s+/g, '').match(/^(\d{1,2})(?:[-–—－~～至](\d{1,2}))?$/);
  if (bare) return periodRange(bare);
  return undefined;
}

function inferPeriodsPerRow(rowCount: number): number {
  if (rowCount >= 5 && rowCount <= 6) return 2;
  if (rowCount >= 10 && rowCount <= 14) return 1;
  return 2;
}

function inferRowTime(rowIndex: number, rowCount: number): { start: string; end: string } {
  const periodsPerRow = inferPeriodsPerRow(rowCount);
  const startIndex = Math.min(DEFAULT_PERIOD_TIMES.length, rowIndex * periodsPerRow + 1);
  const endIndex = Math.min(DEFAULT_PERIOD_TIMES.length, startIndex + periodsPerRow - 1);
  return {
    start: DEFAULT_PERIOD_TIMES[startIndex - 1].start,
    end: DEFAULT_PERIOD_TIMES[endIndex - 1].end,
  };
}

function rowLabelText(grid: Grid, rowIndex: number, firstDayCol: number): string {
  const row = grid[rowIndex];
  if (!row) return '';
  const parts: string[] = [];
  for (let column = 0; column < firstDayCol; column += 1) {
    const text = row[column]?.text;
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(' ');
}

function resolveRowTime(
  label: string,
  gridRow: number,
  headerRow: number,
  dataRowCount: number,
  warnings: string[],
): { start: string; end: string } | undefined {
  if (label) {
    const clock = extractClockRange(label);
    if (clock) return { start: clock.start, end: clock.end };
    if (hasClockRange(label)) {
      warnings.push(`第${gridRow + 1}行时间无效，已跳过`);
      return undefined;
    }
    const period = extractPeriodRange(label);
    if (period) return { start: period.start, end: period.end };
  }
  return inferRowTime(Math.max(0, gridRow - headerRow - 1), dataRowCount);
}

function extractWeekInfo(input: string): WeekInfo {
  let text = input;
  let minWeek: number | undefined;
  let maxWeek: number | undefined;

  const noteWeeks = (first: number, second: number): void => {
    const lower = Math.min(first, second);
    const upper = Math.max(first, second);
    if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower < 1 || upper > 60) return;
    minWeek = minWeek === undefined ? lower : Math.min(minWeek, lower);
    maxWeek = maxWeek === undefined ? upper : Math.max(maxWeek, upper);
  };

  text = text.replace(/(?:第\s*)?(\d{1,2})\s*[-–—－~～至]\s*(\d{1,2})\s*周/g, (_whole: string, first: string, second: string) => {
    noteWeeks(Number(first), Number(second));
    return ' ';
  });
  text = text.replace(/(\d{1,2}(?:\s*[,，、]\s*\d{1,2})+)\s*周/g, (_whole: string, list: string) => {
    const values = list
      .split(/[,，、]/)
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 60);
    if (values.length) noteWeeks(Math.min(...values), Math.max(...values));
    return ' ';
  });
  text = text.replace(/(?:第\s*)?(\d{1,2})\s*周/g, (_whole: string, week: string) => {
    noteWeeks(Number(week), Number(week));
    return ' ';
  });

  let weekType: 'all' | 'odd' | 'even' | undefined;
  if (/单周|双周/.test(input)) {
    weekType = /单周/.test(input) ? 'odd' : 'even';
    text = text.replace(/单周|双周/g, ' ');
  } else if (/[（(]\s*[单双]\s*[)）]/.test(input)) {
    weekType = /[（(]\s*单\s*[)）]/.test(input) ? 'odd' : 'even';
    text = text.replace(/[（(]\s*[单双]\s*[)）]/g, ' ');
  } else if (minWeek !== undefined) {
    weekType = 'all';
  }

  text = text.replace(/[（(]\s*[)）]/g, ' ');
  const info: WeekInfo = { text };
  if (minWeek !== undefined && maxWeek !== undefined) {
    info.startWeek = minWeek;
    info.weekCount = maxWeek - minWeek + 1;
  }
  if (weekType !== undefined) info.weekType = weekType;
  return info;
}

function cleanCourseName(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d{1,2}[.、)）]\s*/, '')
    .replace(/^[\s*·•\-—]+/, '')
    .trim();
}

function cleanLocation(value: string): string {
  return value.replace(/^[@＠\s]+/, '').replace(/[，,;；|｜\s]+$/, '').trim();
}

function looksLikeLocationToken(text: string): boolean {
  const value = text.replace(/^[@＠]+/, '');
  if (!value) return false;
  if (LOCATION_MARKER_RE.test(value)) return true;
  return /^[A-Za-z]?\d{1,3}\s*[-－–—]\s*\d{3,4}$/.test(value);
}

function looksLikeTeacherToken(text: string): boolean {
  return text.length <= 12 && TEACHER_SUFFIX_RE.test(text);
}

interface TextToken {
  text: string;
  onlyOnLine: boolean;
}

function mergeTeacherTokens(tokens: TextToken[]): TextToken[] {
  const merged: TextToken[] = [];
  for (const token of tokens) {
    const previous = merged[merged.length - 1];
    if (previous && /^(?:老师|教师|教授)$/.test(token.text) && /^[\u4e00-\u9fff·]{1,6}$/.test(previous.text)) {
      previous.text += token.text;
    } else {
      merged.push({ ...token });
    }
  }
  return merged;
}

function parseCourseChunk(raw: string): ParsedCourseParts {
  let text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return { name: '', teacher: '', location: '' };

  const week = extractWeekInfo(text);
  text = week.text;

  let startTime: string | undefined;
  let endTime: string | undefined;
  const clock = extractClockRange(text);
  if (clock) {
    startTime = clock.start;
    endTime = clock.end;
    text = text.replace(clock.matched, ' ');
  }

  const locationParts: string[] = [];
  const pieces: string[] = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine;
    const atIndex = line.search(/[@＠]/);
    if (atIndex >= 0) {
      const atLocation = line.slice(atIndex + 1).trim();
      if (atLocation) locationParts.push(atLocation);
      line = line.slice(0, atIndex);
    }
    line = line.replace(/[|｜,，\t]+/g, '\n');
    for (const piece of line.split('\n')) {
      const value = piece.replace(/[ \t\f\v]+/g, ' ').trim();
      if (value) pieces.push(value);
    }
  }

  const tokens: TextToken[] = [];
  for (const piece of pieces) {
    const parts = piece.split(' ').filter(Boolean);
    if (parts.length === 1) {
      tokens.push({ text: parts[0], onlyOnLine: true });
    } else {
      for (const part of parts) tokens.push({ text: part, onlyOnLine: false });
    }
  }

  const nameParts: string[] = [];
  let teacher = '';
  let nameStarted = false;
  for (const token of mergeTeacherTokens(tokens)) {
    if (looksLikeTeacherToken(token.text) && nameStarted) {
      if (!teacher) teacher = token.text;
      continue;
    }
    if (looksLikeLocationToken(token.text) && nameStarted) {
      locationParts.push(token.text);
      continue;
    }
    if (!nameStarted) {
      nameParts.push(token.text);
      nameStarted = true;
      continue;
    }
    if (token.onlyOnLine && !teacher && SHORT_CJK_RE.test(token.text)) {
      teacher = token.text;
      continue;
    }
    nameParts.push(token.text);
  }

  const name = cleanCourseName(nameParts.join(' '));
  const location = cleanLocation([...new Set(locationParts.map(cleanLocation).filter(Boolean))].join(''));
  const result: ParsedCourseParts = { name, teacher, location };
  if (startTime && endTime) {
    result.startTime = startTime;
    result.endTime = endTime;
  }
  if (week.startWeek !== undefined) result.startWeek = week.startWeek;
  if (week.weekCount !== undefined) result.weekCount = week.weekCount;
  if (week.weekType !== undefined) result.weekType = week.weekType;
  return result;
}

function splitCourseChunks(text: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const value = current.join('\n').trim();
    if (value) chunks.push(value);
    current = [];
  };
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/[ \t\f\v]+/g, ' ').trim();
    if (line) current.push(line);
    else flush();
  }
  flush();
  return chunks;
}

function courseMergeKey(row: ParsedCourseRow): string {
  return [row.name, row.teacher ?? '', row.location ?? ''].join('\u0001');
}

function mergeAdjacentCandidates(candidates: RowCandidate[]): ParsedCourseRow[] {
  const groups = new Map<string, RowCandidate[]>();
  for (const candidate of candidates) {
    const day = candidate.row.dayOfWeek[0] ?? 0;
    const key = `${day}:${candidate.column}`;
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  const rows: ParsedCourseRow[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.gridRow - b.gridRow);
    const lastByKey = new Map<string, RowCandidate>();
    for (const candidate of group) {
      const key = courseMergeKey(candidate.row);
      const last = lastByKey.get(key);
      if (last && candidate.gridRow === last.gridRow + 1) {
        last.row.endTime = candidate.row.endTime;
        last.gridRow = candidate.gridRow;
      } else {
        const copy: RowCandidate = {
          row: { ...candidate.row },
          gridRow: candidate.gridRow,
          column: candidate.column,
        };
        rows.push(copy.row);
        lastByKey.set(key, copy);
      }
    }
  }
  return rows;
}

function courseRowKey(row: ParsedCourseRow): string {
  return [
    row.name,
    row.teacher ?? '',
    row.location ?? '',
    row.dayOfWeek.join(','),
    row.startTime,
    row.endTime,
    row.startWeek ?? '',
    row.weekCount ?? '',
    row.weekType ?? '',
  ].join('\u0001');
}

function normalizeRows(rows: ParsedCourseRow[]): ParsedCourseRow[] {
  const seen = new Set<string>();
  const unique: ParsedCourseRow[] = [];
  for (const row of rows) {
    const key = courseRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...row, dayOfWeek: [row.dayOfWeek[0] ?? 0] });
  }
  unique.sort((a, b) => {
    const dayDiff = (a.dayOfWeek[0] ?? 0) - (b.dayOfWeek[0] ?? 0);
    if (dayDiff !== 0) return dayDiff;
    if (a.startTime < b.startTime) return -1;
    if (a.startTime > b.startTime) return 1;
    return 0;
  });
  return unique;
}

function buildRowsFromTable(table: ParsedTable & { header: HeaderInfo }, warnings: string[]): ParsedCourseRow[] {
  const { grid, header } = table;
  const startColumn = firstDayColumn(header);
  const dataRowCount = Math.max(0, grid.length - header.rowIndex - 1);
  const dayColumns = [...header.dayByCol.entries()].sort((a, b) => a[0] - b[0]);
  const candidates: RowCandidate[] = [];

  for (let gridRow = header.rowIndex + 1; gridRow < grid.length; gridRow += 1) {
    const row = grid[gridRow];
    if (!row) continue;
    const courseColumns = dayColumns.filter(([column]) => {
      const cell = row[column];
      return cell !== undefined && !isPlaceholderText(cell.text);
    });
    if (!courseColumns.length) continue;

    const label = rowLabelText(grid, gridRow, startColumn);
    const time = resolveRowTime(label, gridRow, header.rowIndex, dataRowCount, warnings);
    if (!time) continue;

    for (const [column, day] of courseColumns) {
      const cell = row[column];
      if (!cell) continue;
      const chunks = splitCourseChunks(cell.text);
      let produced = 0;
      for (const chunk of chunks) {
        const parts = parseCourseChunk(chunk);
        if (!parts.name) continue;
        const startTime = parts.startTime ?? time.start;
        const endTime = parts.endTime ?? time.end;
        if (endTime <= startTime) {
          warnings.push(`第${gridRow + 1}行课程时间无效，已跳过`);
          continue;
        }
        const nextRow: ParsedCourseRow = {
          name: parts.name,
          teacher: parts.teacher,
          location: parts.location,
          dayOfWeek: [day],
          startTime,
          endTime,
        };
        if (parts.startWeek !== undefined) nextRow.startWeek = parts.startWeek;
        if (parts.weekCount !== undefined) nextRow.weekCount = parts.weekCount;
        if (parts.weekType !== undefined) nextRow.weekType = parts.weekType;
        candidates.push({ row: nextRow, gridRow, column });
        produced += 1;
      }
      if (produced === 0) {
        const fallback = cleanCourseName((chunks[0] ?? cell.text).split('\n')[0] ?? '');
        if (fallback) {
          candidates.push({
            row: {
              name: fallback,
              teacher: '',
              location: '',
              dayOfWeek: [day],
              startTime: time.start,
              endTime: time.end,
            },
            gridRow,
            column,
          });
        }
      }
    }
  }

  return normalizeRows(mergeAdjacentCandidates(candidates));
}

interface DayMatch {
  day?: number;
  index: number;
  length: number;
}

function findDayInLine(text: string): DayMatch {
  const chinese = /(?:星期|礼拜|周)([一二三四五六日天])/.exec(text);
  if (chinese) {
    return { day: DAY_BY_CHAR.get(chinese[1]), index: chinese.index, length: chinese[0].length };
  }
  const english = /^\s*(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.exec(text);
  if (english) {
    const day = ENGLISH_DAY_BY_PREFIX.get(english[1].slice(0, 3).toLowerCase());
    if (day !== undefined) return { day, index: english.index, length: english[0].length };
  }
  return { index: 0, length: 0 };
}

export function parseTimetableHtml(html: string): TimetableParseResult {
  const warnings: string[] = [];
  if (!html || !html.trim()) {
    return { rows: [], warnings: ['HTML 内容为空，未找到可解析的表格'] };
  }

  const blocks = collectTableBlocks(stripCommentsAndScripts(html));
  if (!blocks.length) {
    return { rows: [], warnings: ['未找到可解析的表格'] };
  }

  const tables = blocks.map(analyzeTable);
  if (!tables.some((table) => table.grid.some((row) => row.length > 0))) {
    return { rows: [], warnings: ['表格中没有可解析的行'] };
  }

  const selected = selectTable(tables, warnings);
  if (!selected) return { rows: [], warnings };

  const rows = buildRowsFromTable(selected, warnings);
  if (!rows.length) warnings.push('未从表格中解析到课程');
  return { rows, warnings };
}

export function parseTimetableText(text: string): TimetableParseResult {
  const rows: ParsedCourseRow[] = [];
  const warnings: string[] = [];
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let sawContent = false;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim();
    if (!line) continue;
    sawContent = true;
    line = line.replace(/^[-*•·‧◦▪]+\s*/, '');
    if (!line) continue;

    const day = findDayInLine(line);
    if (day.day === undefined) {
      warnings.push(`第${index + 1}行：未识别到星期，已跳过`);
      continue;
    }
    line = `${line.slice(0, day.index)} ${line.slice(day.index + day.length)}`;

    const clock = extractClockRange(line);
    let startTime: string;
    let endTime: string;
    if (clock) {
      startTime = clock.start;
      endTime = clock.end;
      line = line.replace(clock.matched, ' ');
    } else if (hasClockRange(line)) {
      warnings.push(`第${index + 1}行：时间无效，已跳过`);
      continue;
    } else {
      const period = extractPeriodRange(line);
      if (!period) {
        warnings.push(`第${index + 1}行：缺少时间或节次，已跳过`);
        continue;
      }
      startTime = period.start;
      endTime = period.end;
      line = line.replace(period.matched, ' ');
    }

    const leftoverPeriod = extractPeriodRange(line);
    if (leftoverPeriod) line = line.replace(leftoverPeriod.matched, ' ');

    const parts = parseCourseChunk(line);
    if (!parts.name) {
      warnings.push(`第${index + 1}行：缺少课程名，已跳过`);
      continue;
    }
    const row: ParsedCourseRow = {
      name: parts.name,
      teacher: parts.teacher,
      location: parts.location,
      dayOfWeek: [day.day],
      startTime,
      endTime,
    };
    if (parts.startWeek !== undefined) row.startWeek = parts.startWeek;
    if (parts.weekCount !== undefined) row.weekCount = parts.weekCount;
    if (parts.weekType !== undefined) row.weekType = parts.weekType;
    rows.push(row);
  }

  if (!sawContent) warnings.push('没有可解析的课程行');
  else if (!rows.length && !warnings.length) warnings.push('没有可解析的课程行');
  return { rows, warnings };
}
