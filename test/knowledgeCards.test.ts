import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../src/types/knowledge';
import { cardDateKey, groupCardsByDate } from '../src/utils/knowledgeCards';

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
});
