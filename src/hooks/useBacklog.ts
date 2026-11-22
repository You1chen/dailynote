import { useState, useEffect, useCallback } from 'react';
import type { BacklogItem, BacklogStatus } from '../types';
import { getAllBacklog, saveBacklog, setBacklogStatus, deleteBacklog } from '../db';
import { countBacklogBadge } from '../utils/backlog';

/** 数据变化事件：让侧栏气泡在别的页面也能刷新 */
const CHANGED_EVENT = 'dailynote-backlog-changed';
function notifyChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useBacklog() {
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await getAllBacklog()); }
    catch (e) { console.error('加载遗留问题失败:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addItem = useCallback(
    async (draft: Omit<BacklogItem, 'id' | 'createdAt' | 'updatedAt'>) => {
      const item: BacklogItem = { ...draft, createdAt: Date.now(), updatedAt: Date.now() };
      const id = await saveBacklog(item);
      setItems(prev => [...prev, { ...item, id }]);
      notifyChanged();
      return id;
    },
    [],
  );

  const updateItem = useCallback(async (item: BacklogItem) => {
    await saveBacklog(item);
    setItems(prev => prev.map(x => (x.id === item.id ? { ...item, updatedAt: Date.now() } : x)));
    notifyChanged();
  }, []);

  const changeStatus = useCallback(async (id: number, status: BacklogStatus) => {
    await setBacklogStatus(id, status);
    setItems(prev => prev.map(x => (x.id === id ? { ...x, status, updatedAt: Date.now() } : x)));
    notifyChanged();
  }, []);

  const removeItem = useCallback(async (id: number) => {
    await deleteBacklog(id);
    setItems(prev => prev.filter(x => x.id !== id));
    notifyChanged();
  }, []);

  return { items, loading, addItem, updateItem, changeStatus, removeItem, reload: load };
}

/** 侧栏气泡数字：沉了一周以上、仍在阻塞中的条数 */
export function useBacklogBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await getAllBacklog();
        if (alive) setCount(countBacklogBadge(list));
      } catch { /* 读失败时不显示气泡 */ }
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
