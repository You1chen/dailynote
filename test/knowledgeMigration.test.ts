import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeCard, KnowledgeMap } from '../src/types/knowledge';
import { normalizeKnowledgeData } from '../src/utils/knowledgeMigration';

const storage = vi.hoisted(() => ({
  store: { knowledgeMaps: [] as KnowledgeMap[], knowledgeCards: [] as import('../src/types/knowledge').KnowledgeCardLibrary[] },
  fail: false,
  mutate: vi.fn(),
}));
vi.mock('../src/services/store', () => ({
  store: storage.store,
  deepClone: <T>(value: T): T => structuredClone(value),
  mutate: storage.mutate,
}));
import { deleteCard, getCards, initializeKnowledgeCards, linkCard, saveCard } from '../src/db/knowledgeCards';

function legacyMap(courseId = 12): KnowledgeMap {
  return {
    id: courseId, courseId, courseName: 'Math', sourceMarkdown: '- Topic', createdAt: 10, updatedAt: 20,
    nodes: [{ id: 'topic', title: 'Topic', depth: 0, status: 'learned', children: [],
      cards: [{ id: 'old', title: 'Original title', status: 'debt', images: ['data:image/a', 'data:image/b'], text: ' first\nsecond ', createdAt: 11, updatedAt: 19 }],
      note: { updatedAt: 18, blocks: [
        { id: 'paragraph', text: 'full note\nwith whitespace ', checklist: false },
        { id: 'checked', text: 'finished', checklist: true, checked: true },
        { id: 'unchecked', text: 'pending', checklist: true, checked: false },
      ] },
    }],
  } as unknown as KnowledgeMap;
}
const card = (id: string): KnowledgeCard => ({ id, title: id, contents: [], createdAt: 1, updatedAt: 2 });

beforeEach(() => {
  storage.store.knowledgeMaps = [];
  storage.store.knowledgeCards = [];
  storage.fail = false;
  storage.mutate.mockReset();
  storage.mutate.mockImplementation(async (change: () => void) => { change(); return !storage.fail; });
});

describe('pure knowledge migration', () => {
  it('copies maps and all legacy source fields, with images before text and one ordered note card', () => {
    const source = { knowledgeMaps: [legacyMap()], knowledgeCards: [] };
    const original = structuredClone(source);
    const migrated = normalizeKnowledgeData(source);
    expect(source).toEqual(original);
    expect(migrated.knowledgeMaps[0].nodes[0]).toMatchObject(original.knowledgeMaps[0].nodes[0]);
    const [old, note] = migrated.knowledgeCards[0].records.map(record => record.card);
    expect(old).toMatchObject({ title: 'Original title', status: 'debt', createdAt: 11, updatedAt: 19 });
    expect(old.contents.map(content => content.kind)).toEqual(['image', 'image', 'text']);
    expect(old.contents).toMatchObject([{ data: 'data:image/a' }, { data: 'data:image/b' }, { text: ' first\nsecond ' }]);
    expect(note.contents).toMatchObject([{ text: 'full note\nwith whitespace ' }, { text: '- [x] finished' }, { text: '- [ ] pending' }]);
    expect(note.updatedAt).toBe(18);
    expect(migrated.knowledgeMaps[0].nodes[0].cardIds).toEqual([old.id, note.id]);
  });

  it('is deterministic and idempotent and retains newer library edits', () => {
    const input = { knowledgeMaps: [legacyMap(), legacyMap(13)] };
    const migrated = normalizeKnowledgeData(input);
    expect(normalizeKnowledgeData(input)).toEqual(migrated);
    expect(normalizeKnowledgeData(migrated)).toEqual(migrated);
    expect(new Set(migrated.knowledgeCards[0].records.map(record => record.id)).size).toBe(4);
    migrated.knowledgeCards[0].records[0].card.title = 'Edited later';
    expect(normalizeKnowledgeData(migrated).knowledgeCards[0].records[0].card.title).toBe('Edited later');
  });

  it('preserves current text, image, and audio contents and library settings', () => {
    const modern: KnowledgeCard = { ...card('modern'), contents: [
      { id: 't', kind: 'text', text: 'text', createdAt: 1, updatedAt: 2 },
      { id: 'i', kind: 'image', data: 'image data', createdAt: 2, updatedAt: 3 },
      { id: 'a', kind: 'audio', data: 'audio data', mimeType: 'audio/webm', fileName: 'lecture.webm', durationMs: 1250, createdAt: 3, updatedAt: 4 },
    ] };
    const knowledgeCards = [{ id: 1, audioExportPath: '/lectures', updatedAt: 7, records: [{ id: modern.id, card: modern, createdAt: 1, updatedAt: 4 }] }];
    expect(normalizeKnowledgeData({ knowledgeMaps: [], knowledgeCards }).knowledgeCards).toEqual(knowledgeCards);
  });
});

describe('knowledge card transactions', () => {
  it('migrates before cleanup with explicit write order and rolls back failed storage', async () => {
    storage.store.knowledgeMaps = [legacyMap()];
    const before = structuredClone(storage.store);
    storage.fail = true;
    await expect(initializeKnowledgeCards()).rejects.toThrow('Failed to save');
    expect(storage.store).toEqual(before);
    expect(storage.mutate.mock.calls[0][1]).toMatchObject({ writeOrder: ['knowledgeCards', 'knowledgeMaps'] });
    storage.fail = false;
    await initializeKnowledgeCards();
    expect(await getCards()).toHaveLength(2);
    expect(storage.store.knowledgeMaps[0].nodes[0]).not.toHaveProperty('cards');
    expect(storage.store.knowledgeMaps[0].nodes[0]).not.toHaveProperty('note');
    const migrated = structuredClone(storage.store);
    await initializeKnowledgeCards();
    expect(storage.store).toEqual(migrated);
  });

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

  it('validates leaves and moves references across every map, then deletes them atomically', async () => {
    await saveCard(card('a'));
    const first = legacyMap();
    const second = legacyMap(13);
    first.nodes = [{ id: 'parent', title: 'Parent', depth: 0, children: ['topic'], status: 'todo', cardIds: ['a'] },
      { id: 'topic', parentId: 'parent', title: 'Leaf', depth: 1, children: [], status: 'todo', cardIds: ['a'] }];
    second.nodes = [{ id: 'other', title: 'Other', depth: 0, children: [], status: 'todo', cardIds: ['other-card', 'a'] }];
    storage.store.knowledgeMaps = [first, second];
    await expect(linkCard('a', 12, 'parent')).rejects.toThrow('leaf');
    await expect(linkCard('missing', 12, 'topic')).rejects.toThrow('does not exist');
    await expect(linkCard('a', 99, 'topic')).rejects.toThrow('does not exist');
    await linkCard('a', 13, 'other', { move: true });
    expect(storage.store.knowledgeMaps.flatMap(map => map.nodes.map(node => node.cardIds))).toEqual([[], [], ['other-card', 'a']]);
    await linkCard('a', 13, 'other');
    expect(storage.store.knowledgeMaps[1].nodes[0].cardIds).toEqual(['other-card', 'a']);
    const before = structuredClone(storage.store);
    storage.fail = true;
    await expect(deleteCard('a')).rejects.toThrow('Failed to save');
    expect(storage.store).toEqual(before);
    storage.fail = false;
    await deleteCard('a');
    expect(await getCards()).toEqual([]);
    expect(storage.store.knowledgeMaps.flatMap(map => map.nodes.flatMap(node => node.cardIds))).toEqual(['other-card']);
  });
});
