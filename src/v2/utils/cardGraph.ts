import type { KnowledgeCard } from '../../types/knowledge';
import { resolvedCardReferencePairs } from './cardLinks';

/**
 * Confirmed-relationship graph for the knowledge-card network.
 *
 * Only explicit anchors create edges:
 *  - a card link (`links`) = a block reference;
 *  - a `[[标题]]` page reference in text = an inline page link;
 *  - a shared keyword = a page reference;
 *  - a shared tag = a page reference.
 *
 * Text similarity, mentions of another card's title, course grouping and card
 * type are *discoveries*, not links. They are produced separately by
 * `cardDiscovery.ts`, shown as dashed suggestions, and become edges only after
 * the writer confirms them. This keeps the written graph clean and reversible.
 */

export type CardEdgeKind = 'manual' | 'reference' | 'keyword' | 'tag';

export interface CardGraphNode {
  id: string;
  card: KnowledgeCard;
  degree: number;
}

export interface CardGraphEdge {
  id: string; // stable, e.g. `${source}--${target}`
  source: string;
  target: string; // canonical order: source < target
  kind: CardEdgeKind; // strongest kind for styling
  kinds: CardEdgeKind[]; // all reasons, strongest first
  weight: number; // 1..3-ish, for line thickness
}

export interface CardGraph {
  nodes: CardGraphNode[];
  edges: CardGraphEdge[];
  degree: Record<string, number>;
}

export interface BuildCardGraphOptions {
  /** Shared tags still count as page references; disable for a keyword-only graph. */
  includeTags?: boolean;
}

/** Strongest-first ordering used for `kinds` and edge styling. */
const KIND_ORDER: readonly CardEdgeKind[] = ['manual', 'reference', 'keyword', 'tag'];

/** Base line weight of the strongest reason on an edge. */
const BASE_EDGE_WEIGHT: Record<CardEdgeKind, number> = {
  manual: 3,
  reference: 2.5,
  keyword: 2,
  tag: 1.5,
};
const EXTRA_REASON_WEIGHT = 0.25;
const MAX_EDGE_WEIGHT = 3;

/** Up to this many cards a keyword/tag group may use all pairs; above it a ring is used. */
const ALL_PAIRS_GROUP_LIMIT = 4;

/**
 * Single CJK characters that carry little topical meaning. They act as
 * separators before bigrams are generated, so e.g. "我们的学习" yields "学习"
 * instead of noisy cross-stopword bigrams such as "们的" / "的学".
 */
const CJK_STOP_CHARS = '的了是我你他她它们这那有和与就不也都一个上下来去说会到看想等很还又被把让从对为中及其之以于而';
const CJK_STOP_CHAR_RE = new RegExp(`[${CJK_STOP_CHARS}]`, 'g');

/** Extra two-character stopwords that survive the single-character pass. */
const CJK_STOP_TOKENS = new Set([
  '什么', '怎么', '那么', '这样', '那样', '可以', '因为', '所以', '如果', '但是',
  '进行', '通过', '需要', '应该', '时候', '问题', '东西',
]);

const compareIds = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** All textual content that keyword extraction is allowed to read. */
function cardText(card: KnowledgeCard): string {
  const parts: string[] = [card.title];
  for (const content of card.contents ?? []) {
    if (content.kind !== 'text') continue;
    parts.push(content.text);
    for (const comment of content.comments ?? []) parts.push(comment.text);
  }
  return parts.join('\n').toLowerCase();
}

/**
 * Extract comparable keyword tokens from a card title + text contents.
 * Exported for tests and reused by the semantic discovery engine.
 *
 * - Latin words: at least 3 characters, lowercased.
 * - CJK runs: 2-character bigrams after removing common stopword characters.
 * - Tokens are deduplicated and purely numeric tokens are ignored.
 */
export function cardKeywords(card: KnowledgeCard): string[] {
  const tokens = new Set<string>();
  const text = cardText(card);

  // A leading letter rules out pure numbers ("2026") while still allowing
  // mixed tokens such as "react18".
  for (const match of text.matchAll(/[a-z][a-z0-9_]{2,}/g)) tokens.add(match[0]);

  for (const run of text.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (const segment of run.split(CJK_STOP_CHAR_RE)) {
      for (let index = 0; index + 1 < segment.length; index++) {
        const token = segment.slice(index, index + 2);
        if (!CJK_STOP_TOKENS.has(token)) tokens.add(token);
      }
    }
  }

  return [...tokens].sort(compareIds);
}

function normalizeTerms(values: readonly string[] | undefined): string[] {
  const terms = new Set<string>();
  for (const raw of values ?? []) {
    if (typeof raw !== 'string') continue;
    const term = raw.trim().toLowerCase();
    if (term) terms.add(term);
  }
  return [...terms];
}

/**
 * Connect a time-ordered id group without forming a clique.
 * Small groups use all pairs; larger groups use a ring along creation time.
 */
function timeOrderedLinks(ids: readonly string[], createdAt: (id: string) => number): Array<[string, string]> {
  const ordered = [...new Set(ids)].sort((left, right) => {
    const delta = createdAt(left) - createdAt(right);
    return delta || compareIds(left, right);
  });
  const links: Array<[string, string]> = [];
  if (ordered.length <= ALL_PAIRS_GROUP_LIMIT) {
    for (let left = 0; left < ordered.length; left++) {
      for (let right = left + 1; right < ordered.length; right++) links.push([ordered[left], ordered[right]]);
    }
    return links;
  }
  for (let index = 0; index < ordered.length; index++) {
    links.push([ordered[index], ordered[(index + 1) % ordered.length]]);
  }
  return links;
}

/** Line weight derived from the merged reasons, capped so styling stays in range. */
function edgeWeight(kinds: readonly CardEdgeKind[]): number {
  if (kinds.includes('manual')) return 3;
  const base = BASE_EDGE_WEIGHT[kinds[0]] ?? 1;
  return Math.min(MAX_EDGE_WEIGHT, base + Math.max(0, kinds.length - 1) * EXTRA_REASON_WEIGHT);
}

export function buildCardGraph(cards: KnowledgeCard[], options: BuildCardGraphOptions = {}): CardGraph {
  // One node per unique card id, preserving first-seen input order.
  const nodes: CardGraphNode[] = [];
  const nodeById = new Map<string, CardGraphNode>();
  for (const card of cards) {
    const id = String(card.id);
    if (nodeById.has(id)) continue;
    const node: CardGraphNode = { id, card, degree: 0 };
    nodeById.set(id, node);
    nodes.push(node);
  }

  const createdAt = (id: string): number => {
    const value = nodeById.get(id)?.card.createdAt;
    return Number.isFinite(value) ? (value as number) : 0;
  };

  const reasons = new Map<string, Set<CardEdgeKind>>();
  const pairKey = (left: string, right: string): string => (left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`);
  const addReason = (left: string, right: string, kind: CardEdgeKind): void => {
    if (left === right || !nodeById.has(left) || !nodeById.has(right)) return;
    const key = pairKey(left, right);
    let kinds = reasons.get(key);
    if (!kinds) {
      kinds = new Set<CardEdgeKind>();
      reasons.set(key, kinds);
    }
    kinds.add(kind);
  };

  // 1. Explicit card links are always built, deduplicated and undirected.
  for (const node of nodes) {
    for (const raw of node.card.links ?? []) {
      if (typeof raw !== 'string') continue;
      const target = raw.trim();
      if (!target || target === node.id || !nodeById.has(target)) continue;
      addReason(node.id, target, 'manual');
    }
  }

  // 2. Inline Logseq-style page references: [[卡片标题]] in card text.
  for (const reference of resolvedCardReferencePairs(nodes.map(node => node.card))) {
    addReason(reference.source, reference.target, 'reference');
  }

  // 3. Explicit keywords: a shared page name is a confirmed link.
  const keywordGroups = new Map<string, string[]>();
  for (const node of nodes) {
    for (const keyword of normalizeTerms(node.card.keywords)) {
      const group = keywordGroups.get(keyword);
      if (group) group.push(node.id);
      else keywordGroups.set(keyword, [node.id]);
    }
  }
  for (const group of keywordGroups.values()) {
    for (const [left, right] of timeOrderedLinks(group, createdAt)) addReason(left, right, 'keyword');
  }

  // 4. Tags are page references too; they are explicit, unlike inferred topics.
  if (options.includeTags !== false) {
    const tagGroups = new Map<string, string[]>();
    for (const node of nodes) {
      for (const tag of normalizeTerms(node.card.tags)) {
        const group = tagGroups.get(tag);
        if (group) group.push(node.id);
        else tagGroups.set(tag, [node.id]);
      }
    }
    for (const group of tagGroups.values()) {
      for (const [left, right] of timeOrderedLinks(group, createdAt)) addReason(left, right, 'tag');
    }
  }

  const edges: CardGraphEdge[] = [];
  for (const [key, kindSet] of reasons) {
    const separator = key.indexOf('\u0000');
    const source = key.slice(0, separator);
    const target = key.slice(separator + 1);
    const kinds = KIND_ORDER.filter(kind => kindSet.has(kind));
    if (!kinds.length) continue;
    edges.push({
      id: `${source}--${target}`,
      source,
      target,
      kind: kinds[0],
      kinds,
      weight: edgeWeight(kinds),
    });
  }
  edges.sort((left, right) => compareIds(left.source, right.source) || compareIds(left.target, right.target));

  const degree: Record<string, number> = {};
  for (const node of nodes) degree[node.id] = 0;
  for (const edge of edges) {
    degree[edge.source] = (degree[edge.source] ?? 0) + 1;
    degree[edge.target] = (degree[edge.target] ?? 0) + 1;
  }
  for (const node of nodes) node.degree = degree[node.id] ?? 0;

  return { nodes, edges, degree };
}
