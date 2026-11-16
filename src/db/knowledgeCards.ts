import type { KnowledgeCard, KnowledgeCardLibrary, KnowledgeMap } from '../types/knowledge';
import { deepClone, mutate, store } from '../services/store';
import { normalizeKnowledgeData } from '../utils/knowledgeMigration';

let pending: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
}

/** Read the library inside each mutation, never from an earlier UI snapshot. */
function library(): KnowledgeCardLibrary {
  return store.knowledgeCards.find(item => item.id === 1) ?? store.knowledgeCards[0]
    ?? { id: 1, records: [], audioExportPath: '', updatedAt: 0 };
}

async function transaction(change: () => void): Promise<void> {
  let before: { knowledgeCards: KnowledgeCardLibrary[]; knowledgeMaps: KnowledgeMap[] } | undefined;
  try {
    const ok = await mutate(() => {
      before = deepClone({ knowledgeCards: store.knowledgeCards, knowledgeMaps: store.knowledgeMaps });
      change();
    }, { writeOrder: ['knowledgeCards', 'knowledgeMaps'], skipActivity: true });
    if (!ok) throw new Error('Failed to save knowledge cards');
  } catch (error) {
    if (before) {
      store.knowledgeCards = before.knowledgeCards;
      store.knowledgeMaps = before.knowledgeMaps;
    }
    throw error;
  }
}

/** Persist migrated records before removing the legacy source fields on disk. */
export function initializeKnowledgeCards(): Promise<void> {
  const hasLegacy = store.knowledgeMaps.some(map => map.nodes.some(node => {
    const legacy = node as typeof node & { cards?: unknown; note?: unknown };
    return 'cards' in legacy || 'note' in legacy;
  }));
  if (!hasLegacy) return Promise.resolve();
  return serialized(() => transaction(() => {
    const normalized = normalizeKnowledgeData(store);
    for (const map of normalized.knowledgeMaps) {
      for (const node of map.nodes) {
        const legacy = node as typeof node & { cards?: unknown; note?: unknown };
        delete legacy.cards;
        delete legacy.note;
      }
    }
    store.knowledgeCards = normalized.knowledgeCards;
    store.knowledgeMaps = normalized.knowledgeMaps;
  }));
}

export async function getCards(): Promise<KnowledgeCard[]> {
  await pending;
  return deepClone(library().records.map(record => record.card));
}

export function saveCard(card: KnowledgeCard): Promise<string> {
  const clean = deepClone(card);
  return serialized(async () => {
    if (!clean.id) throw new Error('Knowledge card ID is required');
    await transaction(() => {
      const current = deepClone(library());
      const now = Date.now();
      const index = current.records.findIndex(record => record.id === clean.id);
      const previous = current.records[index];
      const saved = { ...clean, createdAt: previous?.card.createdAt ?? clean.createdAt ?? now, updatedAt: now };
      const record = { id: clean.id, card: saved, createdAt: previous?.createdAt ?? saved.createdAt, updatedAt: now };
      if (index < 0) current.records.push(record);
      else current.records[index] = record;
      store.knowledgeCards = [{ ...current, id: 1, updatedAt: now }];
    });
    return clean.id;
  });
}

export function deleteCard(id: string): Promise<void> {
  return serialized(() => transaction(() => {
    const current = deepClone(library());
    store.knowledgeCards = [{ ...current, id: 1, records: current.records.filter(record => record.id !== id), updatedAt: Date.now() }];
    for (const map of store.knowledgeMaps) {
      for (const node of map.nodes) {
        if (node.cardIds?.includes(id)) {
          node.cardIds = node.cardIds.filter(cardId => cardId !== id);
          map.updatedAt = Date.now();
        }
      }
    }
  }));
}

export function linkCard(cardId: string, courseId: number, nodeId: string, options: { move?: true } = {}): Promise<void> {
  return serialized(() => transaction(() => {
    if (!library().records.some(record => record.id === cardId)) throw new Error('Knowledge card does not exist');
    const targetMap = store.knowledgeMaps.find(map => map.courseId === courseId);
    const target = targetMap?.nodes.find(node => node.id === nodeId);
    if (!target || !targetMap) throw new Error('Knowledge node does not exist');
    if (target.children.length || targetMap.nodes.some(node => node.parentId === target.id)) throw new Error('Cards can only be linked to leaf nodes');
    if (options.move) {
      for (const map of store.knowledgeMaps) {
        for (const node of map.nodes) {
          if (node.cardIds?.includes(cardId)) {
            node.cardIds = node.cardIds.filter(id => id !== cardId);
            map.updatedAt = Date.now();
          }
        }
      }
    }
    target.cardIds ??= [];
    if (!target.cardIds.includes(cardId)) {
      target.cardIds.push(cardId);
      targetMap.updatedAt = Date.now();
    }
  }));
}
