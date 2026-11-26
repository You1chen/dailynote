import { expect, it } from 'vitest';
import { searchStore } from '../src/utils/search';
import { emptyStore } from '../src/services/storeSchema';

it('finds card text and links to the exact collector card using an encoded ID', () => {
  const store = emptyStore();
  const id = 'legacy:地图/卡片&测试%1';
  store.knowledgeCards = [{ id: 1, audioExportPath: 'Music/DailyNote', updatedAt: 1, records: [{ id, createdAt: 1, updatedAt: 1, card: { id, title: '触发器笔记', contents: [{ id: 't1', kind: 'text', text: '复习特性方程', createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 } }] }];
  const hit = searchStore(store, '特性方程')[0];
  expect(hit.where).toContain('记事收集器');
  expect(hit.route).toBe(`/reflection?card=${encodeURIComponent(id)}`);
});
