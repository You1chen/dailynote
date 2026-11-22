import { genId, type Idea, type TaskBoard, type TaskNode } from '../types';
import type { StoreShape } from '../types/storage';
import { normalizeExecutionOrder, pruneDoneLeaves, walkLeaves } from './taskTree';

type MindTaskStore = Pick<StoreShape, 'ideas' | 'taskBoard'>;

export const EMPTY_TASK_BOARD: TaskBoard = { id: 1, nodes: [], order: [], updatedAt: 0 };

export function isMindTask(idea: Idea): boolean {
  return idea.kind === 'wish' || idea.kind === 'chore';
}

export function putTaskBoard(store: MindTaskStore, board: TaskBoard): void {
  const index = store.taskBoard.findIndex(item => item.id === 1);
  if (index < 0) store.taskBoard.push(board);
  else store.taskBoard[index] = board;
}

/** Assign identities to legacy wishes/chores and repair interrupted writes across the two files. */
export function syncMindTasks(store: MindTaskStore): boolean {
  const board = store.taskBoard.find(item => item.id === 1) ?? EMPTY_TASK_BOARD;
  let ideasChanged = false;
  const linked = new Map<string, Idea>();
  const ideas = store.ideas.map(idea => {
    if (!isMindTask(idea)) return idea;
    const id = idea.taskNodeId && !linked.has(idea.taskNodeId) ? idea.taskNodeId : `mind-${genId()}`;
    const next = idea.taskNodeId === id ? idea : { ...idea, taskNodeId: id };
    if (next !== idea) ideasChanged = true;
    linked.set(id, next);
    return next;
  });

  // Ideas are persisted before their TODO projections. Any unowned projection is stale.
  const liveNodes = pruneDoneLeaves(board.nodes, node => !!node.mindLinked && !linked.has(node.id));
  const found = new Set<string>();
  const refresh = (nodes: TaskNode[]): TaskNode[] => {
    const next = nodes.map(node => {
      const children = refresh(node.children);
      const idea = linked.get(node.id);
      if (idea && !children.length) {
        found.add(node.id);
        if (node.title !== idea.text || !node.mindLinked) return { ...node, title: idea.text, mindLinked: true };
      }
      return children === node.children ? node : { ...node, children };
    });
    return next.some((node, index) => node !== nodes[index]) ? next : nodes;
  };
  let nodes = linked.size ? refresh(liveNodes) : liveNodes;
  for (const [id, idea] of linked) {
    if (!found.has(id)) nodes = [...nodes, { id, title: idea.text, done: false, shelved: true, mindLinked: true, children: [] }];
  }
  if (ideasChanged) store.ideas = ideas;
  if (nodes !== board.nodes) {
    const order = normalizeExecutionOrder(board.nodes, board.order ?? []);
    putTaskBoard(store, { ...board, nodes, order: normalizeExecutionOrder(nodes, order), updatedAt: Date.now() });
  }
  return ideasChanged || nodes !== board.nodes;
}

export function mindTaskLeaves(nodes: TaskNode[]): Map<string, TaskNode> {
  const linked = new Map<string, TaskNode>();
  walkLeaves(nodes, node => { if (node.mindLinked) linked.set(node.id, node); });
  return linked;
}
