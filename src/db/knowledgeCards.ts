import type { KnowledgeCard, KnowledgeCardLibrary } from '../types/knowledge';
import { deepClone, mutate, store } from '../services/store';

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
  let before: KnowledgeCardLibrary[] | undefined;
  try {
    const ok = await mutate(() => {
      before = store.knowledgeCards;
      change();
    });
    if (!ok) throw new Error('Failed to save knowledge cards');
  } catch (error) {
    if (before) store.knowledgeCards = before;
    throw error;
  }
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

export const DEFAULT_CARD_TYPES = ['知识', '顿悟', '鉴赏', '疑问'] as const;

export async function getCustomCardTypes(): Promise<string[]> {
  await pending;
  return [...new Set(library().customTypes ?? [])];
}

export function addCustomCardType(value: string): Promise<void> {
  return serialized(() => transaction(() => {
    const label = value.trim();
    if (!label) throw new Error('请输入类型名称');
    if (label.length > 24) throw new Error('类型名称最多 24 字');
    const current = library();
    const customTypes = [...new Set([...(current.customTypes ?? []), label])].filter(type => !DEFAULT_CARD_TYPES.some(item => item === type));
    store.knowledgeCards = [{ ...current, id: 1, customTypes, updatedAt: Date.now() }];
  }));
}

export function removeCustomCardType(value: string): Promise<void> {
  return serialized(() => transaction(() => {
    const current = library();
    store.knowledgeCards = [{ ...current, id: 1, customTypes: (current.customTypes ?? []).filter(type => type !== value), updatedAt: Date.now() }];
  }));
}

export function deleteCard(id: string): Promise<void> {
  return serialized(() => transaction(() => {
    const current = deepClone(library());
    store.knowledgeCards = [{ ...current, id: 1, records: current.records.filter(record => record.id !== id), updatedAt: Date.now() }];
  }));
}

export async function getCardAudioExportPath(): Promise<string> {
  await pending;
  return library().audioExportPath;
}

export function setCardAudioExportPath(path: string): Promise<void> {
  return serialized(() => transaction(() => {
    store.knowledgeCards = [{ ...library(), id: 1, audioExportPath: path, updatedAt: Date.now() }];
  }));
}
