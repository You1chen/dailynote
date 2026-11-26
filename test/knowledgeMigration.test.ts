import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeCard, KnowledgeCardLibrary } from '../src/types/knowledge';
import { migrateLegacyKnowledgeCards, type LegacyKnowledgeMap } from '../src/utils/knowledgeMigration';

const storage = vi.hoisted(() => ({
  store: { knowledgeCards: [] as KnowledgeCardLibrary[] },
  fail: false,
  mutate: vi.fn(),
}));
vi.mock('../src/services/store', () => ({
  store: storage.store,
  deepClone: <T>(value: T): T => structuredClone(value),
  mutate: storage.mutate,
}));
import { addCustomCardType, getCustomCardTypes, removeCustomCardType, deleteCard, getCards, saveCard, getCardAudioExportPath, setCardAudioExportPath } from '../src/db/knowledgeCards';

function legacyMap(courseId = 12): LegacyKnowledgeMap {
  const nodes = [{ id: 'topic', title: 'Topic', status: 'learned' as const, cardIds: ['reference'],
    cards: [{ id: 'old', title: 'Original title', status: 'debt' as const, images: ['data:image/a', 'data:image/b'], text: ' first\nsecond ', createdAt: 11, updatedAt: 19 }],
    note: { updatedAt: 18, blocks: [
      { id: 'paragraph', text: 'full note\nwith whitespace ', checklist: false },
      { id: 'checked', text: 'finished', checklist: true, checked: true },
      { id: 'unchecked', text: 'pending', checklist: true, checked: false },
    ] },
  }];
  return { id: courseId, courseId, createdAt: 10, updatedAt: 20, nodes };
}
const card = (id: string): KnowledgeCard => ({ id, title: id, contents: [], createdAt: 1, updatedAt: 2 });

beforeEach(() => {
  storage.store.knowledgeCards = [];
  storage.fail = false;
  storage.mutate.mockReset();
  storage.mutate.mockImplementation(async (change: () => void) => { change(); return !storage.fail; });
});

describe('pure knowledge migration', () => {
  it('leaves its source untouched and converts images and ordered note blocks', () => {
    const maps = [legacyMap()];
    const original = structuredClone(maps);
    const migrated = migrateLegacyKnowledgeCards(maps, [])!;
    expect(maps).toEqual(original);
    const [old, note] = migrated[0].records.map(record => record.card);
    expect(old).toMatchObject({ id: 'legacy:12:topic:card:0:old', title: 'Original title', status: 'debt', createdAt: 11, updatedAt: 19 });
    expect(old.contents.map(content => content.kind)).toEqual(['image', 'image', 'text']);
    expect(old.contents).toMatchObject([{ data: 'data:image/a' }, { data: 'data:image/b' }, { text: ' first\nsecond ' }]);
    expect(note.contents).toMatchObject([{ text: 'full note\nwith whitespace ' }, { text: '- [x] finished' }, { text: '- [ ] pending' }]);
    expect(note).toMatchObject({ id: 'legacy:12:topic:note', updatedAt: 18 });
  });

  it('uses stable IDs, deduplicates copies, and keeps existing independent edits', () => {
    const maps = [legacyMap(), legacyMap(13), legacyMap()];
    maps[2].nodes![0].cards![0].title = 'Old duplicate';
    const migrated = migrateLegacyKnowledgeCards(maps, [])!;
    expect(migrateLegacyKnowledgeCards(maps, [])).toEqual(migrated);
    expect(migrated[0].records).toHaveLength(4);
    expect(migrated[0].records[0].card.title).toBe('Original title');
    const existing = { ...migrated[0], legacyMapsMigrated: undefined, records: migrated[0].records.slice(0, 1) };
    existing.records[0].card.title = 'Edited independently';
    expect(migrateLegacyKnowledgeCards(maps, [existing])![0].records[0].card.title).toBe('Edited independently');
    expect(migrateLegacyKnowledgeCards(maps, migrated)).toBeUndefined();
  });

  it('preserves current text, image, and audio contents and library settings', () => {
    const modern: KnowledgeCard = { ...card('modern'), contents: [
      { id: 't', kind: 'text', text: 'text', createdAt: 1, updatedAt: 2 },
      { id: 'i', kind: 'image', data: 'image data', createdAt: 2, updatedAt: 3 },
      { id: 'a', kind: 'audio', data: 'audio data', mimeType: 'audio/webm', fileName: 'lecture.webm', durationMs: 1250, createdAt: 3, updatedAt: 4 },
    ] };
    const independent = { id: 1, audioExportPath: '/lectures', customTypes: ['随想'], updatedAt: 7, records: [{ id: modern.id, card: modern, createdAt: 1, updatedAt: 4 }] };
    expect(migrateLegacyKnowledgeCards([], [independent])).toBeUndefined();
    expect(migrateLegacyKnowledgeCards([legacyMap()], [independent])![0]).toMatchObject({ ...independent, records: expect.arrayContaining(independent.records), legacyMapsMigrated: true });
  });
});

describe('knowledge card transactions', () => {
  it('saves concurrent edits against the latest library and returns detached card copies', async () => {
    await Promise.all([saveCard(card('a')), saveCard(card('b'))]);
    expect((await getCards()).map(item => item.id)).toEqual(['a', 'b']);
    const cards = await getCards();
    cards[0].title = 'do not leak';
    expect((await getCards())[0].title).toBe('a');
    storage.fail = true;
    const before = structuredClone(storage.store);
    await expect(saveCard({ ...card('a'), title: 'failed' })).rejects.toThrow('Failed to save');
    expect(storage.store).toEqual(before);
  });

  it('keeps the migration flag after changing audio settings and deleting cards', async () => {
    storage.store.knowledgeCards = migrateLegacyKnowledgeCards([legacyMap()], [])!;
    const [first, second] = await getCards();
    await Promise.all([deleteCard(first.id), setCardAudioExportPath('/lectures'), deleteCard(second.id)]);
    expect(await getCards()).toEqual([]);
    expect(await getCardAudioExportPath()).toBe('/lectures');
    expect(storage.store.knowledgeCards[0].legacyMapsMigrated).toBe(true);
  });
});

describe('custom card types', () => {
  it('persists deduplicated terms without removing types from existing cards', async () => {
    await saveCard({ ...card('c'), type: '随想' });
    await addCustomCardType(' 随想 ');
    await addCustomCardType('随想');
    await addCustomCardType('知识');
    expect(await getCustomCardTypes()).toEqual(['随想']);
    await removeCustomCardType('随想');
    expect(await getCustomCardTypes()).toEqual([]);
    expect((await getCards())[0].type).toBe('随想');
  });
  it('rolls back vocabulary when persistence fails', async () => {
    await addCustomCardType('随想');
    storage.fail = true;
    await expect(removeCustomCardType('随想')).rejects.toThrow();
    expect(await getCustomCardTypes()).toEqual(['随想']);
  });
});
