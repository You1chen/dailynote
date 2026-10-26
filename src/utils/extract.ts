/**
 * 从识别文本里抽取「时间 / 地点 / 要求 / 邮箱」
 *
 * 输入：OCR 或视觉模型吐出的纯文本（全角标点、状态栏时钟、App 自身界面文字都可能混进来）
 * 输出：可填进表单的结构化结果 + 组装好的 Markdown 备注
 *
 * 原则：宁可留空，也不把错的值塞进表单；界面文案与时钟不算内容。
 */

export interface ExtractedInfo {
  /** 建议名称 */
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm（24 小时制） */
  time: string;
  /** 地点 */
  location: string;
  /** 邮箱地址 */
  emails: string[];
  /** 要求信息（逐条） */
  requirements: string[];
  /** 组装好的 Markdown 备注 */
  notes: string;
}

/** 全角 → 半角（数字、冒号、斜杠、括号、空格） */
function normalize(text: string): string {
  return (text ?? '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 单独一行的 HH:MM —— 截图状态栏时钟，不能当截止时间 */
function isOnlyTime(line: string): boolean {
  return /^\d{1,2}\s*:\s*\d{2}(:\d{2})?$/.test(line.trim());
}

/** 单独一行的日期 */
function isOnlyDate(line: string): boolean {
  return /^(\d{4}\s*[-/.年]\s*)?\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?$/.test(line.trim());
}

function hasDate(s: string): boolean {
  return /\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}/.test(s)
    || /\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日/.test(s);
}

/** 单独一行的界面文案（OCR 到 App 自己页面时的大量噪声） */
function isUiNoise(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^(共\s*\d+\s*个截止事项|添加\s*DDL|新增|\+\s*添加.*)$/i.test(t)) return true;
  return /^(DDL|搜索|添加|编辑|删除|取消|填入|保存|名称|地点|要求|邮箱|备注|事件名称|截止时间|识别结果|保留原值|用识别值|已存在|关闭|返回)$/i.test(t);
}

// ============ 日期 ============

function parseDateStr(s: string, today: Date): string {
  let m = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/.exec(s);
  if (m) return fmtDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/.exec(s);
  if (m) {
    const mo = Number(m[1]);
    const day = Number(m[2]);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) return fmtDate(today.getFullYear(), mo, day);
  }
  return '';
}

/** 日期：整行优先带「截止」，其次任何带日期的行，最后今天/明天/后天 */
function findDate(lines: string[], today: Date): string {
  const scored = lines
    .map((line, i) => {
      if (!hasDate(line)) return null;
      let s = 0;
      if (/截止|deadline|due/i.test(line)) s += 4;
      if (/时间|于|前/.test(line)) s += 1;
      if (i === 0 && isOnlyDate(line)) s -= 2;   // 顶部孤立日期更像截图页眉
      return { line, s };
    })
    .filter((x): x is { line: string; s: number } => !!x)
    .sort((a, b) => b.s - a.s);

  for (const item of scored) {
    const d = parseDateStr(item.line, today);
    if (d) return d;
  }

  const rel = /(今天|明天|后天)/.exec(lines.join('\n'));
  if (rel) {
    const d = new Date(today);
    d.setDate(d.getDate() + (rel[1] === '今天' ? 0 : rel[1] === '明天' ? 1 : 2));
    return fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return '';
}

// ============ 时间 ============

function parseTimeStr(line: string): string {
  const period = /(上午|下午|晚上|中午|凌晨|早上)/.exec(line)?.[1] ?? '';
  const m = /(\d{1,2})\s*:\s*(\d{2})/.exec(line) ?? /(\d{1,2})\s*[点时]\s*(\d{1,2})?\s*分?/.exec(line);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return '';
  if ((period === '下午' || period === '晚上') && h < 12) h += 12;
  if (period === '中午' && h < 11) h += 12;
  if ((period === '凌晨' || period === '上午') && h === 12) h = 0;
  return `${pad2(h)}:${pad2(min)}`;
}

/**
 * 时间：优先取和「截止/时间」同行的值，其次是和日期同行的值；
 * 孤立的 HH:MM（截图状态栏）默认丢弃。
 */
function findTime(lines: string[]): string {
  let best = '';
  let bestScore = 0;

  lines.forEach((line, i) => {
    const value = parseTimeStr(line);
    if (!value) return;

    let score = 0;
    if (/截止|deadline|due/i.test(line)) score += 5;
    if (/时间|开始|于|前|点/.test(line)) score += 2;
    if (hasDate(line)) score += 3;
    if (isOnlyTime(line)) {
      score -= 6;
      if (i <= 2) score -= 2; // 顶部孤立时间基本就是状态栏
    }

    if (score > bestScore) {
      bestScore = score;
      best = value;
    }
  });

  return bestScore >= 1 ? best : '';
}

// ============ 地点 ============

function findLocation(lines: string[]): string {
  const labelRe = /^(?:地\s*点|地\s*址|位\s*置|教\s*室|会场|集合地点)\s*[:：]?\s*(.+)$/;
  for (const line of lines) {
    const m = labelRe.exec(line.trim());
    if (m && m[1].trim() && !isUiNoise(m[1])) return m[1].trim();
  }

  const hintRe = /(教室|会议室|报告厅|礼堂|体育馆|图书馆|实验楼|教学楼|办公楼|宿舍|门|室|馆|厅|楼|号)$|([一二三四五六七八九十\d]{1,2}\s*教\s*\d{3,4})|([A-Za-z]\s*\d{3,4})/;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.length > 40 || isUiNoise(t)) continue;
    if (/(要求|须知|注意|携带|提交|邮箱|联系|电话|截止)/.test(t)) continue;
    if (hintRe.test(t)) return t.replace(/^[·•\-*]\s*/, '');
  }
  return '';
}

// ============ 邮箱 ============

function findEmails(text: string): string[] {
  const found = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return Array.from(new Set(found.map(x => x.trim())));
}

// ============ 要求 ============

/**
 * 要求信息：命中要求类关键词的行。
 * 排除：界面文案、孤立时间/日期、地点行，以及「截止/时间/地点」这类声明行本身。
 */
function findRequirements(lines: string[], location: string): string[] {
  const keyRe = /(要求|须|务必|请携带|携带|提交|截止|报名|准备|材料|注意|严禁|不得|着装|签到|准时|参加|提供)/;
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw
      .trim()
      .replace(/^[·•\-*\d.、)]+\s*/, '')
      .replace(/^(要求|注意|须知|提示|说明)[：:]\s*/, '');

    if (!line || line.length < 2 || line.length > 80) continue;
    if (isUiNoise(line) || isOnlyTime(line) || isOnlyDate(line)) continue;
    if (/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(line)) continue;
    if (line === location) continue;
    // 截止/时间/地点 声明行不是「要求」
    if (/^(截\s*止|时\s*间|日\s*期|地\s*点|deadline|due)/i.test(line)) continue;

    if (keyRe.test(line)) out.push(line);
  }

  return Array.from(new Set(out)).slice(0, 12);
}

// ============ 名称 ============

function findTitle(lines: string[], requirements: string[], location: string): string {
  const clean = (s: string) => s.trim().replace(/^[·•\-*]\s*/, '').replace(/\s+/g, ' ');
  const usable = (t: string) =>
    t.length >= 2 && t.length <= 20
    && !isUiNoise(t) && !isOnlyTime(t) && !isOnlyDate(t)
    && !/^[\d\s:：.\-/]+$/.test(t)
    && !hasDate(t)
    && t !== location && !requirements.includes(t);

  for (const raw of lines) {
    const m = /^(?:主\s*题|名\s*称|标\s*题|关于)\s*[:：]?\s*(.+)$/.exec(clean(raw));
    if (m && usable(m[1].trim())) return m[1].trim().slice(0, 30);
  }

  const noun = /(通知|作业|报告|会议|答辩|活动|考试|讲座|比赛|培训|报名|实验|课程)/;
  for (const raw of lines) {
    const t = clean(raw);
    if (usable(t) && noun.test(t)) return t;
  }

  for (const raw of lines) {
    const t = clean(raw);
    if (usable(t)) return t;
  }
  return '';
}

// ============ 备注 ============

/** 组装 Markdown 备注：只要「要求 / 邮箱」，没有就不写 */
export function buildNotes(requirements: string[], emails: string[]): string {
  const parts: string[] = [];
  if (requirements.length) {
    parts.push(['**要求**', ...requirements.map(r => `- ${r}`)].join('\n'));
  }
  if (emails.length) {
    parts.push(['**邮箱**', ...emails.map(e => `- ${e}`)].join('\n'));
  }
  return parts.join('\n\n');
}

/** 主入口：文本 → 结构化信息 */
export function extractFromText(rawText: string, today = new Date()): ExtractedInfo {
  const text = normalize(rawText);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const date = findDate(lines, today);
  const time = findTime(lines);
  const location = findLocation(lines);
  const emails = findEmails(text);
  const requirements = findRequirements(lines, location);
  const title = findTitle(lines, requirements, location);

  return {
    title,
    date,
    time,
    location,
    emails,
    requirements,
    notes: buildNotes(requirements, emails),
  };
}

/** 从已有备注里取出「可比较的行」与「邮箱」，用于识别结果的去重与冲突判断 */
export function parseExistingNotes(notes: string): { lines: string[]; emails: string[] } {
  const text = normalize(notes);
  const emails = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])
    .map(x => x.trim());
  const lines = text
    .split('\n')
    .map(l => l.trim())
    // 先剔掉纯加粗标题（如 **要求**），再剥项目符号，否则 * 会被当符号吃掉
    .filter(l => l && !/^\*\*.+\*\*$/.test(l))
    .map(l => l.replace(/^[·•\-*\d.、)\s]+/, '').replace(/[：:]\s*$/, ''))
    .filter(Boolean);
  return {
    lines: Array.from(new Set(lines)),
    emails: Array.from(new Set(emails)),
  };
}

// ============ 与现有内容的比对（去重 / 冲突） ============

export type RowAction = 'fill' | 'skip' | 'conflict';
export type RowKind = 'scalar' | 'req' | 'email';

export interface PlannedRow {
  id: string;
  kind: RowKind;
  label: string;
  value: string;
  /** 现有内容（冲突时用于展示） */
  current: string;
  action: RowAction;
  /** 多张图片给出不同值时，全部候选（>1 表示图与图冲突） */
  candidates?: string[];
}

export interface CurrentContent {
  name: string;
  deadlineDate: string;
  deadlineTime: string;
  location: string;
  notes: string;
}

export type ScalarKey = 'title' | 'date' | 'time' | 'location';

/**
 * 识别结果 vs 现有内容：
 * - 现有为空 → fill
 * - 完全相同 → skip（不重复填）
 * - 不同 → conflict（由用户取舍）
 * 要求条目只做去重（相同即 skip），邮箱额外区分「已有别的邮箱」→ conflict。
 */
export function planExtraction(
  info: ExtractedInfo,
  cur: CurrentContent,
  candidates: Partial<Record<ScalarKey, string[]>> = {},
): PlannedRow[] {
  const rows: PlannedRow[] = [];
  const existing = parseExistingNotes(cur.notes);

  const scalar = (id: string, label: string, value: string, current: string, candKey?: ScalarKey) => {
    const v = value.trim();
    if (!v) return;
    const c = current.trim();
    const same = !!c && c.toLowerCase() === v.toLowerCase();
    const cands = candKey ? candidates[candKey] : undefined;
    rows.push({
      id,
      kind: 'scalar',
      label,
      value: v,
      current: c,
      action: !c ? 'fill' : same ? 'skip' : 'conflict',
      ...(cands && cands.length > 1 ? { candidates: cands } : {}),
    });
  };

  scalar('name', '名称', info.title, cur.name, 'title');
  scalar('deadlineDate', '日期', info.date, cur.deadlineDate, 'date');
  scalar('deadlineTime', '时间', info.time, cur.deadlineTime, 'time');
  scalar('location', '地点', info.location, cur.location, 'location');

  for (const raw of info.requirements) {
    const v = raw.trim();
    if (!v) continue;
    const exists = existing.lines.some(l => l.includes(v) || v.includes(l));
    rows.push({
      id: `req:${v}`,
      kind: 'req',
      label: '要求',
      value: v,
      current: exists ? '备注里已有' : '',
      action: exists ? 'skip' : 'fill',
    });
  }

  for (const raw of info.emails) {
    const v = raw.trim();
    if (!v) continue;
    const same = existing.emails.some(x => x.toLowerCase() === v.toLowerCase());
    const others = existing.emails.filter(x => x.toLowerCase() !== v.toLowerCase());
    rows.push({
      id: `email:${v}`,
      kind: 'email',
      label: '邮箱',
      value: v,
      current: same ? '备注里已有' : others.join('、'),
      action: same ? 'skip' : others.length > 0 ? 'conflict' : 'fill',
    });
  }

  return rows;
}

// ============ 多张图片之间的合并（图⇄图冲突） ============

export interface MergedExtraction {
  /** 合并后的结果（多值时取第一个，供用户再改） */
  info: ExtractedInfo;
  /** 同一字段在多张图里出现不同值 → 候选列表（长度 > 1 即冲突） */
  candidates: Partial<Record<ScalarKey, string[]>>;
}

function uniq(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = v.trim();
    if (s && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

/**
 * 把每张图各自抽取的结果合并：
 * - 标量字段（名称/日期/时间/地点）取候选集合，>1 视为图与图冲突
 * - 要求与邮箱取并集（后续再按备注去重）
 */
export function mergeExtractions(list: ExtractedInfo[]): MergedExtraction {
  const titles = uniq(list.map(i => i.title));
  const dates = uniq(list.map(i => i.date));
  const times = uniq(list.map(i => i.time));
  const locations = uniq(list.map(i => i.location));
  const requirements = uniq(list.flatMap(i => i.requirements));
  const emails = uniq(list.flatMap(i => i.emails));

  const candidates: Partial<Record<ScalarKey, string[]>> = {};
  if (titles.length > 1) candidates.title = titles;
  if (dates.length > 1) candidates.date = dates;
  if (times.length > 1) candidates.time = times;
  if (locations.length > 1) candidates.location = locations;

  return {
    info: {
      title: titles[0] ?? '',
      date: dates[0] ?? '',
      time: times[0] ?? '',
      location: locations[0] ?? '',
      emails,
      requirements,
      notes: buildNotes(requirements, emails),
    },
    candidates,
  };
}
