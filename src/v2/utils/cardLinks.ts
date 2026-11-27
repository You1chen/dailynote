import type { KnowledgeCard } from '../../types/knowledge';

/**
 * Logseq-style page references inside card text: `[[卡片标题]]`.
 *
 * The text stays plain text (portable, editable); resolving a reference to a
 * card happens at render / graph-build time. A keyword or tag can act as a
 * page alias when exactly one card owns that name.
 */

export interface CardReference {
  /** Inner text, without the brackets. */
  title: string;
  /** Original `[[...]]` text. */
  raw: string;
  /** Offset in the source text. */
  index: number;
  length: number;
}

const REF_PATTERN = /\[\[([^\[\]\n]{1,100})\]\]/g;

export function extractCardReferences(text: string): CardReference[] {
  const references: CardReference[] = [];
  if (!text) return references;
  const pattern = new RegExp(REF_PATTERN.source, 'g');
  for (const match of text.matchAll(pattern)) {
    const title = match[1].trim();
    if (!title) continue;
    references.push({
      title,
      raw: match[0],
      index: match.index ?? 0,
      length: match[0].length,
    });
  }
  return references;
}

export function extractCardReferenceTitles(text: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const reference of extractCardReferences(text)) {
    const key = normalizeCardRef(reference.title);
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(reference.title);
  }
  return titles;
}

export function normalizeCardRef(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cardAliases(card: KnowledgeCard): string[] {
  return [
    card.title,
    ...(card.keywords ?? []),
    ...(card.tags ?? []),
  ].map(normalizeCardRef).filter(Boolean);
}

/** Resolve a `[[page name]]` to one card. Ambiguous aliases stay unresolved. */
export function resolveCardReference(
  title: string,
  cards: readonly KnowledgeCard[],
  excludeId?: string,
): KnowledgeCard | undefined {
  const key = normalizeCardRef(title);
  if (!key) return undefined;

  const exact = cards.find(card => card.id !== excludeId && normalizeCardRef(card.title) === key);
  if (exact) return exact;

  const aliased = cards.filter(card => card.id !== excludeId && cardAliases(card).includes(key));
  return aliased.length === 1 ? aliased[0] : undefined;
}

/** All text blocks that may contain references. */
export function cardReferenceTexts(card: KnowledgeCard): string[] {
  return (card.contents ?? [])
    .filter((content): content is Extract<KnowledgeCard['contents'][number], { kind: 'text' }> => content.kind === 'text')
    .map(content => content.text);
}

/** Resolved reference pairs, one entry per unique source/target/title. */
export function resolvedCardReferencePairs(cards: readonly KnowledgeCard[]): Array<{
  source: string;
  target: string;
  title: string;
}> {
  const pairs = new Map<string, { source: string; target: string; title: string }>();
  for (const card of cards) {
    for (const text of cardReferenceTexts(card)) {
      for (const reference of extractCardReferences(text)) {
        const target = resolveCardReference(reference.title, cards, card.id);
        if (!target) continue;
        const key = `${card.id}\u0000${target.id}\u0000${normalizeCardRef(reference.title)}`;
        if (!pairs.has(key)) pairs.set(key, { source: card.id, target: target.id, title: reference.title });
      }
    }
  }
  return [...pairs.values()];
}

/** Plain text for snippets/search: `[[标题]]` becomes `标题`. */
export function stripCardReferences(text: string): string {
  return text.replace(REF_PATTERN, '$1');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rename every matching `[[old title]]` after a card title change, the same
 * way Logseq updates page references. Returns the text unchanged when empty.
 */
export function replaceCardReferenceTitle(text: string, oldTitle: string, newTitle: string): string {
  const from = oldTitle.trim();
  const to = newTitle.trim();
  if (!from || !to || from === to) return text;
  const pattern = new RegExp(`\\[\\[\\s*${escapeRegExp(from)}\\s*\\]\\]`, 'gi');
  return text.replace(pattern, `[[${to}]]`);
}
