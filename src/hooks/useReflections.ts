import { useState, useEffect, useCallback } from 'react';
import type { Reflection, Period } from '../types';
import { getReflectionsByDate, saveReflection, deleteReflection, getAllReflections } from '../db';

export function useReflections(date: string) {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReflections(await getReflectionsByDate(date)); }
    catch (e) { console.error('加载反思失败:', e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const addOrUpdate = useCallback(async (r: Reflection) => {
    const id = await saveReflection(r);
    setReflections(prev => {
      const idx = prev.findIndex(x => x.id === id || (r.id && x.id === r.id));
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...r, id };
        return copy;
      }
      return [{ ...r, id }, ...prev];
    });
    return id;
  }, []);

  const remove = useCallback(async (id: number) => {
    await deleteReflection(id);
    setReflections(prev => prev.filter(r => r.id !== id));
  }, []);

  const getByPeriod = useCallback((period: Period) => {
    return reflections.find(r => r.period === period);
  }, [reflections]);

  return { reflections, loading, addOrUpdate, remove, getByPeriod, reload: load };
}

export function useAllReflections() {
  const [reflections, setReflections] = useState<Reflection[]>([]);

  useEffect(() => {
    getAllReflections().then(setReflections);
  }, []);

  return reflections;
}
