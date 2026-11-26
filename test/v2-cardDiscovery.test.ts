import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../src/types/knowledge';
import { buildCardLinkSuggestions } from '../src/v2/utils/cardDiscovery';

const makeCard = (id: string, overrides: Partial<KnowledgeCard> = {}): KnowledgeCard => ({
  id,
  title: id,
  contents: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const cardWithText = (id: string, title: string, text: string, overrides: Partial<KnowledgeCard> = {}): KnowledgeCard =>
  makeCard(id, {
    title,
    contents: [{ id: `${id}-text`, kind: 'text', text, comments: [], createdAt: 0, updatedAt: 0 }],
    ...overrides,
  });

describe('literal discovery', () => {
  it('suggests another card when its title appears in the text', () => {
    const target = makeCard('target', { title: '数据库索引优化' });
    const source = cardWithText('source', '今天的复盘', '复习了「数据库索引优化」，重点是 B+ 树。');
    const suggestions = buildCardLinkSuggestions([source, target]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      source: 'source',
      target: 'target',
      kind: 'literal',
      anchor: '数据库索引优化',
      confidence: 0.92,
    });
    expect(suggestions[0].reason).toContain('数据库索引优化');
  });

  it('matches an explicit keyword and ignores an ambiguous short anchor less strongly', () => {
    const target = makeCard('target', { title: '索引笔记', keywords: ['线代复习'] });
    const source = cardWithText('source', '随手记', '今天把线代复习过了一遍。');
    const suggestions = buildCardLinkSuggestions([source, target]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ kind: 'literal', anchor: '线代复习', confidence: 0.74 });
  });

  it('does not suggest a pair that already has a confirmed link or keyword', () => {
    const linked = [cardWithText('a', 'A', '提到了数据库索引优化', { links: ['b'] }), makeCard('b', { title: '数据库索引优化' })];
    expect(buildCardLinkSuggestions(linked)).toEqual([]);

    const keyworded = [
      cardWithText('a', 'A', '提到了数据库索引优化', { keywords: ['数据库索引优化'] }),
      makeCard('b', { title: '数据库索引优化', keywords: ['数据库索引优化'] }),
    ];
    expect(buildCardLinkSuggestions(keyworded)).toEqual([]);
  });

  it('honours negative feedback in either direction', () => {
    const target = makeCard('target', { title: '数据库索引优化' });
    const source = cardWithText('source', '复盘', '数据库索引优化');
    expect(buildCardLinkSuggestions([{ ...source, ignoredLinks: ['target'] }, target])).toEqual([]);
    expect(buildCardLinkSuggestions([source, { ...target, ignoredLinks: ['source'] }])).toEqual([]);
  });

  it('uses word boundaries for Latin anchors', () => {
    const target = makeCard('target', { title: 'RAG' });
    const source = cardWithText('source', '笔记', 'storage 和 average 里都没有那个缩写。');
    expect(buildCardLinkSuggestions([source, target], { semantic: false })).toEqual([]);

    const mention = cardWithText('source-2', '笔记', '这篇讲 RAG 的检索流程。');
    const suggestions = buildCardLinkSuggestions([mention, target], { semantic: false });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ kind: 'literal', anchor: 'RAG' });
  });

  it('caps literal suggestions per card', () => {
    const targets = Array.from({ length: 5 }, (_, index) => makeCard(`t${index}`, { title: `主题${index}研究` }));
    const source = cardWithText('source', '汇总', targets.map(card => card.title).join('、'));
    const suggestions = buildCardLinkSuggestions([source, ...targets], { semantic: false });

    expect(suggestions).toHaveLength(2);
    expect(suggestions.every(item => item.source === 'source')).toBe(true);
  });
});

describe('semantic discovery', () => {
  const pair = () => [
    cardWithText('a', '数据库索引优化', 'B+ 树索引能减少数据库查询的磁盘读取，范围查询也更稳定。'),
    cardWithText('b', '数据库索引原理', '数据库索引通常使用 B+ 树结构，范围查询和磁盘读取是重点。'),
  ];

  it('finds content similarity without any literal anchor', () => {
    const suggestions = buildCardLinkSuggestions(pair(), { literal: false });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ kind: 'semantic', source: 'a', target: 'b' });
    expect(suggestions[0].confidence).toBeGreaterThan(0.3);
    expect(suggestions[0].reason).toContain('%');
  });

  it('can be tuned off or above the similarity threshold', () => {
    expect(buildCardLinkSuggestions(pair(), { literal: false, semantic: false })).toEqual([]);
    expect(buildCardLinkSuggestions(pair(), { literal: false, semanticThreshold: 0.99 })).toEqual([]);
  });

  it('stays quiet for unrelated cards', () => {
    const cards = [
      cardWithText('a', '数据库索引', 'B+ 树索引和查询优化。'),
      cardWithText('b', '今天做饭', '番茄炒蛋要先炒蛋，再放番茄。'),
    ];
    expect(buildCardLinkSuggestions(cards)).toEqual([]);
  });

  it('does not repeat a pair already proposed literally', () => {
    const target = makeCard('target', { title: '数据库索引优化' });
    const source = cardWithText('source', '数据库索引优化', '数据库索引优化需要关注 B+ 树和查询范围。');
    const suggestions = buildCardLinkSuggestions([source, target]);
    const pairs = suggestions.map(item => [item.source, item.target].sort().join('--'));

    expect(new Set(pairs).size).toBe(pairs.length);
    expect(suggestions[0].kind).toBe('literal');
  });
});

describe('suggestion stability', () => {
  it('is deterministic regardless of input order', () => {
    const cards = [
      cardWithText('a', '数据库索引优化', 'B+ 树索引和数据库查询。'),
      cardWithText('b', '数据库索引原理', '数据库索引使用 B+ 树，查询更快。'),
      cardWithText('c', '今天做饭', '番茄炒蛋的做法。'),
    ];
    const first = buildCardLinkSuggestions(cards);
    const second = buildCardLinkSuggestions([...cards].reverse());
    expect(second).toEqual(first);
  });
});
