import { useState, useEffect, useCallback } from 'react';
import type { TrashItem } from '../types';
import {
  getTrashItems,
  restoreFromTrash,
  permanentlyDelete,
  clearAllTrash,
  cleanOldTrash,
} from '../db';

export function useTrash() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await cleanOldTrash();
      setItems(await getTrashItems());
    } catch (e) {
      console.error('加载回收站失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = useCallback(async (trashId: number) => {
    const ok = await restoreFromTrash(trashId);
    if (ok) setItems(prev => prev.filter(i => i.id !== trashId));
    return ok;
  }, []);

  const permDelete = useCallback(async (trashId: number) => {
    await permanentlyDelete(trashId);
    setItems(prev => prev.filter(i => i.id !== trashId));
  }, []);

  const clearAll = useCallback(async () => {
    await clearAllTrash();
    setItems([]);
  }, []);

  return { items, loading, restore, permDelete, clearAll, reload: load };
}
