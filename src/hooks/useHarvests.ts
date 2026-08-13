import { useState, useEffect, useCallback } from 'react';
import type { Harvest, Period } from '../types';
import { getHarvestsByDate, saveHarvest, deleteHarvest, getAllHarvests } from '../db';

export function useHarvests(date: string) {
  const [harvests, setHarvests] = useState<Harvest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setHarvests(await getHarvestsByDate(date)); }
    catch (e) { console.error('加载收获失败:', e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const addOrUpdate = useCallback(async (h: Harvest) => {
    const id = await saveHarvest(h);
    setHarvests(prev => {
      const idx = prev.findIndex(x => x.id === id || (h.id && x.id === h.id));
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...h, id };
        return copy;
      }
      return [{ ...h, id }, ...prev];
    });
    return id;
  }, []);

  const remove = useCallback(async (id: number) => {
    await deleteHarvest(id);
    setHarvests(prev => prev.filter(h => h.id !== id));
  }, []);

  const getByPeriod = useCallback((period: Period) => {
    return harvests.find(h => h.period === period);
  }, [harvests]);

  return { harvests, loading, addOrUpdate, remove, getByPeriod, reload: load };
}

export function useAllHarvests() {
  const [harvests, setHarvests] = useState<Harvest[]>([]);

  useEffect(() => {
    getAllHarvests().then(setHarvests);
  }, []);

  return harvests;
}
