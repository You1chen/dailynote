import { useState, useEffect, useCallback } from 'react';
import { genId } from '../types';
import type { TaskItem } from '../types';
import { getTaskItemsByDate, saveTaskItem, toggleTaskItem, deleteTaskItem } from '../db';

export function useTaskList(date: string) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await getTaskItemsByDate(date);
    setItems(data);
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  const addItem = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const maxOrder = items.reduce((max, t) => Math.max(max, t.sortOrder), 0);
    const newItem: TaskItem = {
      id: genId(),
      title: trimmed,
      completed: false,
      date,
      sortOrder: maxOrder + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 乐观更新
    setItems(prev => [...prev, newItem]);
    await saveTaskItem(newItem);
  }, [date, items]);

  const toggleItem = useCallback(async (id: string) => {
    setItems(prev => prev.map(t =>
      t.id === id ? { ...t, completed: !t.completed, updatedAt: Date.now() } : t
    ));
    await toggleTaskItem(id);
  }, []);

  const removeItem = useCallback(async (id: string) => {
    setItems(prev => prev.filter(t => t.id !== id));
    await deleteTaskItem(id);
  }, []);

  return { items, loading, addItem, toggleItem, removeItem, reload };
}
