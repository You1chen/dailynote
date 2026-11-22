import type { StoreShape } from '../types/storage';
import type { ActivityCategory, ActivityEvent, ActivityOptions, SettlementProgress, SettlementSummary } from '../types/settlement';
import type { PosterData } from './settlementPoster';
import { effectiveNodes, treeProgress } from './goalTree';
export type { ActivityEvent, SettlementProgress, SettlementSummary } from '../types/settlement';

export function localActivityDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const recoveredPrefix = 'recovered:';
const activityKey = (e: Pick<ActivityEvent, 'category' | 'action' | 'entityId' | 'date'>) => JSON.stringify([e.category, e.action, e.entityId, e.date]);

/** Recover only operations supported by an actual timestamp, preserving live events. */
export function recoverTimestampedActivity(data: StoreShape): boolean {
  const live = new Set(data.activityEvents.filter(e => !e.id.startsWith(recoveredPrefix) && (e.action === 'create' || (e.action === 'complete' && e.from === 0 && e.to === 1))).map(activityKey));
  const retained = data.activityEvents.filter(e => !e.id.startsWith(recoveredPrefix) || !live.has(activityKey(e)));
  let changed = retained.length !== data.activityEvents.length;
  if (changed) data.activityEvents = retained;
  const existing = new Set(data.activityEvents.filter(e => e.action === 'create' || (e.action === 'complete' && e.from === 0 && e.to === 1)).map(activityKey));
  const add = (category: ActivityCategory, action: 'create' | 'complete', entityId: string, title: string, timestamp: unknown) => {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return;
    const event: ActivityEvent = { id: '', date: localActivityDate(date), occurredAt: timestamp, category, action, entityId, title, from: action === 'complete' ? 0 : null, to: action === 'complete' ? 1 : null };
    const key = activityKey(event);
    if (existing.has(key)) return;
    event.id = recoveredPrefix + JSON.stringify([category, action, entityId, timestamp]);
    data.activityEvents.push(event);
    existing.add(key);
    changed = true;
  };
  const walk = (nodes: StoreShape['taskBoard'][number]['nodes'], chain: string[] = []) => {
    for (const node of nodes) {
      const path = [...chain, node.title];
      if (node.children.length) walk(node.children, path);
      else if (node.done) add('todo', 'complete', node.mindLinked ? `mind-task:${node.id}` : `tree:${JSON.stringify(path)}`, path.join(' / '), node.doneAt);
    }
  };
  data.taskBoard.forEach(board => walk(board.nodes));
  data.ddls.forEach(d => add('ddl', 'complete', String(d.id), d.name, d.dismissedAt));
  const idea = (i: StoreShape['ideas'][number], id: string) => {
    if (!i.kind || i.kind === 'idea') add('idea', 'create', id, i.title?.trim() || i.text, i.createdAt);
  };
  data.ideas.forEach(i => idea(i, String(i.id)));
  data.trashItems.forEach(t => {
    if (!t.originalData) return;
    if (t.originalTable === 'ideas') idea(t.originalData, String(t.originalId));
    if (t.originalTable === 'ddls') add('ddl', 'complete', String(t.originalId), t.originalData.name, t.originalData.dismissedAt);
  });
  return changed;
}

type Entry = { title: string; progress: number; shelved?: boolean; mindLinked?: boolean; structure?: string; parentId?: string; parentTitle?: string };
type Entries = Map<string, Entry>;
function collect(data: StoreShape): Record<ActivityCategory, Entries> {
  const out = Object.fromEntries(['todo', 'ddl', 'plan', 'goal', 'wish-milestone', 'small-wish', 'chore', 'idea'].map(k => [k, new Map()])) as Record<ActivityCategory, Entries>;
  const walkTodo = (nodes: StoreShape['taskBoard'][number]['nodes'], chain: string[] = []) => {
    for (const n of nodes) {
      const path = [...chain, n.title];
      if (n.children.length) walkTodo(n.children, path);
      else out.todo.set(n.mindLinked ? `mind-task:${n.id}` : `tree:${JSON.stringify(path)}`, {
        title: path.join(' / '), progress: n.done ? 1 : 0, shelved: !!n.shelved, mindLinked: n.mindLinked,
      });
    }
  };
  data.taskBoard.forEach(board => walkTodo(board.nodes));
  data.taskItems.forEach(t => out.todo.set(`task:${t.id}`, { title: t.title, progress: t.completed ? 1 : 0 }));
  data.ddls.forEach(d => out.ddl.set(String(d.id), { title: d.name, progress: d.dismissedAt ? 1 : 0 }));
  data.dailyPlans.forEach(p => p.timeBlocks.forEach(b => {
    const checks = b.checklist ?? [];
    out.plan.set(`${p.date}:${b.id}`, { title: b.taskTitle, progress: b.completed ? 1 : checks.length ? checks.filter(c => c.done).length / checks.length : 0, structure: JSON.stringify(checks.map(c => c.id).sort()), parentId: p.date, parentTitle: p.date });
  }));
  data.longTermGoals.forEach(g => {
    // 秘密花园不向公开的结算记录写入内容或里程碑。
    if (g.kind !== 'wish') {
      const nodes = effectiveNodes(g);
      const shape = (list: typeof nodes): unknown => list.map(n => [n.id, shape(n.children)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      out.goal.set(String(g.id), { title: g.title, progress: (treeProgress(nodes) ?? 0) / 100, structure: JSON.stringify(shape(nodes)) });
    }
  });
  data.ideas.forEach(i => {
    const category = i.kind === 'wish' ? 'small-wish' : i.kind === 'chore' ? 'chore' : 'idea';
    out[category].set(String(i.id), { title: i.title?.trim() || i.text, progress: 0 });
  });
  return out;
}

/** Called only around real mutations, never on load/migration/import/restore. */
export function detectActivity(before: StoreShape, after: StoreShape, options: ActivityOptions = {}, now = new Date()): ActivityEvent[] {
  if (options.skipActivity) return [];
  const a = collect(before), b = collect(after);
  const events: ActivityEvent[] = [];
  const createdAt = (): string => globalThis.crypto?.randomUUID?.() ?? `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2)}-${events.length}`;
  const event = (category: ActivityCategory, entityId: string, entry: Entry, action: ActivityEvent['action'], from: number | null, to: number | null): ActivityEvent =>
    ({ id: createdAt(), date: localActivityDate(now), occurredAt: now.getTime(), category, action, entityId, title: entry.title, from, to, ...(entry.parentId ? { parentId: entry.parentId, parentTitle: entry.parentTitle } : {}) });
  const push = (category: ActivityCategory, entityId: string, entry: Entry, action: ActivityEvent['action'], from: number | null, to: number | null) => {
    events.push(event(category, entityId, entry, action, from, to));
  };
  // 树节点的身份是标题链：改名会表现为「删一条 + 加一条」。
  // 同一次编辑里、同一父节点下成对的增删按改名处理，不计新建/删除。
  const createdTodos: { id: string; entry: Entry }[] = [];
  const deletedTodos: { id: string; entry: Entry }[] = [];
  for (const category of Object.keys(a) as ActivityCategory[]) {
    for (const [id, next] of b[category]) {
      const old = a[category].get(id);
      if (!old) {
        if (category === 'todo' && !next.mindLinked) createdTodos.push({ id, entry: next });
        else if (category === 'idea') push(category, id, next, 'create', null, null);
        // A pre-completed imported/pasted/new item is not a completion interaction.
        continue;
      }
      if (old.structure !== next.structure) continue;
      if (old.progress !== next.progress) push(category, id, next, ['plan', 'goal', 'wish-milestone'].includes(category) ? 'progress' : 'complete', old.progress, next.progress);
      if (category === 'todo' && !!old.shelved !== !!next.shelved) push(category, id, next, 'shelve', old.shelved ? 1 : 0, next.shelved ? 1 : 0);
    }
    for (const [id, old] of a[category]) if (!b[category].has(id)) {
      if (category === 'todo' && !old.progress && !old.mindLinked) deletedTodos.push({ id, entry: old });
      if ((category === 'small-wish' || category === 'chore') && options.activityIntent === 'complete-idea') push(category, id, old, 'complete', 0, 1);
    }
  }
  pairRenames(createdTodos, deletedTodos);
  createdTodos.forEach(item => push('todo', item.id, item.entry, 'create', null, null));
  deletedTodos.forEach(item => push('todo', item.id, item.entry, 'delete', null, null));
  return events;
}

/** 同一父节点下配对的增删视作改名，直接从待记列表里摘掉。 */
function pairRenames(
  created: { id: string; entry: Entry }[],
  deleted: { id: string; entry: Entry }[],
): void {
  if (!created.length || !deleted.length) return;
  const parentKey = (id: string): string => {
    if (!id.startsWith('tree:')) return id;
    const path = JSON.parse(id.slice(5)) as string[];
    return `tree:${JSON.stringify(path.slice(0, -1))}`;
  };
  const pool = new Map<string, string[]>();
  for (const item of deleted) {
    const key = parentKey(item.id);
    const list = pool.get(key);
    if (list) list.push(item.id);
    else pool.set(key, [item.id]);
  }
  const renamed = new Set<string>();
  for (const item of created) {
    const list = pool.get(parentKey(item.id));
    const match = list?.shift();
    if (!match) continue;
    renamed.add(match);
    renamed.add(item.id);
  }
  for (let i = created.length - 1; i >= 0; i--) if (renamed.has(created[i].id)) created.splice(i, 1);
  for (let i = deleted.length - 1; i >= 0; i--) if (renamed.has(deleted[i].id)) deleted.splice(i, 1);
}

/** Sum signed transitions per identity: undo/redo cannot inflate a day's result. */
export function buildSettlement(allEvents: readonly ActivityEvent[], date: string): SettlementSummary {
  const publicEvents = allEvents.filter(e => e.category !== 'wish-milestone');
  const unique = [...new Map(publicEvents.map(e => [e.id, e])).values()];
  const events = unique.filter(e => e.date === date).sort((a, b) => a.occurredAt - b.occurredAt);
  const count = (category: ActivityCategory, action: ActivityEvent['action']) => {
    const net = new Map<string, number>();
    for (const e of events) if (e.category === category && e.action === action) net.set(e.entityId, (net.get(e.entityId) ?? 0) + (e.from === null || e.to === null ? 1 : e.to - e.from));
    return [...net.values()].filter(n => n > 0).length;
  };
  const progress = (category: ActivityCategory): SettlementProgress[] => {
    const map = new Map<string, SettlementProgress>();
    for (const e of events) if (e.category === category && e.action === 'progress' && e.from !== null && e.to !== null) {
      const old = map.get(e.entityId);
      const delta = (old?.delta ?? 0) + e.to - e.from;
      map.set(e.entityId, { entityId: e.entityId, title: e.title, from: old?.from ?? e.from, to: (old?.from ?? e.from) + delta, delta, parentId: e.parentId, parentTitle: e.parentTitle });
    }
    return [...map.values()].filter(p => Math.abs(p.delta) > 1e-9);
  };
  return { date, recordedSince: unique.map(e => e.date).sort()[0] ?? null, events,
    todo: { created: count('todo', 'create'), completed: count('todo', 'complete'), deleted: count('todo', 'delete'), shelved: count('todo', 'shelve') },
    ddlCompleted: count('ddl', 'complete'), plans: progress('plan'), goals: progress('goal'), wishMilestones: progress('wish-milestone'),
    smallWishesCompleted: count('small-wish', 'complete'), choresCompleted: count('chore', 'complete'), ideasCreated: count('idea', 'create') };
}

const percent = (value: number): string => `${Number((value * 100).toFixed(3))}%`;

/**
 * 汇总 → 海报数据。零值整行不出现，整组都为零时连分组标题也不出现，
 * 避免「0 项」占版面和视觉噪音。
 */
export function posterFromSettlement(summary: SettlementSummary): PosterData {
  const sections: PosterData['sections'] = [];
  const counts = (title: string, entries: [string, number][]) => {
    const items = entries.filter(([, value]) => value > 0).map(([label, value]) => ({ label, value: `${value} 项` }));
    if (items.length) sections.push({ title, items });
  };
  const progress = (title: string, entries: SettlementProgress[]) => {
    const items = entries
      .filter(item => Math.abs(item.delta) > 1e-9)
      .map(item => ({
        label: item.title,
        value: `${item.delta > 0 ? '+' : '−'}${Number((Math.abs(item.delta) * 100).toFixed(3))} 个百分点`,
        detail: `${percent(item.from)} → ${percent(item.to)}`,
      }));
    if (items.length) sections.push({ title, items });
  };
  counts('TODO · 行动的足迹', [
    ['新建 TODO', summary.todo.created], ['完成 TODO', summary.todo.completed],
    ['删除 TODO', summary.todo.deleted], ['搁置 TODO', summary.todo.shelved],
  ]);
  counts('DDL · 如期交付', [['完成 DDL', summary.ddlCompleted]]);
  progress('每日计划 · 一步一步', summary.plans);
  progress('长期目标 · 向前生长', summary.goals);
  progress('大愿望 · 里程碑', summary.wishMilestones);
  counts('杂念 · 生活里的小事', [
    ['实现小愿望', summary.smallWishesCompleted], ['办完琐事', summary.choresCompleted], ['记录灵感', summary.ideasCreated],
  ]);
  const total = summary.todo.created + summary.todo.completed + summary.todo.deleted + summary.todo.shelved
    + summary.ddlCompleted + summary.plans.length + summary.goals.length + summary.wishMilestones.length
    + summary.smallWishesCompleted + summary.choresCompleted + summary.ideasCreated;
  return {
    date: summary.date,
    headline: total ? `今天，你在这里留下了 ${total} 次行动。` : undefined,
    sections,
  };
}
