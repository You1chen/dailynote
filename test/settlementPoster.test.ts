import { describe, expect, it, vi } from 'vitest';
import {
  layoutSettlementPoster, renderSettlementPoster, POSTER_MAX_HEIGHT, POSTER_MAX_PIXELS,
  type PosterData, type SettlementPosterLayout,
} from '../src/utils/settlementPoster';

function expectInside(layout: SettlementPosterLayout) {
  expect(layout.height).toBe(layout.pages[0].height);
  expect(layout.totalHeight).toBe(layout.pages.reduce((total, page) => total + page.height, 0));
  for (const page of layout.pages) {
    expect(page.height).toBeLessThanOrEqual(POSTER_MAX_HEIGHT);
    expect(page.width * page.height).toBeLessThanOrEqual(POSTER_MAX_PIXELS);
    for (const box of [...page.lines, ...page.rows]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.width + 0.001);
      expect(box.y + box.height).toBeLessThanOrEqual(page.height + 0.001);
    }
    for (let i = 1; i < page.rows.length; i++) {
      expect(page.rows[i].y).toBeGreaterThanOrEqual(page.rows[i - 1].y + page.rows[i - 1].height);
    }
    const footer = page.lines.find(line => line.role === 'footer')!;
    for (const row of page.rows) expect(row.y + row.height).toBeLessThan(footer.y);
  }
}

const simple: PosterData = {
  date: '2026年10月29日 · 星期四',
  sections: [{ title: '今日专注', items: [{ label: '阅读', value: '120 分钟', detail: '比昨天多一点进步' }] }],
};

describe('settlement poster layout', () => {
  it('renders dated Chinese title, highlighted numbers, and source row coordinates', () => {
    const layout = layoutSettlementPoster(simple);
    expectInside(layout);
    expect(layout.width).toBe(900);
    expect(layout.pages).toHaveLength(1);
    const page = layout.pages[0];
    expect(page.lines.find(line => line.role === 'title')?.text).toBe('今日结算');
    expect(page.lines.find(line => line.role === 'date')?.text).toBe(simple.date);
    expect(page.lines.find(line => line.role === 'value')?.fontSize)
      .toBeGreaterThan(page.lines.find(line => line.role === 'label')!.fontSize);
    expect(page.rows[0]).toMatchObject({ sectionIndex: 0, itemIndex: 0 });
  });

  it('shows a friendly empty state for missing items and empty sections', () => {
    for (const sections of [[], [{ title: '空分组', items: [] }]]) {
      const layout = layoutSettlementPoster({ date: '2026-10-29', sections });
      expectInside(layout);
      expect(layout.pages[0].lines.some(line => line.text === '今日尚无记录')).toBe(true);
      expect(layout.pages[0].lines.some(line => line.role === 'section')).toBe(false);
    }
  });

  it('grows a long poster before paginating', () => {
    const many = { ...simple, sections: [{ title: '记录', items: Array.from({ length: 15 }, () => simple.sections[0].items[0]) }] };
    const small = layoutSettlementPoster(simple);
    const larger = layoutSettlementPoster(many);
    expect(larger.pages).toHaveLength(1);
    expect(larger.height).toBeGreaterThan(small.height);
    expectInside(larger);
  });

  it.each([320, 900, 1600])('keeps hundreds of goals and long text in bounds at width %i', width => {    const longText = '超长目标标题，认真生活每一天。'.repeat(800);
    const data: PosterData = {
      date: longText,
      sections: Array.from({ length: 9 }, (_, sectionIndex) => ({
        title: longText,
        items: Array.from({ length: 51 }, (_, itemIndex) => ({
          label: `${sectionIndex}-${itemIndex} ${longText}`,
          value: '123456789012345678901234567890'.repeat(50),
          detail: longText,
        })),
      })),
    };
    const layout = layoutSettlementPoster(data, width);
    expectInside(layout);
    expect(layout.pages.length).toBeGreaterThan(1);
    const rows = layout.pages.flatMap(page => page.rows);
    expect(rows).toHaveLength(459);
    expect(new Set(rows.map(row => `${row.sectionIndex}:${row.itemIndex}`)).size).toBe(459);
    for (const page of layout.pages) {
      expect(page.lines.some(line => line.role === 'title')).toBe(true);
      expect(page.lines.some(line => line.role === 'section')).toBe(true);
      expect(page.lines.every(line => line.text.length < 150)).toBe(true);
      for (const row of page.rows) {
        for (const line of page.lines.filter(line => line.itemIndex === row.itemIndex && line.sectionIndex === row.sectionIndex)) {
          expect(line.y).toBeGreaterThanOrEqual(row.y);
          expect(line.y + line.height).toBeLessThanOrEqual(row.y + row.height + 0.001);
        }
      }
    }
  }, 20_000);

  it.each([0, -1, 100_000, NaN, Infinity])('normalizes unsafe width %s', width => {
    const layout = layoutSettlementPoster(simple, width);
    expect(layout.width).toBeGreaterThanOrEqual(320);
    expect(layout.width).toBeLessThanOrEqual(1600);
    expectInside(layout);
  });

  it('does not mutate caller data or filter zero-valued rows', () => {
    const data: PosterData = { date: '今天', sections: [{ title: '目标', items: [{ label: '零也保留', value: '0' }] }] };
    const before = JSON.stringify(data);
    expect(layoutSettlementPoster(data).pages[0].rows).toHaveLength(1);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('Canvas2D renderer', () => {
  function mockCanvas() {
    const ctx = {
      fillRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      // Deliberately wider than layout estimates, exercising actual font measurement.
      measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 80 })),
      fillStyle: '', font: '', textBaseline: '', textAlign: '',
    };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
    return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
  }

  it('resizes the canvas and actually paints the selected page with measured/clipped text', () => {
    const data = { ...simple, sections: [{ title: '记录', items: Array.from({ length: 100 }, () => simple.sections[0].items[0]) }] };
    const { canvas, ctx } = mockCanvas();
    const layout = renderSettlementPoster(canvas, data, 1, 700);
    expect(canvas.width).toBe(700);
    expect(canvas.height).toBe(layout.pages[1].height);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
    expect(ctx.fillText).toHaveBeenCalledTimes(layout.pages[1].lines.length);
    expect(ctx.clip).toHaveBeenCalledTimes(layout.pages[1].lines.length);
    expect(ctx.fillText.mock.calls.some(call => String(call[0]).endsWith('…'))).toBe(true);
    ctx.fillText.mock.calls.forEach(call => {
      expect(Array.from(String(call[0])).length * 80).toBeLessThanOrEqual(Number(call[3]));
    });
  });

  it('fails clearly for invalid pages and unavailable Canvas2D', () => {
    const { canvas } = mockCanvas();
    expect(() => renderSettlementPoster(canvas, simple, 100)).toThrow(RangeError);
    expect(() => renderSettlementPoster({ getContext: () => null } as unknown as HTMLCanvasElement, simple))
      .toThrow('Canvas2D');
  });
});
