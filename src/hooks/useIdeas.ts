import { useState, useEffect, useCallback } from 'react';
import { getAllIdeas, saveIdea, deleteIdea } from '../db';
import { todayStr } from '../types';
import type { Idea } from '../types';

/** 灵感：随手记下的一句话，按日期倒序 */
export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setIdeas(await getAllIdeas());
  }, []);

  useEffect(() => {
    (async () => { await reload(); setLoading(false); })();
  }, [reload]);

  /** 新增一条（默认记在今天），返回新 id */
  const addIdea = useCallback(async (text: string, date = todayStr(), source: Idea['source'] = 'todo') => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const id = await saveIdea({
      text: trimmed,
      date,
      source,
      createdAt: 0,
      updatedAt: 0,
    });
    await reload();
    return id;
  }, [reload]);

  const updateIdea = useCallback(async (idea: Idea, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await saveIdea({ ...idea, text: trimmed });
    await reload();
  }, [reload]);

  const removeIdea = useCallback(async (id: number) => {
    await deleteIdea(id);
    await reload();
  }, [reload]);

  /** 某天有几条灵感（日历气泡用） */
  const countByDate = useCallback((): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const i of ideas) map[i.date] = (map[i.date] ?? 0) + 1;
    return map;
  }, [ideas]);

  return { ideas, loading, addIdea, updateIdea, removeIdea, countByDate, reload };
}
