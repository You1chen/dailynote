import type { KnowledgeCard, KnowledgeCardContent, KnowledgeCardLibrary, KnowledgeCardRecord } from '../types/knowledge';

type LegacyCard = Partial<KnowledgeCard> & { text?: string; images?: string[] };
type LegacyBlock = Partial<KnowledgeCardContent> & { text?: string; checklist?: boolean; checked?: boolean; data?: string };
type LegacyNode = {
  id: string;
  title: string;
  status?: KnowledgeCard['status'];
  cards?: LegacyCard[];
  note?: { blocks?: LegacyBlock[]; updatedAt?: number };
};

export type LegacyKnowledgeMap = {
  id?: number;
  courseId: number;
  nodes?: LegacyNode[];
  createdAt?: number;
  updatedAt?: number;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function contentsFor(card: LegacyCard, id: string, createdAt: number, updatedAt: number): KnowledgeCardContent[] {
  if (Array.isArray(card.contents)) return clone(card.contents);
  const contents: KnowledgeCardContent[] = (Array.isArray(card.images) ? card.images : []).map((data, index) => ({
    id: `${id}:image:${index}`, kind: 'image', data, createdAt, updatedAt,
  }));
  if (typeof card.text === 'string') contents.push({ id: `${id}:text`, kind: 'text', text: card.text, createdAt, updatedAt });
  return contents;
}

/** Returns a new library only when archived embedded cards or note blocks need conversion. */
export function migrateLegacyKnowledgeCards(
  maps: readonly LegacyKnowledgeMap[],
  libraries: readonly KnowledgeCardLibrary[],
): KnowledgeCardLibrary[] | undefined {
  const primary = libraries.find(library => library.id === 1) ?? libraries[0];
  if (!maps.length || primary?.legacyMapsMigrated) return;
  const library: KnowledgeCardLibrary = {
    ...primary, id: 1, records: [], audioExportPath: primary?.audioExportPath ?? '',
    updatedAt: primary?.updatedAt ?? 0, legacyMapsMigrated: true,
  };
  const records = new Map<string, KnowledgeCardRecord>();
  // Retain every independent record when folding old singleton copies together.
  for (const source of libraries) {
    for (const record of source.records ?? []) {
      const previous = records.get(record.id);
      if (!previous || record.updatedAt > previous.updatedAt) records.set(record.id, record);
    }
  }
  let foundEmbeddedData = false;
  for (const map of maps) {
    for (const node of Array.isArray(map?.nodes) ? map.nodes : []) {
      if (!node || typeof node.id !== 'string') continue;
      const scope = `legacy:${encodeURIComponent(String(map.id ?? map.courseId))}:${encodeURIComponent(node.id)}`;
      const add = (card: KnowledgeCard) => {
        foundEmbeddedData = true;
        // Keep the independent record, which could already have been edited.
        if (!records.has(card.id)) records.set(card.id, { id: card.id, card, createdAt: card.createdAt, updatedAt: card.updatedAt });
      };
      for (const [index, old] of (Array.isArray(node.cards) ? node.cards : []).entries()) {
        if (!old || typeof old !== 'object') continue;
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
  if (!foundEmbeddedData) return;
  library.records = [...records.values()];
  return [library];
}
