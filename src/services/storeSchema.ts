import type { AnyStoreTable, StoreShape } from '../types/storage';

export type NumericTable = Exclude<AnyStoreTable, 'taskItems'>;

export interface CategoryTableMeta {
  table: Exclude<AnyStoreTable, 'dailyPlans' | 'reflections' | 'harvests' | 'taskItems'>;
  file: string;
  numericId: true;
  writeOrder: number;
}

export const CATEGORY_TABLES = [
  { table: 'longTermGoals', file: 'goals.json', numericId: true, writeOrder: 4 },
  { table: 'fixedRoutines', file: 'routines.json', numericId: true, writeOrder: 5 },
  { table: 'taskTemplates', file: 'templates.json', numericId: true, writeOrder: 6 },
  { table: 'courses', file: 'courses.json', numericId: true, writeOrder: 7 },
  { table: 'semester', file: 'semester.json', numericId: true, writeOrder: 8 },
  { table: 'ddls', file: 'ddls.json', numericId: true, writeOrder: 9 },
  { table: 'important', file: 'important.json', numericId: true, writeOrder: 10 },
  { table: 'backlog', file: 'backlog.json', numericId: true, writeOrder: 11 },
  { table: 'ideas', file: 'ideas.json', numericId: true, writeOrder: 12 },
  { table: 'taskBoard', file: 'taskboard.json', numericId: true, writeOrder: 13 },
  { table: 'linkGroups', file: 'linkGroups.json', numericId: true, writeOrder: 14 },
  { table: 'trashItems', file: 'trash.json', numericId: true, writeOrder: 15 },
] as const satisfies readonly CategoryTableMeta[];

export const CATEGORY_FILES = Object.fromEntries(
  CATEGORY_TABLES.map(meta => [meta.table, meta.file]),
) as Record<CategoryTableMeta['table'], string>;

export const CATEGORY_NAMES = CATEGORY_TABLES.map(meta => meta.file);

export const DEFAULT_WRITE_ORDER: AnyStoreTable[] = [
  'dailyPlans', 'reflections', 'harvests', 'taskItems',
  ...[...CATEGORY_TABLES].sort((a, b) => a.writeOrder - b.writeOrder).map(meta => meta.table),
];

export const NUMERIC_TABLES: NumericTable[] = [
  'dailyPlans', 'longTermGoals', 'reflections', 'harvests', 'fixedRoutines',
  'taskTemplates', 'trashItems', 'courses', 'semester', 'ddls', 'important',
  'backlog', 'ideas', 'taskBoard', 'linkGroups',
];

export const EMPTY_STORE: StoreShape = {
  dailyPlans: [], longTermGoals: [], reflections: [], harvests: [], fixedRoutines: [],
  taskItems: [], taskTemplates: [], trashItems: [], courses: [], semester: [],
  ddls: [], important: [], backlog: [], ideas: [], taskBoard: [], linkGroups: [],
};

export function emptyStore(): StoreShape {
  return Object.fromEntries(Object.keys(EMPTY_STORE).map(key => [key, []])) as unknown as StoreShape;
}
