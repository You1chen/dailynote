import { expect, it } from 'vitest';
import { searchStore } from '../src/utils/search';
import type { StoreShape } from '../src/types/storage';
import { emptyStore } from '../src/services/storeSchema';

it('finds collector card text and routes to its course map node', () => {
  const store = emptyStore() as StoreShape;
  store.courses = [{ id: 7, name: '数字逻辑', teacher: '', location: '', dayOfWeek: [1], startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 18, createdAt: 1, updatedAt: 1 }];
  store.knowledgeMaps = [{ id: 1, courseId: 7, courseName: '数字逻辑', sourceMarkdown: '- 触发器', nodes: [{ id: 'n', title: '触发器', depth: 0, status: 'todo', children: [], cardIds: ['c1'] }], createdAt: 1, updatedAt: 1 }];
  store.knowledgeCards = [{ id: 1, audioExportPath: 'Music/DailyNote', updatedAt: 1, records: [{ id: 'c1', createdAt: 1, updatedAt: 1, card: { id: 'c1', title: '触发器笔记', contents: [{ id: 't1', kind: 'text', text: '复习特性方程', createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 } }] }];
  const hit = searchStore(store, '特性方程')[0];
  expect(hit.where).toContain('数字逻辑');
  expect(hit.route).toBe('/courses?knowledgeCourse=7&knowledgeNode=n');
});

it('routes inspiration search to the moved date-specific panel', () => {
  const store = emptyStore();
  store.ideas = [{ id: 1, kind: 'idea', title: '迁移灵感', text: '正文', date: '2026-11-01', createdAt: 1, updatedAt: 1 }];
  expect(searchStore(store, '迁移灵感')[0].route).toBe('/reflection?date=2026-11-01&ideas=1');
});

it('finds unlinked collector cards and routes to reflection', () => {
  const store = emptyStore() as StoreShape;
  store.knowledgeCards = [{ id: 1, audioExportPath: 'Music/DailyNote', updatedAt: 1, records: [{ id: 'c2', createdAt: 1, updatedAt: 1, card: { id: 'c2', title: '收集器里的卡片', contents: [], createdAt: 1, updatedAt: 1 } }] }];
  const hit = searchStore(store, '收集器')[0];
  expect(hit.where).toContain('收集器');
  expect(hit.route).toBe('/reflection');
});
