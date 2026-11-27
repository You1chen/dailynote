import { describe, expect, it } from 'vitest';
import type { KnowledgeCard } from '../src/types/knowledge';
import type { CardGraph } from '../src/v2/utils/cardGraph';
import { buildCardGraph, cardKeywords } from '../src/v2/utils/cardGraph';
import { layoutCardGraph } from '../src/v2/utils/graphLayout';

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

const findEdge = (graph: CardGraph, left: string, right: string) => {
  const [source, target] = left < right ? [left, right] : [right, left];
  return graph.edges.find(edge => edge.source === source && edge.target === target);
};

const distance = (points: Record<string, { x: number; y: number }>, left: string, right: string): number =>
  Math.hypot(points[left].x - points[right].x, points[left].y - points[right].y);

describe('confirmed card links', () => {
  it('dedupes undirected links and ignores self links and unknown ids', () => {
    const cards = [
      makeCard('a', { type: 'type-a', links: ['b', 'b', 'a', 'ghost', '  '] }),
      makeCard('b', { type: 'type-b', links: ['a'] }),
      makeCard('c', { type: 'type-c' }),
    ];
    const graph = buildCardGraph(cards);

    expect(graph.nodes.map(node => node.id)).toEqual(['a', 'b', 'c']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      id: 'a--b',
      source: 'a',
      target: 'b',
      kind: 'manual',
      kinds: ['manual'],
      weight: 3,
    });
    expect(graph.degree).toEqual({ a: 1, b: 1, c: 0 });
    expect(graph.nodes.map(node => node.degree)).toEqual([1, 1, 0]);
  });

  it('links cards that share an explicitly set keyword', () => {
    const cards = [
      makeCard('a', { type: 'type-a', keywords: ['线代'] }),
      makeCard('b', { type: 'type-b', keywords: [' 线代 '] }),
      makeCard('c', { type: 'type-c', keywords: ['英语'] }),
    ];
    const graph = buildCardGraph(cards);

    expect(graph.edges).toHaveLength(1);
    expect(findEdge(graph, 'a', 'b')).toMatchObject({ kind: 'keyword', kinds: ['keyword'], weight: 2 });
    expect(graph.degree).toEqual({ a: 1, b: 1, c: 0 });
  });

  it('keeps manual as the winning kind when keyword and tag also match', () => {
    const cards = [
      makeCard('a', { type: 'same-type', courseIds: [1], tags: ['Shared'], keywords: ['索引'], links: ['b'] }),
      makeCard('b', { type: 'same-type', courseIds: [1], tags: ['shared'], keywords: ['索引'], links: ['a'] }),
    ];
    const graph = buildCardGraph(cards);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].kind).toBe('manual');
    expect(graph.edges[0].kinds).toEqual(['manual', 'keyword', 'tag']);
    expect(graph.edges[0].weight).toBe(3);
  });
});

describe('confirmed tags', () => {
  it('normalizes tags before grouping and rings large tag groups', () => {
    const tags = [' AI ', 'ai', 'Ai', 'AI ', ' ai', 'aI'];
    const cards = tags.map((tag, index) =>
      makeCard(`t${index}`, { title: '', type: `tag-type-${index}`, tags: [tag], createdAt: index }),
    );
    const graph = buildCardGraph(cards);

    expect(graph.edges).toHaveLength(6);
    expect(graph.edges.every(edge => edge.kind === 'tag' && edge.kinds[0] === 'tag')).toBe(true);
    expect(Object.values(graph.degree)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('connects all pairs for small tag groups', () => {
    const cards = Array.from({ length: 4 }, (_, index) =>
      makeCard(`c${index}`, { title: '', type: `small-type-${index}`, tags: ['一起'], createdAt: index }),
    );
    expect(buildCardGraph(cards).edges).toHaveLength(6);
  });

  it('can build a keyword-only graph', () => {
    const cards = [
      makeCard('a', { title: '', tags: ['共享'], keywords: ['主题'] }),
      makeCard('b', { title: '', tags: ['共享'], keywords: ['主题'] }),
    ];
    expect(buildCardGraph(cards, { includeTags: false }).edges).toHaveLength(1);
    expect(buildCardGraph(cards, { includeTags: false }).edges[0].kind).toBe('keyword');
  });
});

describe('inline page references', () => {
  it('turns [[卡片标题]] into a confirmed reference edge', () => {
    const cards = [
      cardWithText('a', '玻尔兹曼', '他是[[德国]]人。'),
      makeCard('b', { title: '德国' }),
      makeCard('c', { title: '康德' }),
    ];
    const graph = buildCardGraph(cards);

    expect(graph.edges).toHaveLength(1);
    expect(findEdge(graph, 'a', 'b')).toMatchObject({ kind: 'reference', kinds: ['reference'], weight: 2.5 });
    expect(findEdge(graph, 'a', 'c')).toBeUndefined();
  });

  it('merges references with manual links and ignores unresolved titles', () => {
    const cards = [
      cardWithText('a', '甲', '[[乙]] 和 [[幽灵]]', { links: ['b'] }),
      makeCard('b', { title: '乙' }),
    ];
    const graph = buildCardGraph(cards);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ kind: 'manual', kinds: ['manual', 'reference'] });
  });
});

describe('discoveries do not become edges', () => {
  it('does not connect cards just because their text is similar', () => {
    const cards = [
      cardWithText('a', '数据库索引优化', 'B+ 树索引能减少数据库查询的磁盘读取。'),
      cardWithText('b', '数据库索引原理', '数据库索引通常使用 B+ 树结构，磁盘读取是重点。'),
    ];
    expect(buildCardGraph(cards).edges).toEqual([]);
  });

  it('does not connect cards because one title appears in another card', () => {
    const cards = [
      cardWithText('a', '今天的复盘', '复习了「数据库索引优化」里的 B+ 树。'),
      makeCard('b', { title: '数据库索引优化' }),
    ];
    expect(buildCardGraph(cards).edges).toEqual([]);
  });

  it('does not use shared courses or card types as links', () => {
    const cards = [
      makeCard('a', { title: '', type: '知识', courseIds: [7] }),
      makeCard('b', { title: '', type: '知识', courseIds: [7] }),
      makeCard('c', { title: '', type: '知识', courseIds: [7] }),
    ];
    expect(buildCardGraph(cards).edges).toEqual([]);
    expect(buildCardGraph(cards, { includeTags: true }).edges).toEqual([]);
  });
});

describe('cardKeywords', () => {
  it('extracts latin words, CJK bigrams and drops stopwords and numbers', () => {
    const keywords = cardKeywords(cardWithText('kw', 'React Hooks 学习笔记', '我们的学习方法，React 状态管理 2026 数字42 AI to go data'));

    expect(keywords).toContain('react');
    expect(keywords).toContain('hooks');
    expect(keywords).toContain('学习');
    expect(keywords).toContain('状态');
    expect(keywords).toContain('数字');
    // Stopword characters are separators, so noisy bigrams never surface.
    expect(keywords).not.toContain('我们');
    expect(keywords).not.toContain('的是');
    expect(keywords).not.toContain('2026');
    expect(keywords).not.toContain('ai');
    expect(keywords).not.toContain('to');
    // Deduplicated (react appears twice in the source text) and sorted.
    expect(new Set(keywords).size).toBe(keywords.length);
    expect(keywords).toEqual([...keywords].sort());
    expect(keywords.every(token => !/^\d+$/.test(token))).toBe(true);
  });
});

describe('graphLayout', () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, degree: index % 4 }));
  const edges = nodes.map((node, index) => ({ source: node.id, target: nodes[(index + 1) % nodes.length].id, weight: 1 + (index % 2) * 0.5 }));

  it('returns an empty layout for no nodes', () => {
    expect(layoutCardGraph([], [])).toEqual({});
  });

  it('centers a single node', () => {
    expect(layoutCardGraph([{ id: 'solo', degree: 0 }], [], { width: 500, height: 300 })).toEqual({
      solo: { x: 250, y: 150 },
    });
  });

  it('is deterministic for identical input', () => {
    const options = { width: 800, height: 600, iterations: 200, padding: 40, seed: 11 };
    const first = layoutCardGraph(nodes, edges, options);
    const second = layoutCardGraph(
      nodes.map(node => ({ ...node })),
      edges.map(edge => ({ ...edge })),
      options,
    );
    expect(second).toEqual(first);
  });

  it('keeps every node inside the padded bounds', () => {
    const width = 800;
    const height = 600;
    const padding = 40;
    const points = layoutCardGraph(nodes, edges, { width, height, padding, iterations: 300 });

    expect(Object.keys(points)).toHaveLength(nodes.length);
    for (const node of nodes) {
      const point = points[node.id];
      expect(point.x).toBeGreaterThanOrEqual(padding);
      expect(point.x).toBeLessThanOrEqual(width - padding);
      expect(point.y).toBeGreaterThanOrEqual(padding);
      expect(point.y).toBeLessThanOrEqual(height - padding);
    }
  });

  it('reserves an asymmetric right safe area for floating controls', () => {
    const points = layoutCardGraph(nodes, edges, {
      width: 400,
      height: 300,
      padding: 20,
      paddingRight: 100,
      iterations: 260,
    });

    for (const point of Object.values(points)) {
      expect(point.x).toBeGreaterThanOrEqual(20);
      expect(point.x).toBeLessThanOrEqual(300);
    }
  });

  it('ignores unknown endpoints, self loops and duplicate edges', () => {
    const points = layoutCardGraph(
      [{ id: 'a', degree: 1 }, { id: 'b', degree: 1 }],
      [
        { source: 'a', target: 'ghost' },
        { source: 'a', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'a', target: 'b' },
      ],
      { width: 400, height: 300, iterations: 120 },
    );
    expect(Object.keys(points).sort()).toEqual(['a', 'b']);
    for (const point of Object.values(points)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(400);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(300);
    }
  });

  it('pulls connected clusters closer together than unrelated cards', () => {
    const clusterNodes: Array<{ id: string; degree: number }> = [];
    const clusterEdges: Array<{ source: string; target: string }> = [];
    for (let cluster = 0; cluster < 3; cluster++) {
      const ids = Array.from({ length: 4 }, (_, index) => `cluster${cluster}-${index}`);
      for (const id of ids) clusterNodes.push({ id, degree: 2 });
      for (let index = 0; index < ids.length; index++) {
        clusterEdges.push({ source: ids[index], target: ids[(index + 1) % ids.length] });
      }
    }
    const points = layoutCardGraph(clusterNodes, clusterEdges, { width: 1000, height: 700, iterations: 420 });

    const intra: number[] = [];
    const cross: number[] = [];
    for (let left = 0; left < clusterNodes.length; left++) {
      for (let right = left + 1; right < clusterNodes.length; right++) {
        const leftCluster = clusterNodes[left].id.split('-')[0];
        const rightCluster = clusterNodes[right].id.split('-')[0];
        (leftCluster === rightCluster ? intra : cross).push(distance(points, clusterNodes[left].id, clusterNodes[right].id));
      }
    }
    const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(average(intra)).toBeLessThan(average(cross));
  });
});
