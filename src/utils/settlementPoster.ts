/** Standalone, synchronous Canvas2D poster renderer; importing it never touches the DOM. */
export interface PosterData {
  date: string;
  /** 一行「今日盛况」概括，例如「今天留下 12 次行动」；null/空串不绘制 */
  headline?: string;
  sections: { title: string; items: { label: string; value: string; detail?: string }[] }[];
}

export interface PosterLine {
  text: string;
  /** Top-left text box, in canvas pixels (not a text baseline). */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  weight: number;
  color: string;
  role: 'brand' | 'title' | 'date' | 'headline' | 'section' | 'label' | 'value' | 'detail' | 'empty' | 'footer';
  sectionIndex?: number;
  itemIndex?: number;
}

export interface PosterRow {
  x: number;
  y: number;
  width: number;
  height: number;
  sectionIndex: number;
  itemIndex: number;
}

export interface PosterPage {
  width: number;
  height: number;
  lines: PosterLine[];
  rows: PosterRow[];
}

export interface SettlementPosterLayout {
  width: number;
  /** Height of the first canvas. Each subsequent canvas uses its own page.height. */
  height: number;
  totalHeight: number;
  pages: PosterPage[];
}

export const POSTER_MAX_HEIGHT = 4096;
export const POSTER_MAX_PIXELS = 4_000_000;
const INK = '#302c28';
const MUTED = '#83796c';
const PAPER = '#faf6ee';
const ACCENTS = ['#e8edde', '#f5e1d7', '#e4e9f3', '#eee3ed'];
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Conservative deterministic wrapping. Bounded output even for megabyte-long input. */
function wrap(text: string, width: number, size: number, maxLines: number): string[] {
  const result: string[] = [];
  let line = '';
  let used = 0;
  for (const character of text.replace(/[\r\n\t]/g, ' ')) {
    const advance = size * (/[\u0000-\u007f]/.test(character) ? 0.68 : 1.05);
    if (used + advance > width && line) {
      result.push(line);
      if (result.length === maxLines) {
        result[result.length - 1] = line.slice(0, -1) + '…';
        return result;
      }
      line = '';
      used = 0;
    }
    line += character;
    used += advance;
  }
  if (line || !result.length) result.push(line);
  return result;
}

/**
 * Pure layout in physical pixels. Width is clamped to 320–1600. Pages never exceed
 * 4096px high / four million pixels; no item is dropped, even across section breaks.
 * Text is limited to two lines per field. Zero-value filtering belongs to the caller.
 */
export function layoutSettlementPoster(data: PosterData, width = 900): SettlementPosterLayout {
  width = Math.round(Number.isFinite(width) ? Math.min(1600, Math.max(320, width)) : 900);
  const scale = width / 900;
  const limit = Math.min(POSTER_MAX_HEIGHT, Math.floor(POSTER_MAX_PIXELS / width));
  const maxY = limit / scale - 100;
  const pages: PosterPage[] = [];
  let page: PosterPage;
  let y = 0;
  const addLine = (text: string, x: number, top: number, boxWidth: number, size: number,
    role: PosterLine['role'], weight = 400, color = INK,
    sectionIndex?: number, itemIndex?: number) => {
    page.lines.push({ text, x: x * scale, y: top * scale, width: boxWidth * scale,
      height: size * 1.4 * scale, fontSize: size * scale, weight, color, role, sectionIndex, itemIndex });
  };
  const startPage = () => {
    page = { width, height: 0, lines: [], rows: [] };
    pages.push(page);
    addLine('DAILYNOTE  /  日有所记', 54, 42, 792, 18, 'brand', 600, MUTED);
    addLine('今日结算', 54, 94, 792, 58, 'title', 700);
    addLine(wrap(data.date, 792, 23, 1)[0], 56, 184, 788, 23, 'date', 400, MUTED);
    const headline = (data.headline ?? '').trim();
    if (headline) {
      addLine(wrap(headline, 780, 26, 2)[0], 54, 222, 792, 26, 'headline', 600, '#5c6b52');
      y = 282;
    } else {
      y = 260;
    }
  };
  const finishPage = () => {
    page.height = Math.min(limit, Math.ceil(Math.max(510, y + 100) * scale));
  };
  startPage();
  let count = 0;
  data.sections.forEach((section, sectionIndex) => {
    if (!section.items.length) return;
    const heading = wrap(section.title, 740, 28, 2);
    const headingHeight = heading.length * 40 + 22;
    const addHeading = (continued: boolean) => {
      const titleLines = continued ? wrap(section.title + ' · 续', 740, 28, 2) : heading;
      titleLines.forEach((text, i) => addLine(text, 72, y + i * 40, 740, 28, 'section', 650, INK, sectionIndex));
      y += titleLines.length * 40 + 22;
    };
    section.items.forEach((item, itemIndex) => {
      const labels = wrap(item.label, 440, 26, 2);
      const values = wrap(item.value, 260, 34, 2);
      const details = item.detail ? wrap(item.detail, 720, 21, 2) : [];
      const mainHeight = Math.max(labels.length * 38, values.length * 48);
      const rowHeight = 32 + mainHeight + (details.length ? 14 + details.length * 31 : 0) + 24;
      const needsHeading = itemIndex === 0;
      if (y + rowHeight + (needsHeading ? headingHeight : 0) > maxY) {
        finishPage();
        startPage();
        addHeading(itemIndex > 0);
      } else if (needsHeading) addHeading(false);
      page.rows.push({ x: 54 * scale, y: y * scale, width: 792 * scale,
        height: rowHeight * scale, sectionIndex, itemIndex });
      labels.forEach((text, i) => addLine(text, 78, y + 24 + i * 38, 440, 26, 'label', 500, INK, sectionIndex, itemIndex));
      values.forEach((text, i) => addLine(text, 558, y + 18 + i * 48, 260, 34, 'value', 750, INK, sectionIndex, itemIndex));
      details.forEach((text, i) => addLine(text, 78, y + 24 + mainHeight + 14 + i * 31, 720, 21, 'detail', 400, MUTED, sectionIndex, itemIndex));
      y += rowHeight + 14;
      count++;
    });
    y += 26;
  });
  if (!count) {
    addLine('今日尚无记录', 72, y + 28, 756, 34, 'empty', 600);
    addLine('慢慢来，每一天都值得被记下。', 72, y + 90, 756, 23, 'detail', 400, MUTED);
    y += 180;
  }
  finishPage();
  pages.forEach((current, index) => {
    page = current;
    addLine(`日有所记，步履不停。  ·  ${index + 1} / ${pages.length}`, 54,
      current.height / scale - 54, 792, 18, 'footer', 400, MUTED);
  });
  return { width, height: pages[0].height, totalHeight: pages.reduce((sum, p) => sum + p.height, 0), pages };
}

/** Fit with real Canvas font metrics; layout's deterministic estimate is only a first pass. */
function fitMeasuredText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(characters.slice(0, middle).join('') + '…').width <= width) low = middle;
    else high = middle - 1;
  }
  return low ? characters.slice(0, low).join('') + '…' : '…';
}

/**
 * Paint one page into a caller-owned canvas. Render all layout.pages by passing
 * pageIndex = 0..pages.length-1. The canvas is resized, clearing previous content.
 * No devicePixelRatio multiplier: the returned layout already uses export pixels.
 */
export function renderSettlementPoster(
  canvas: HTMLCanvasElement, data: PosterData, pageIndex = 0, width = 900,
): SettlementPosterLayout {
  const layout = layoutSettlementPoster(data, width);
  const page = layout.pages[pageIndex];
  if (!page) throw new RangeError('海报页码超出范围');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 Canvas2D');
  canvas.width = page.width;
  canvas.height = page.height;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, page.width, page.height);
  const scale = page.width / 900;
  // Soft stationery accents; all decorations remain inside the canvas.
  ctx.fillStyle = '#eee5d7';
  const ruleY = page.lines.some(line => line.role === 'headline') ? 270 : 229;
  ctx.fillRect(54 * scale, ruleY * scale, 792 * scale, 2 * scale);
  page.rows.forEach(row => {
    ctx.fillStyle = '#fffcf7';
    ctx.fillRect(row.x, row.y, row.width, row.height);
    ctx.fillStyle = ACCENTS[row.sectionIndex % ACCENTS.length];
    ctx.fillRect(row.x, row.y, 5 * scale, row.height);
  });
  page.lines.forEach(line => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(line.x, line.y, line.width, line.height);
    ctx.clip();
    ctx.font = `${line.weight} ${line.fontSize}px ${FONT}`;
    ctx.fillStyle = line.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const text = fitMeasuredText(ctx, line.text, line.width);
    ctx.fillText(text, line.x, line.y + line.height / 2, line.width);
    ctx.restore();
  });
  return layout;
}
