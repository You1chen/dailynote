import { useState, useEffect, useCallback } from 'react';
import type { LongTermGoal, GoalTask } from '../types';
import { genId } from '../types';
import { getAllGoals, saveGoal, deleteGoal } from '../db';

export function useGoals() {
  const [goals, setGoals] = useState<LongTermGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setGoals(await getAllGoals()); }
    catch (e) { console.error('加载目标失败:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addGoal = useCallback(async (title: string, description: string, category: string) => {
    const goal: LongTermGoal = {
      title,
      description,
      category,
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const id = await saveGoal(goal);
    setGoals(prev => [{ ...goal, id }, ...prev]);
    return id;
  }, []);

  const updateGoal = useCallback(async (id: number, changes: Partial<LongTermGoal>) => {
    const updated = goals.map(g => g.id === id ? { ...g, ...changes, updatedAt: Date.now() } : g);
    setGoals(updated);
    const g = updated.find(x => x.id === id);
    if (g) await saveGoal(g);
  }, [goals]);

  const removeGoal = useCallback(async (id: number) => {
    await deleteGoal(id);
    setGoals(prev => prev.filter(g => g.id !== id));
  }, []);

  const addTask = useCallback(async (goalId: number, title: string) => {
    const task: GoalTask = { id: genId(), title, completed: false, createdAt: Date.now() };
    const updated = goals.map(g => {
      if (g.id !== goalId) return g;
      return { ...g, tasks: [...g.tasks, task], updatedAt: Date.now() };
    });
    setGoals(updated);
    const g = updated.find(x => x.id === goalId);
    if (g) await saveGoal(g);
  }, [goals]);

  const toggleTask = useCallback(async (goalId: number, taskId: string) => {
    const updated = goals.map(g => {
      if (g.id !== goalId) return g;
      return {
        ...g,
        tasks: g.tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t),
        updatedAt: Date.now(),
      };
    });
    setGoals(updated);
    const g = updated.find(x => x.id === goalId);
    if (g) await saveGoal(g);
  }, [goals]);

  const removeTask = useCallback(async (goalId: number, taskId: string) => {
    const updated = goals.map(g => {
      if (g.id !== goalId) return g;
      return { ...g, tasks: g.tasks.filter(t => t.id !== taskId), updatedAt: Date.now() };
    });
    setGoals(updated);
    const g = updated.find(x => x.id === goalId);
    if (g) await saveGoal(g);
  }, [goals]);

  return { goals, loading, addGoal, updateGoal, removeGoal, addTask, toggleTask, removeTask, reload: load };
}
