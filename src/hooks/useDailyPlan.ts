import { useState, useEffect, useCallback } from 'react';
import type { DailyPlan, TimeBlock } from '../types';
import { genId, todayStr } from '../types';
import { getPlanByDate, savePlan, moveTimeBlockToTrash } from '../db';

export function useDailyPlan(date: string) {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getPlanByDate(date);
      setPlan(p || { date, timeBlocks: [], createdAt: Date.now(), updatedAt: Date.now() });
    } catch (e) { console.error('加载每日计划失败:', e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const addBlock = useCallback(async (startTime = '08:00', endTime = '09:00') => {
    if (!plan) return;
    const block: TimeBlock = {
      id: genId(),
      startTime,
      endTime,
      taskTitle: '',
      plannedContent: '',
      completed: false,
      notes: '',
    };
    const updated = { ...plan, timeBlocks: [...plan.timeBlocks, block], updatedAt: Date.now() };
    setPlan(updated);
    await savePlan(updated);
    return block.id;
  }, [plan]);

  const addFullBlock = useCallback(async (block: TimeBlock) => {
    if (!plan) return;
    const updated = { ...plan, timeBlocks: [...plan.timeBlocks, block], updatedAt: Date.now() };
    setPlan(updated);
    await savePlan(updated);
  }, [plan]);

  const updateBlock = useCallback(async (blockId: string, changes: Partial<TimeBlock>) => {
    if (!plan) return;
    const updated = {
      ...plan,
      timeBlocks: plan.timeBlocks.map(b => b.id === blockId ? { ...b, ...changes } : b),
      updatedAt: Date.now(),
    };
    setPlan(updated);
    await savePlan(updated);
  }, [plan]);

  const removeBlock = useCallback(async (blockId: string) => {
    if (!plan) return;
    const block = plan.timeBlocks.find(b => b.id === blockId);
    if (block) {
      await moveTimeBlockToTrash(
        plan.date,
        block,
        `时间块 - ${block.taskTitle || block.startTime + '-' + block.endTime}`,
      );
    }
    const updated = {
      ...plan,
      timeBlocks: plan.timeBlocks.filter(b => b.id !== blockId),
      updatedAt: Date.now(),
    };
    setPlan(updated);
    await savePlan(updated);
  }, [plan]);

  const importFromRoutine = useCallback(async (blocks: { startTime: string; endTime: string; taskTitle: string; plannedContent: string }[]) => {
    if (!plan) return;
    const timeBlocks: TimeBlock[] = blocks.map(b => ({
      id: genId(),
      startTime: b.startTime,
      endTime: b.endTime,
      taskTitle: b.taskTitle,
      plannedContent: b.plannedContent,
      completed: false,
      notes: '',
    }));
    const updated = { ...plan, timeBlocks, updatedAt: Date.now() };
    setPlan(updated);
    await savePlan(updated);
  }, [plan]);

  return { plan, loading, addBlock, addFullBlock, updateBlock, removeBlock, importFromRoutine, reload: load };
}
