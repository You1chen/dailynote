import { getTaskBoard, saveTaskTree } from '../../db';
import { genId } from '../../types';
import type { TaskNode } from '../../types';

/** Append one or more top-level todo items and notify every mounted todo view. */
export async function addTodoItems(titles: string[]): Promise<number> {
  const clean = titles.map(title => title.trim()).filter(Boolean);
  if (!clean.length) return 0;
  const board = await getTaskBoard();
  const nodes: TaskNode[] = [
    ...board.nodes,
    ...clean.map(title => ({ id: genId(), title, done: false, children: [] })),
  ];
  await saveTaskTree(nodes);
  window.dispatchEvent(new Event('dailynote-task-changed'));
  return clean.length;
}
