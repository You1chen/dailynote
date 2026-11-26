import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteGoal, getAllGoals, saveGoalDetailed } from '../db';
import type { LongTermGoal } from '../types';

/** Confessions share the portable encrypted vault, never the public ideas table. */
export function useGardenEntries() {
  const [entries, setEntries] = useState<LongTermGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const all = await getAllGoals();
      if (alive.current) {
        setEntries(all.filter(entry => entry.kind === 'wish' && entry.gardenEntry === 'confession'));
        setError('');
      }
    } catch { if (alive.current) setError('暂时未能翻开这些文字，请重试。'); }
    finally { if (alive.current) setLoading(false); }
  }, []);

  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, [reload]);

  const save = useCallback(async (input: { id?: number; title: string; text: string }) => {
    if (!input.text.trim()) throw new Error('先写下一点什么吧。');
    const all = await getAllGoals();
    const existing = input.id === undefined ? undefined : all.find(entry => entry.id === input.id);
    if (input.id !== undefined && (!existing || existing.gardenEntry !== 'confession')) throw new Error('这段文字暂时无法编辑，请重新解锁。');
    const entry: LongTermGoal = {
      ...existing, kind: 'wish', gardenEntry: 'confession',
      title: input.title.trim(), description: input.text, category: '', tasks: [],
      createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
    };
    const { id, ok } = await saveGoalDetailed(entry);
    if (!ok) throw new Error('还没有保存成功，文字仍留在这里。请重试。');
    await reload();
    return id;
  }, [reload]);

  const archive = useCallback(async (id: number) => {
    if (!(await deleteGoal(id))) throw new Error('未能收起，请重试。');
    await reload();
  }, [reload]);

  return { entries, loading, error, reload, save, archive };
}
