import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toggleTaskTimer } from '../db/taskTimers';
import type { TaskBoard, TaskLeaf, TaskNode } from '../types';
import { getTaskBoard, saveTaskTree, toggleTaskLeaf, removeTaskLeaf, shelveTaskLeaf, reorderTaskLeaves, clearExpiredTaskLeaves } from '../db';
import { countUndone, executionLeavesOf, reorderExecutionLeaves, toggleLeafDone } from '../utils/taskTree';

const EMPTY: TaskBoard = { id: 1, nodes: [], order: [], updatedAt: 0 };

/** 数据变化事件：球上的数字在别的页面也能刷新 */
const CHANGED_EVENT = 'dailynote-task-changed';

export interface TaskBoardApi {
  nodes: TaskNode[];
  /** 任务清单里的末级（不含遗留） */
  leaves: TaskLeaf[];
  /** 遗留清单里的末级 */
  shelved: TaskLeaf[];
  undone: number;
  loading: boolean;
  saveTree: (nodes: TaskNode[], baseNodes?: TaskNode[]) => Promise<void>;
  toggle: (key: string) => Promise<void>;
  toggleTimer: (key: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  shelve: (key: string, shelved?: boolean) => Promise<void>;
  reorder: (fromKey: string, toKey: string) => Promise<void>;
  clearExpired: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useTaskBoard(): TaskBoardApi {
  const [board, setBoard] = useState<TaskBoard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const eventSource = useRef(Symbol());

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await getTaskBoard();
      if (id === requestId.current) setBoard(next);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    try { await refresh(); }
    catch (e) { console.error('加载任务失败:', e); }
  }, [refresh]);

  useEffect(() => {
    const source = eventSource.current;
    const onChange = (event: Event) => {
      if ((event as CustomEvent).detail !== source) void load();
    };
    window.addEventListener(CHANGED_EVENT, onChange);
    void load();
    return () => {
      window.removeEventListener(CHANGED_EVENT, onChange);
      requestId.current++;
    };
  }, [load]);

  const allLeaves = useMemo(() => executionLeavesOf(board.nodes, board.order), [board]);
  const leaves = useMemo(() => allLeaves.filter(l => !l.shelved), [allLeaves]);
  const shelved = useMemo(() => allLeaves.filter(l => l.shelved), [allLeaves]);
  const undone = useMemo(() => countUndone(leaves), [leaves]);

  const commit = useCallback(async (write: () => Promise<void>) => {
    try {
      await write();
      window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: eventSource.current }));
      await refresh();
    } catch (e) {
      await load();
      throw e;
    }
  }, [load, refresh]);

  const saveTree = useCallback((nodes: TaskNode[], baseNodes?: TaskNode[]) => commit(() => saveTaskTree(nodes, baseNodes)), [commit]);
  const toggleTimer = useCallback((key: string) => commit(() => toggleTaskTimer(key)), [commit]);

  const toggle = useCallback((key: string) => {
    setBoard(b => ({ ...b, nodes: toggleLeafDone(b.nodes, key) }));
    return commit(() => toggleTaskLeaf(key));
  }, [commit]);

  const shelve = useCallback((key: string, on = true) => commit(() => shelveTaskLeaf(key, on)), [commit]);
  const remove = useCallback((key: string) => commit(() => removeTaskLeaf(key)), [commit]);

  const reorder = useCallback((fromKey: string, toKey: string) => {
    setBoard(b => {
      const order = reorderExecutionLeaves(b.nodes, b.order, fromKey, toKey);
      return order === b.order ? b : { ...b, order };
    });
    return commit(() => reorderTaskLeaves(fromKey, toKey));
  }, [commit]);

  const clearExpired = useCallback(() => commit(() => clearExpiredTaskLeaves()), [commit]);

  return { nodes: board.nodes, leaves, shelved, undone, loading, saveTree, toggle, toggleTimer, remove, shelve, reorder, clearExpired, reload: load };
}

/** 监听任务变化（球上数字用） */
export function useTaskBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const board = await getTaskBoard();
        if (alive) setCount(countUndone(executionLeavesOf(board.nodes, board.order).filter(l => !l.shelved)));
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
