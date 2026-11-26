import type { KnowledgeCard } from '../../types/knowledge';
import { cardKeywords } from './cardGraph';

/**
 * Logseq-style "discover, then confirm" link discovery.
 *
 * Two engines run locally and never write anything by themselves:
 *  - literal: another card's title / keyword appears in this card's text;
 *  - semantic: a light TF-IDF cosine similarity over card terms.
 *
 * The caller decides what to do with the suggestions. Accepting one can write
 * an explicit card link; ignoring one is remembered as negative feedback in
 * `KnowledgeCard.ignoredLinks`.
 */

export type CardLinkSuggestionKind = 'literal' | 'semantic';

export interface CardLinkSuggestion {
  /** Stable id, independent of direction. */
  id: string;
  /** Card whose text triggered the suggestion (literal) or the first card (semantic). */
  source: string;
  target: string;
  kind: CardLinkSuggestionKind;
  /** 0..1; literal matches usually outrank semantic ones. */
  confidence: number;
  /** Human-readable explanation shown in the confirmation queue. */
  reason: string;
  /** The matched page name / keyword, when the engine is literal. */
  anchor?: string;
}

export interface BuildCardLinkSuggestionsOptions {
  literal?: boolean;
  semantic?: boolean;
  maxLiteralPerCard?: number;
  maxSemanticPerCard?: number;
  maxTotal?: number;
  /** Cosine similarity gate for the semantic engine. */
  semanticThreshold?: number;
}

const DEFAULT_MAX_LITERAL_PER_CARD = 2;
const DEFAULT_MAX_SEMANTIC_PER_CARD = 2;
const DEFAULT_MAX_TOTAL = 48;
const DEFAULT_SEMANTIC_THRESHOLD = 0.3;

const pairKey = (left: string, right: string): string => (left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`);

/** Public canonical pair key used by the graph / confirmation UI. */
export function suggestionPairKey(left: string, right: string): string {
  return left < right ? `${left}--${right}` : `${right}--${left}`;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function isUsableAnchor(value: string): boolean {
  const text = compact(value);
  if (text.length < 2) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  // Placeholder titles are not page names and would match everything.
  if (/^(未命名|无标题|untitled)/iu.test(text)) return false;
  return true;
}

/** All text a discovery engine may read, including comments and audio names. */
export function discoveryText(card: KnowledgeCard): string {
  const parts: string[] = [card.title];
  for (const content of card.contents ?? []) {
    if (content.kind === 'text') {
      parts.push(content.text);
      for (const comment of content.comments ?? []) parts.push(comment.text);
    } else if (content.kind === 'audio') {
      parts.push(content.fileName);
    }
  }
  return normalizeText(parts.join('\n'));
}

/** Word-aware match: Latin anchors must sit on word boundaries, CJK uses substring. */
function anchorPattern(anchor: string): RegExp | null {
  if (!/^[a-z0-9][a-z0-9 _-]*$/.test(anchor)) return null;
  const pattern = escapeRegExp(anchor).replace(/ /g, '\\s+');
  return new RegExp(`(^|[^a-z0-9_])${pattern}([^a-z0-9_]|$)`, 'i');
}

function matchesAnchor(text: string, anchor: string, pattern: RegExp | null): boolean {
  return pattern ? pattern.test(text) : text.includes(anchor);
}

function normalizeTerms(values: readonly string[] | undefined): string[] {
  const terms = new Set<string>();
  for (const raw of values ?? []) {
    if (typeof raw !== 'string') continue;
    const term = normalizeText(raw);
    if (term) terms.add(term);
  }
  return [...terms];
}

/** Pairs that are already explicit links, shared keywords or shared tags. */
function confirmedPairs(cards: readonly KnowledgeCard[]): Set<string> {
  const byId = new Map(cards.map(card => [card.id, card]));
  const confirmed = new Set<string>();
  const mark = (left: string, right: string): void => {
    if (left !== right && byId.has(left) && byId.has(right)) confirmed.add(pairKey(left, right));
  };

  for (const card of cards) {
    for (const linked of card.links ?? []) mark(card.id, linked);
  }

  for (const field of ['keywords', 'tags'] as const) {
    const groups = new Map<string, string[]>();
    for (const card of cards) {
      for (const term of normalizeTerms(card[field])) {
        const group = groups.get(term);
        if (group) group.push(card.id);
        else groups.set(term, [card.id]);
      }
    }
    for (const group of groups.values()) {
      for (let left = 0; left < group.length; left++) {
        for (let right = left + 1; right < group.length; right++) mark(group[left], group[right]);
      }
    }
  }
  return confirmed;
}

/** Rejected suggestions are remembered symmetrically, but tolerate one-sided data. */
function ignoredPairs(cards: readonly KnowledgeCard[]): Set<string> {
  const ignored = new Set<string>();
  const known = new Set(cards.map(card => card.id));
  for (const card of cards) {
    for (const target of card.ignoredLinks ?? []) {
      if (target !== card.id && known.has(target)) ignored.add(pairKey(card.id, target));
    }
  }
  return ignored;
}

interface AnchorIndex {
  owners: Map<string, Set<string>>;
  display: Map<string, string>;
}

function addAnchor(index: AnchorIndex, raw: string, owner: string): void {
  if (!isUsableAnchor(raw)) return;
  const anchor = normalizeText(raw);
  if (!anchor) return;
  const owners = index.owners.get(anchor);
  if (owners) owners.add(owner);
  else index.owners.set(anchor, new Set([owner]));
  if (!index.display.has(anchor)) index.display.set(anchor, raw.trim().replace(/\s+/g, ' '));
}

function titleAnchors(cards: readonly KnowledgeCard[]): AnchorIndex {
  const index: AnchorIndex = { owners: new Map(), display: new Map() };
  for (const card of cards) addAnchor(index, card.title, card.id);
  return index;
}

function keywordAnchors(cards: readonly KnowledgeCard[]): AnchorIndex {
  const index: AnchorIndex = { owners: new Map(), display: new Map() };
  for (const card of cards) {
    for (const keyword of card.keywords ?? []) addAnchor(index, keyword, card.id);
  }
  return index;
}

interface LiteralHit {
  source: string;
  target: string;
  anchor: string;
  reason: string;
  confidence: number;
}

function collectLiteralHits(
  cards: readonly KnowledgeCard[],
  confirmed: ReadonlySet<string>,
  rejected: ReadonlySet<string>,
): LiteralHit[] {
  const hits = new Map<string, LiteralHit>();
  const sources = cards.map(card => ({ card, text: discoveryText(card) }));
  const titles = titleAnchors(cards);
  const keywords = keywordAnchors(cards);

  const visit = (index: AnchorIndex, kind: 'title' | 'keyword'): void => {
    const matchers = [...index.owners].map(([anchor, owners]) => ({
      anchor,
      owners,
      display: index.display.get(anchor) ?? anchor,
      pattern: anchorPattern(anchor),
      unique: owners.size === 1,
      length: compact(anchor).length,
    }));
    for (const { anchor, owners, display, pattern, unique, length } of matchers) {
      for (const { card: source, text } of sources) {
        if (!matchesAnchor(text, anchor, pattern)) continue;
        for (const target of owners) {
          if (target === source.id) continue;
          const pair = pairKey(source.id, target);
          if (confirmed.has(pair) || rejected.has(pair)) continue;
          const confidence = kind === 'title'
            ? unique
              ? (length >= 4 ? 0.92 : 0.84)
              : 0.56
            : unique
              ? 0.74
              : 0.5;
          const reason = kind === 'title' ? `正文提到「${display}」` : `提到关键词「${display}」`;
          const previous = hits.get(pair);
          if (previous && previous.confidence >= confidence) continue;
          hits.set(pair, { source: source.id, target, anchor: display, reason, confidence });
        }
      }
    }
  };

  visit(titles, 'title');
  visit(keywords, 'keyword');
  return [...hits.values()];
}

interface SemanticCandidate {
  left: string;
  right: string;
  similarity: number;
}

/**
 * Local TF-IDF cosine similarity. This is intentionally lightweight: no model
 * download, no network, runs on the same term extraction as the old heuristic.
 */
function collectSemanticHits(
  cards: readonly KnowledgeCard[],
  threshold: number,
  skip: ReadonlySet<string>,
): SemanticCandidate[] {
  interface Vector {
    tokens: string[];
    weight: Map<string, number>;
    norm: number;
  }

  const rawTokens = cards.map(card => [...new Set(cardKeywords(card))]);
  const documentFrequency = new Map<string, number>();
  for (const tokens of rawTokens) {
    for (const token of tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }

  const total = cards.length;
  const vectors: Vector[] = rawTokens.map(tokens => {
    const weight = new Map<string, number>();
    let squared = 0;
    for (const token of tokens) {
      const df = documentFrequency.get(token) ?? 1;
      const idf = Math.log((total + 1) / (df + 1)) + 1;
      weight.set(token, idf);
      squared += idf * idf;
    }
    return { tokens, weight, norm: Math.sqrt(squared) };
  });

  const inverted = new Map<string, number[]>();
  vectors.forEach((vector, index) => {
    for (const token of vector.tokens) {
      const list = inverted.get(token);
      if (list) list.push(index);
      else inverted.set(token, [index]);
    }
  });

  const shared = new Map<string, number>();
  const dots = new Map<string, number>();
  // Build dot products once per token; no pair loop runs without a shared token.
  for (const [token, list] of inverted) {
    if (list.length < 2) continue;
    for (let left = 0; left < list.length; left++) {
      const a = list[left];
      const weightA = vectors[a].weight.get(token) ?? 0;
      for (let right = left + 1; right < list.length; right++) {
        const b = list[right];
        const pair = pairKey(cards[a].id, cards[b].id);
        if (skip.has(pair)) continue;
        shared.set(pair, (shared.get(pair) ?? 0) + 1);
        dots.set(pair, (dots.get(pair) ?? 0) + weightA * (vectors[b].weight.get(token) ?? 0));
      }
    }
  }

  const out: SemanticCandidate[] = [];
  const indexById = new Map(cards.map((card, index) => [card.id, index]));
  for (const [pair, dot] of dots) {
    if ((shared.get(pair) ?? 0) < 2) continue;
    const [leftId, rightId] = pair.split('\u0000');
    const left = indexById.get(leftId);
    const right = indexById.get(rightId);
    if (left === undefined || right === undefined) continue;
    const denominator = vectors[left].norm * vectors[right].norm;
    if (!denominator) continue;
    const similarity = dot / denominator;
    if (similarity < threshold) continue;
    out.push({ left: leftId, right: rightId, similarity });
  }
  return out;
}

/**
 * Build a deterministic, capped suggestion queue. Literal matches are chosen
 * first, then semantic ones fill the remaining slots for each card.
 */
export function buildCardLinkSuggestions(
  cards: readonly KnowledgeCard[],
  options: BuildCardLinkSuggestionsOptions = {},
): CardLinkSuggestion[] {
  const unique = new Map<string, KnowledgeCard>();
  for (const card of cards) if (!unique.has(card.id)) unique.set(card.id, card);
  const items = [...unique.values()];
  if (items.length < 2) return [];

  const confirmed = confirmedPairs(items);
  const rejected = ignoredPairs(items);
  const maxLiteral = options.maxLiteralPerCard ?? DEFAULT_MAX_LITERAL_PER_CARD;
  const maxSemantic = options.maxSemanticPerCard ?? DEFAULT_MAX_SEMANTIC_PER_CARD;
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
  const threshold = options.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD;

  const selected: CardLinkSuggestion[] = [];
  const usedPairs = new Set<string>();
  const perCard = new Map<string, number>();
  const degree = (id: string): number => perCard.get(id) ?? 0;

  const take = (suggestion: CardLinkSuggestion, limit: number): boolean => {
    if (selected.length >= maxTotal) return false;
    const pair = pairKey(suggestion.source, suggestion.target);
    if (usedPairs.has(pair)) return false;
    if (degree(suggestion.source) >= limit || degree(suggestion.target) >= limit) return false;
    usedPairs.add(pair);
    perCard.set(suggestion.source, degree(suggestion.source) + 1);
    perCard.set(suggestion.target, degree(suggestion.target) + 1);
    selected.push(suggestion);
    return true;
  };

  if (options.literal !== false) {
    const hits = collectLiteralHits(items, confirmed, rejected)
      .sort((one, two) => two.confidence - one.confidence || one.source.localeCompare(two.source) || one.target.localeCompare(two.target));
    for (const hit of hits) {
      take({
        id: `literal:${suggestionPairKey(hit.source, hit.target)}`,
        source: hit.source,
        target: hit.target,
        kind: 'literal',
        confidence: hit.confidence,
        reason: hit.reason,
        anchor: hit.anchor,
      }, maxLiteral);
    }
  }

  if (options.semantic !== false) {
    const hits = collectSemanticHits(items, threshold, new Set([...confirmed, ...rejected, ...usedPairs]))
      .sort((one, two) => two.similarity - one.similarity || one.left.localeCompare(two.left) || one.right.localeCompare(two.right));
    for (const hit of hits) {
      const pair = pairKey(hit.left, hit.right);
      if (usedPairs.has(pair)) continue;
      take({
        id: `semantic:${suggestionPairKey(hit.left, hit.right)}`,
        source: hit.left,
        target: hit.right,
        kind: 'semantic',
        confidence: Math.min(0.95, hit.similarity),
        reason: `内容相近 · ${Math.round(hit.similarity * 100)}%`,
      }, maxSemantic);
    }
  }

  return selected;
}
