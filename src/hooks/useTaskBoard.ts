import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TaskBoard, TaskLeaf, TaskNode } from '../types';
import { getTaskBoard, saveTaskBoard, toggleTaskLeaf, removeTaskLeaf, shelveTaskLeaf } from '../db';
import { countUndone, leavesOf, moveKey, normalizeOrder } from '../utils/taskTree';

const EMPTY: TaskBoard = { id: 1, nodes: [], order: [], updatedAt: 0 };

/** 数据变化事件：球上的数字在别的页面也能刷新 */
const CHANGED_EVENT = 'dailynote-task-changed';
function notifyChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export interface TaskBoardApi {
  nodes: TaskNode[];
  /** 任务清单里的末级（不含搁置） */
  leaves: TaskLeaf[];
  /** 搁置清单里的末级 */
  shelved: TaskLeaf[];
  undone: number;
  loading: boolean;
  saveTree: (nodes: TaskNode[]) => Promise<void>;
  toggle: (key: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  shelve: (key: string, shelved?: boolean) => Promise<void>;
  reorder: (fromKey: string, toKey: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useTaskBoard(): TaskBoardApi {
  const [board, setBoard] = useState<TaskBoard>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBoard(await getTaskBoard()); }
    catch (e) { console.error('加载任务失败:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allLeaves = useMemo(() => leavesOf(board.nodes, board.order), [board]);
  const leaves = useMemo(() => allLeaves.filter(l => !l.shelved), [allLeaves]);
  const shelved = useMemo(() => allLeaves.filter(l => l.shelved), [allLeaves]);
  const undone = useMemo(() => countUndone(leaves), [leaves]);

  const saveTree = useCallback(async (nodes: TaskNode[]) => {
    const order = normalizeOrder(nodes, board.order);
    await saveTaskBoard({ nodes, order });
    setBoard(b => ({ ...b, nodes, order, updatedAt: Date.now() }));
    notifyChanged();
  }, [board.order]);

  const toggle = useCallback(async (key: string) => {
    await toggleTaskLeaf(key);
    setBoard(b => ({ ...b, nodes: updateDone(b.nodes, key), updatedAt: Date.now() }));
    notifyChanged();
  }, []);

  const shelve = useCallback(async (key: string, on = true) => {
    await shelveTaskLeaf(key, on);
    await load();
    notifyChanged();
  }, [load]);

  const remove = useCallback(async (key: string) => {
    await removeTaskLeaf(key);
    setBoard(b => ({ ...b, order: b.order.filter(k => k !== key) }));
    await load();
    notifyChanged();
  }, [load]);

  const reorder = useCallback(async (fromKey: string, toKey: string) => {
    const order = moveKey(normalizeOrder(board.nodes, board.order), fromKey, toKey);
    await saveTaskBoard({ nodes: board.nodes, order });
    setBoard(b => ({ ...b, order, updatedAt: Date.now() }));
    notifyChanged();
  }, [board.nodes, board.order]);

  return { nodes: board.nodes, leaves, shelved, undone, loading, saveTree, toggle, remove, shelve, reorder, reload: load };
}

/** 本地翻转入参树里对应末级的 done（避免整表重读） */
function updateDone(nodes: TaskNode[], key: string): TaskNode[] {
  const parts = key.split('/');
  const rec = (list: TaskNode[], depth: number): TaskNode[] =>
    list.map(n => {
      if (n.title !== parts[depth]) return n;
      if (depth === parts.length - 1) {
        const done = !n.done;
        return { ...n, done, doneAt: done ? Date.now() : undefined };
      }
      return { ...n, children: rec(n.children, depth + 1) };
    });
  return rec(nodes, 0);
}

/** 监听任务变化（球上数字用） */
export function useTaskBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const board = await getTaskBoard();
        if (alive) setCount(countUndone(leavesOf(board.nodes, board.order).filter(l => !l.shelved)));
      } catch { /* 读失败就不显示 */ }
    };
    refresh();
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED_EVENT, refresh);
    };
  }, []);

  return count;
}
