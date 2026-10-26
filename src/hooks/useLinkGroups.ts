import { useState, useEffect, useCallback } from 'react';
import type { LinkGroup } from '../types';
import { genId } from '../types';
import { getAllLinkGroups, saveLinkGroup, deleteLinkGroup } from '../db';

/**
 * 自定义关联分组（DDL 关联用）。
 * 内置的「课程」组不在这里——它直接由课程表算出来。
 */
export interface LinkGroupApi {
  groups: LinkGroup[];
  loading: boolean;
  addGroup: (name: string) => Promise<number>;
  removeGroup: (id: number) => Promise<void>;
  addItem: (groupId: number, name: string) => Promise<void>;
  removeItem: (groupId: number, itemId: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useLinkGroups(): LinkGroupApi {
  const [groups, setGroups] = useState<LinkGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setGroups(await getAllLinkGroups()); }
    catch (e) { console.error('加载关联分组失败:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addGroup = useCallback(async (name: string) => {
    const g: LinkGroup = { name: name.trim(), items: [], createdAt: Date.now(), updatedAt: Date.now() };
    const id = await saveLinkGroup(g);
    setGroups(prev => [...prev, { ...g, id }]);
    return id;
  }, []);

  const removeGroup = useCallback(async (id: number) => {
    await deleteLinkGroup(id);
    setGroups(prev => prev.filter(g => g.id !== id));
  }, []);

  /** 往里加一条：沿用当前顺序，直接整组保存 */
  const addItem = useCallback(async (groupId: number, name: string) => {
    const next = groups.map(g => g.id === groupId
      ? { ...g, items: [...g.items, { id: genId(), name: name.trim() }] }
      : g);
    setGroups(next);
    const g = next.find(x => x.id === groupId);
    if (g) await saveLinkGroup(g);
  }, [groups]);

  const removeItem = useCallback(async (groupId: number, itemId: string) => {
    const next = groups.map(g => g.id === groupId
      ? { ...g, items: g.items.filter(i => i.id !== itemId) }
      : g);
    setGroups(next);
    const g = next.find(x => x.id === groupId);
    if (g) await saveLinkGroup(g);
  }, [groups]);

  return { groups, loading, addGroup, removeGroup, addItem, removeItem, reload: load };
}
