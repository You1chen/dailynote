import { useState, useEffect, useCallback, useRef } from 'react';
import type { LongTermGoal, GoalTask, WishStatus } from '../types';
import { genId } from '../types';
import { getAllGoals, saveGoalDetailed, deleteGoal } from '../db';

/**
 * 目标数据 Hook。
 *
 * 更新以 ref 里的最新数组为准：多个操作紧接着发生时，不会因为闭包里的旧 goals
 * 把刚保存的结果覆盖掉。写盘失败时回滚内存状态并返回 false，页面据此保留草稿。
 */
export function useGoals() {
  const [goals, setGoals] = useState<LongTermGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const goalsRef = useRef<LongTermGoal[]>([]);

  const setAll = useCallback((next: LongTermGoal[]) => {
    goalsRef.current = next;
    setGoals(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAll(await getAllGoals()); }
    catch (e) { console.error('加载目标失败:', e); }
    finally { setLoading(false); }
  }, [setAll]);

  useEffect(() => { load(); }, [load]);

  const addGoal = useCallback(async (
    title: string,
    description: string,
    category: string,
    extra?: Partial<LongTermGoal>,
  ) => {
    const goal: LongTermGoal = {
      title,
      description,
      category,
      tasks: [],
      ...extra,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const { id, ok } = await saveGoalDetailed(goal);
    if (!ok) return null;
    setAll([{ ...goal, id }, ...goalsRef.current]);
    return id;
  }, [setAll]);

  /** 全量更新一条目标；成功返回 true，失败回滚并返回 false */
  const updateGoal = useCallback(async (id: number, changes: Partial<LongTermGoal>): Promise<boolean> => {
    const prev = goalsRef.current;
    const current = prev.find(g => g.id === id);
    if (!current) return false;

    const updated: LongTermGoal = { ...current, ...changes, updatedAt: Date.now() };
    const nextGoal: LongTermGoal = { ...updated, id };
    const next = prev.map(g => (g.id === id ? nextGoal : g));

    setAll(next);
    const { ok } = await saveGoalDetailed(nextGoal);
    if (!ok) {
      if (goalsRef.current === next) setAll(prev);
      return false;
    }
    return true;
  }, [setAll]);

  const removeGoal = useCallback(async (id: number) => {
    const prev = goalsRef.current;
    const ok = await deleteGoal(id);
    if (!ok) return false;
    setAll(prev.filter(g => g.id !== id));
    return true;
  }, [setAll]);

  const addTask = useCallback(async (goalId: number, title: string) => {
    const prev = goalsRef.current;
    const goal = prev.find(g => g.id === goalId);
    if (!goal) return false;
    const task: GoalTask = { id: genId(), title: title.trim(), completed: false, createdAt: Date.now() };
    return updateGoal(goalId, { tasks: [...goal.tasks, task] });
  }, [updateGoal]);

  const toggleTask = useCallback(async (goalId: number, taskId: string) => {
    const prev = goalsRef.current;
    const goal = prev.find(g => g.id === goalId);
    if (!goal) return false;
    return updateGoal(goalId, {
      tasks: goal.tasks.map(t => (t.id === taskId ? { ...t, completed: !t.completed } : t)),
    });
  }, [updateGoal]);

  const removeTask = useCallback(async (goalId: number, taskId: string) => {
    const prev = goalsRef.current;
    const goal = prev.find(g => g.id === goalId);
    if (!goal) return false;
    return updateGoal(goalId, { tasks: goal.tasks.filter(t => t.id !== taskId) });
  }, [updateGoal]);

  /** 新增大愿望：名称 + 愿景必填，其余可选 */
  const addWish = useCallback(async (input: {
    title: string;
    vision: string;
    description?: string;
    category?: string;
    targetDate?: string;
    tasks?: GoalTask[];
  }) => {
    const wish: LongTermGoal = {
      kind: 'wish',
      title: input.title.trim(),
      vision: input.vision.trim(),
      description: (input.description ?? '').trim(),
      category: input.category ?? '其他',
      targetDate: input.targetDate || undefined,
      status: 'active',
      tasks: input.tasks ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const { id, ok } = await saveGoalDetailed(wish);
    if (!ok) return null;
    setAll([{ ...wish, id }, ...goalsRef.current]);
    return id;
  }, [setAll]);

  const setWishStatus = useCallback(async (id: number, status: WishStatus) => {
    return updateGoal(id, { status });
  }, [updateGoal]);

  return {
    goals, loading,
    addGoal, addWish, setWishStatus,
    updateGoal, removeGoal, addTask, toggleTask, removeTask,
    reload: load,
  };
}
