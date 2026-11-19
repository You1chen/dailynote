import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../src/types/knowledge';
import { cardDataJSON, cardDateKey, cardSearchText, groupCardsByDate } from '../src/utils/knowledgeCards';

const card = (id: string, createdAt: number): KnowledgeCard => ({ id, title: id, contents: [], createdAt, updatedAt: createdAt });

describe('collector date grouping', () => {
  it('defaults to newest first and can switch to oldest first', () => {
    const today = Date.now();
    const yesterday = today - 86400000;
    const cards = [card('old', yesterday), card('new', today)];
    expect(groupCardsByDate(cards).flatMap(group => group.cards.map(item => item.id))).toEqual(['new', 'old']);
    expect(groupCardsByDate(cards, true).flatMap(group => group.cards.map(item => item.id))).toEqual(['old', 'new']);
  });

  it('keeps cards from the same local date in one group', () => {
    const first = new Date(2026, 10, 14, 8).getTime();
    const second = new Date(2026, 10, 14, 20).getTime();
    const groups = groupCardsByDate([card('a', first), card('b', second)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe(cardDateKey(first));
    expect(groups[0].cards.map(item => item.id)).toEqual(['b', 'a']);
  });

  it('includes comment text in keyword search', () => {
    const now = Date.now();
    const item: KnowledgeCard = {
      ...card('with-comment', now),
      contents: [{
        id: 'text-1', kind: 'text', text: '正文', createdAt: now, updatedAt: now,
        comments: [{ id: 'comment-1', text: '这里补充一个关键词', images: [], createdAt: now, updatedAt: now }],
      }],
    };
    expect(cardSearchText(item)).toContain('这里补充一个关键词');
  });

  it('exports a complete card document including image payloads', () => {
    const now = Date.now();
    const image = 'data:image/png;base64,abc123';
    const payload = JSON.parse(cardDataJSON({
      ...card('with-image', now),
      contents: [{ id: 'image-1', kind: 'image', data: image, createdAt: now, updatedAt: now }],
    }));
    expect(payload).toMatchObject({ format: 'dailynote-card', version: 1, card: { id: 'with-image' } });
    expect(payload.card.contents[0]).toMatchObject({ kind: 'image', data: image });
  });
});
