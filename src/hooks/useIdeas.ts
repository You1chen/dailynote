import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllIdeas, saveIdea, deleteIdea } from '../db';
import { todayStr, normalizeIdea } from '../types';
import type { Idea, MindKind } from '../types';

export interface NewMind {
  kind: MindKind;
  text: string;
  title?: string;
  tags?: string[];
  date?: string;
  source?: Idea['source'];
}

/** 任一处的杂念增删改都会广播这个事件，其他页面的计数据此立即刷新 */
const CHANGED_EVENT = 'dailynote-ideas-changed';

/** 杂念：小愿望 / 琐事 / 灵感，共用一张表，按日期倒序 */
export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setIdeas((await getAllIdeas()).map(normalizeIdea));
  }, []);

  useEffect(() => {
    (async () => { await reload(); setLoading(false); })();
  }, [reload]);

  // 别处（杂念面板、回收站还原）改了杂念：本实例立刻重读，不等页面重新挂载
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChanged = () => { void reload(); };
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, [reload]);

  /** 新增一条杂念，返回新 id */
  const addMind = useCallback(async (input: NewMind) => {
    const text = input.text.trim();
    if (!text) return 0;
    const id = await saveIdea({
      kind: input.kind,
      title: input.title?.trim() || undefined,
      text,
      date: input.date || todayStr(),
      source: input.source ?? 'todo',
      tags: input.tags?.map(t => t.trim()).filter(Boolean) ?? [],
      createdAt: 0,
      updatedAt: 0,
    });
    await reload();
    return id;
  }, [reload]);

  const updateIdea = useCallback(async (idea: Idea, patch: Partial<Idea>) => {
    const next = { ...idea, ...patch };
    if (!next.text.trim()) return;
    await saveIdea(next);
    await reload();
  }, [reload]);

  const removeIdea = useCallback(async (id: number) => {
    await deleteIdea(id);
    await reload();
  }, [reload]);

  const byKind = useMemo(() => ({
    wish: ideas.filter(i => i.kind === 'wish'),
    chore: ideas.filter(i => i.kind === 'chore'),
    idea: ideas.filter(i => i.kind === 'idea'),
  }), [ideas]);

  /** 某天有几条灵感（日历气泡用，只算灵感） */
  const countByDate = useCallback((): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const i of ideas) {
      if (i.kind !== 'idea') continue;
      map[i.date] = (map[i.date] ?? 0) + 1;
    }
    return map;
  }, [ideas]);

  return { ideas, byKind, loading, addMind, updateIdea, removeIdea, countByDate, reload };
}
