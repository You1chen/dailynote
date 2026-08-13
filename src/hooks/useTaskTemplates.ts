import { useState, useEffect, useCallback } from 'react';
import type { TaskTemplate, ChecklistItem } from '../types';
import { getAllTaskTemplates, saveTaskTemplate, deleteTaskTemplate } from '../db';

export function useTaskTemplates() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTemplates(await getAllTaskTemplates()); }
    catch (e) { console.error('加载任务清单模板失败:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addTemplate = useCallback(async (name: string, items: ChecklistItem[] = []) => {
    const t: TaskTemplate = { name, items, createdAt: Date.now(), updatedAt: Date.now() };
    const id = await saveTaskTemplate(t);
    setTemplates(prev => [{ ...t, id }, ...prev]);
    return id;
  }, []);

  const updateTemplate = useCallback(async (id: number, changes: Partial<TaskTemplate>) => {
    const updated = templates.map(t => t.id === id ? { ...t, ...changes, updatedAt: Date.now() } : t);
    setTemplates(updated);
    const t = updated.find(x => x.id === id);
    if (t) await saveTaskTemplate(t);
  }, [templates]);

  const removeTemplate = useCallback(async (id: number) => {
    await deleteTaskTemplate(id);
    setTemplates(prev => prev.filter(t => t.id !== id));
  }, []);

  return { templates, loading, addTemplate, updateTemplate, removeTemplate, reload: load };
}
