import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { hiddenGardenEntries } from '../src/utils/gardenEntry';
import { _resetForTest, store, exportJSON, importJSONIntoStore } from '../src/services/store';
import { setupGarden, lockGarden, unlockGarden, decryptWish } from '../src/services/gardenSecurity';
import { saveGoalDetailed, deleteGoal, clearAllTrash, restoreFromTrash } from '../src/db';
import { searchStore } from '../src/utils/search';

const memory: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (key: string) => memory[key] ?? null, setItem: (key: string, value: string) => memory[key] = value, removeItem: (key: string) => delete memory[key], clear: () => Object.keys(memory).forEach(key => delete memory[key]) };
beforeEach(async () => { lockGarden(); localStorage.clear(); await _resetForTest(); });

it('reveals both hidden entrances only with exactly one trailing ASCII space', () => {
  expect(hiddenGardenEntries('秘密花园 ').map(hit => hit.route)).toEqual(['/garden', '/garden/settings']);
  for (const query of ['秘密花园', ' 秘密花园 ', '秘密花园  ', '秘密花园\t', '秘密花园\u3000', '秘密花园 a', '花园 ']) expect(hiddenGardenEntries(query)).toEqual([]);
});

it('keeps confessions encrypted through saving, backup, archive and restore', async () => {
  await setupGarden('1234');
  const result = await saveGoalDetailed({ kind: 'wish', gardenEntry: 'confession', title: '只有自己知道', description: '今天终于肯停下来。\n明天再说吧。', category: '', tasks: [], createdAt: Date.now(), updatedAt: Date.now() });
  expect(result.ok).toBe(true);
  const persisted = store.longTermGoals[0];
  expect(persisted.gardenEntry).toBeUndefined();
  expect(JSON.stringify(persisted)).not.toContain('只有自己知道');
  expect(exportJSON()).not.toContain('今天终于');
  expect((await decryptWish(persisted)).gardenEntry).toBe('confession');
  expect(searchStore(store, '只有自己知道')).toEqual([]);
  await deleteGoal(result.id);
  expect(JSON.stringify(store.trashItems)).not.toContain('今天终于');
  await clearAllTrash(true);
  expect(store.trashItems).toHaveLength(1);
  await restoreFromTrash(store.trashItems[0].id!);
  const backup = exportJSON();
  await _resetForTest(); lockGarden(); await importJSONIntoStore(backup); await unlockGarden('1234');
  expect((await decryptWish(store.longTermGoals[0])).description).toBe('今天终于肯停下来。\n明天再说吧。');
}, 30000);
