import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../src/types/knowledge';
import {
  extractCardReferences,
  extractCardReferenceTitles,
  normalizeCardRef,
  resolveCardReference,
  resolvedCardReferencePairs,
  stripCardReferences,
  replaceCardReferenceTitle,
} from '../src/v2/utils/cardLinks';

const makeCard = (id: string, overrides: Partial<KnowledgeCard> = {}): KnowledgeCard => ({
  id,
  title: id,
  contents: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const withText = (id: string, title: string, text: string, overrides: Partial<KnowledgeCard> = {}): KnowledgeCard =>
  makeCard(id, {
    title,
    contents: [{ id: `${id}-text`, kind: 'text', text, comments: [], createdAt: 0, updatedAt: 0 }],
    ...overrides,
  });

describe('card reference syntax', () => {
  it('extracts Logseq page references with offsets and dedupes titles', () => {
    const text = '玻尔兹曼是[[德国]]人，提出了[[玻尔兹曼熵]]。再看一次 [[德国]]。';
    const references = extractCardReferences(text);

    expect(references).toHaveLength(3);
    expect(references[0]).toMatchObject({ title: '德国', raw: '[[德国]]', index: 5 });
    expect(extractCardReferenceTitles(text)).toEqual(['德国', '玻尔兹曼熵']);
    expect(normalizeCardRef('  德国  ')).toBe('德国');
  });

  it('ignores empty, multiline and overlong references', () => {
    expect(extractCardReferences('[[ ]] [[a\nb]]')).toEqual([]);
    expect(extractCardReferences(`[[${'x'.repeat(101)}]]`)).toEqual([]);
  });

  it('strips references for snippets and search text', () => {
    expect(stripCardReferences('读 [[德国]] 与 [[康德]]，再看 https://example.com')).toBe('读 德国 与 康德，再看 https://example.com');
  });

  it('updates references when a card title changes', () => {
    expect(replaceCardReferenceTitle('参见 [[德国]] 和 [[德国史]]。', '德国', '德意志'))
      .toBe('参见 [[德意志]] 和 [[德国史]]。');
    expect(replaceCardReferenceTitle('  [[ 德国 ]]  ', '德国', '德意志')).toBe('  [[德意志]]  ');
    expect(replaceCardReferenceTitle('no refs', '德国', '德意志')).toBe('no refs');
  });
});

describe('card reference resolution', () => {
  const cards = [
    withText('a', '玻尔兹曼', '物理学家'),
    withText('b', '德国', '欧洲国家'),
    makeCard('c', { title: '索引笔记', keywords: ['线代'] }),
    makeCard('d', { title: '线代复习', keywords: ['线代'] }),
  ];

  it('resolves an exact card title case-insensitively and respects self-exclusion', () => {
    expect(resolveCardReference('德国', cards)?.id).toBe('b');
    expect(resolveCardReference(' 德国 ', cards, 'b')).toBeUndefined();
    expect(resolveCardReference('Germany', cards)).toBeUndefined();
  });

  it('uses a unique keyword or tag alias, but not an ambiguous one', () => {
    expect(resolveCardReference('索引笔记', cards)?.id).toBe('c');
    const aliased = [...cards, makeCard('e', { title: '线代作业', keywords: ['线代'] })];
    expect(resolveCardReference('线代', aliased)).toBeUndefined();
  });

  it('collects resolved source/target pairs from text blocks', () => {
    const linked = [
      withText('a', '玻尔兹曼', '是[[德国]]人，也提出了[[玻尔兹曼熵]]。'),
      makeCard('b', { title: '德国' }),
      makeCard('c', { title: '玻尔兹曼熵' }),
    ];
    expect(resolvedCardReferencePairs(linked).map(pair => [pair.source, pair.target])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ]);
  });
});
