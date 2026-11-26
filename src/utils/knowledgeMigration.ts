import type { KnowledgeCard, KnowledgeCardContent, KnowledgeCardLibrary, KnowledgeCardRecord, KnowledgeMap, KnowledgeNode } from '../types/knowledge';

type LegacyCard = Partial<KnowledgeCard> & { text?: string; images?: string[] };
type LegacyBlock = Partial<KnowledgeCardContent> & { id?: string; text?: string; checklist?: boolean; checked?: boolean; data?: string };
type LegacyNode = KnowledgeNode & { cards?: LegacyCard[]; note?: { blocks?: LegacyBlock[]; updatedAt?: number; [key: string]: unknown } };

export interface KnowledgeMigrationInput {
  knowledgeMaps?: KnowledgeMap[];
  knowledgeCards?: KnowledgeCardLibrary[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function contentsFor(card: LegacyCard, id: string, createdAt: number, updatedAt: number): KnowledgeCardContent[] {
  if (Array.isArray(card.contents)) return clone(card.contents);
  const contents: KnowledgeCardContent[] = (card.images ?? []).map((data, index) => ({
    id: `${id}:image:${index}`, kind: 'image', data, createdAt, updatedAt,
  }));
  if (typeof card.text === 'string') contents.push({ id: `${id}:text`, kind: 'text', text: card.text, createdAt, updatedAt });
  return contents;
}

/** Pure, deterministic migration. Legacy source fields remain on the returned copies.
 * Only the database transaction may remove them after arranging durable writes.
 */
export function normalizeKnowledgeData(input: KnowledgeMigrationInput): { knowledgeMaps: KnowledgeMap[]; knowledgeCards: KnowledgeCardLibrary[] } {
  const knowledgeMaps = clone(input.knowledgeMaps ?? []);
  const libraries = clone(input.knowledgeCards ?? []);
  const primary = libraries.find(library => library.id === 1) ?? libraries[0];
  const library: KnowledgeCardLibrary = { ...primary, id: 1, records: [], audioExportPath: primary?.audioExportPath ?? '', updatedAt: primary?.updatedAt ?? 0 };
  const records = new Map<string, KnowledgeCardRecord>();
  // Retain every independent record when folding old singleton copies together.
  for (const source of libraries) {
    for (const record of source.records ?? []) {
      const previous = records.get(record.id);
      if (!previous || record.updatedAt > previous.updatedAt) records.set(record.id, record);
    }
  }
  for (const map of knowledgeMaps) {
    for (const node of map.nodes as LegacyNode[]) {
      node.cardIds = [...new Set(node.cardIds ?? [])];
      const scope = `legacy:${encodeURIComponent(String(map.id ?? map.courseId))}:${encodeURIComponent(node.id)}`;
      const add = (card: KnowledgeCard) => {
        // Re-running migration must never overwrite a card edited after migration.
        if (!records.has(card.id)) records.set(card.id, { id: card.id, card, createdAt: card.createdAt, updatedAt: card.updatedAt });
        if (!node.cardIds.includes(card.id)) node.cardIds.push(card.id);
      };
      for (const [index, old] of (node.cards ?? []).entries()) {
        const id = `${scope}:card:${index}:${encodeURIComponent(old.id ?? '')}`;
        const createdAt = old.createdAt ?? map.createdAt ?? 0;
        const updatedAt = old.updatedAt ?? map.updatedAt ?? createdAt;
        add({ ...old, id, title: old.title ?? node.title, contents: contentsFor(old, id, createdAt, updatedAt), createdAt, updatedAt });
      }
      if (node.note && Array.isArray(node.note.blocks) && node.note.blocks.length) {
        const id = `${scope}:note`;
        const createdAt = map.createdAt ?? 0;
        const updatedAt = node.note.updatedAt ?? map.updatedAt ?? createdAt;
        const contents: KnowledgeCardContent[] = node.note.blocks.map((block, index) => {
          const base = { ...block, id: `${id}:block:${index}:${encodeURIComponent(block.id ?? '')}`, createdAt, updatedAt };
          if (block.kind === 'image') return { ...base, kind: 'image', data: block.data ?? '' };
          if (block.kind === 'audio') {
            const audio = block as Extract<KnowledgeCardContent, { kind: 'audio' }>;
            return { ...base, kind: 'audio', data: audio.data ?? '', mimeType: audio.mimeType ?? '', durationMs: audio.durationMs ?? 0, fileName: audio.fileName ?? '' };
          }
          const text = block.text ?? '';
          return { ...base, kind: 'text', text: block.checklist ? `- [${block.checked ? 'x' : ' '}] ${text}` : text };
        });
        add({ id, title: node.title, status: node.status, contents, createdAt, updatedAt });
      }
    }
  }
  library.records = [...records.values()];
  return { knowledgeMaps, knowledgeCards: [library] };
}
