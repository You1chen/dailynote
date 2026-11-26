import type { TrashItem } from '../types';

/** Older private records share the goals file. Leave them on disk without exposing their contents. */
export function isRetiredPrivateGoal(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as { kind?: unknown; gardenEntry?: unknown; encrypted?: unknown };
  return record.kind === 'wish' || !!record.gardenEntry || !!record.encrypted;
}

export function isRetiredTrashItem(item: TrashItem): boolean {
  return item.originalTable === 'backlog' || item.originalTable === 'ideas'
    || (item.originalTable === 'longTermGoals' && isRetiredPrivateGoal(item.originalData));
}
