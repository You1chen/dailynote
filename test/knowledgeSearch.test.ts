import { expect, it } from 'vitest';
import { searchStore } from '../src/utils/search';
import type { StoreShape } from '../src/types/storage';
import { emptyStore } from '../src/services/storeSchema';

it('finds checklist note text and routes to its course map node', () => {
  const store = emptyStore() as StoreShape;
  store.courses = [{ id: 7, name: '数字逻辑', teacher: '', location: '', dayOfWeek: [1], startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 18, createdAt: 1, updatedAt: 1 }];
  store.knowledgeMaps = [{ id: 1, courseId: 7, courseName: '数字逻辑', sourceMarkdown: '- 触发器', nodes: [{ id: 'n', title: '触发器', depth: 0, status: 'todo', children: [], note: { updatedAt: 1, blocks: [{ id: 'b', text: '复习特性方程', checklist: true, checked: false }] } }], createdAt: 1, updatedAt: 1 }];
  const hit = searchStore(store, '特性方程')[0];
  expect(hit.where).toContain('数字逻辑');
  expect(hit.route).toBe('/courses?knowledgeCourse=7&knowledgeNode=n');
});
