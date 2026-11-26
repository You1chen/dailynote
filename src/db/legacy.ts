/**
 * 旧版 Dexie 数据库（仅供升级时一次性迁移读取）
 *
 * 运行时不再使用 IndexedDB 作为数据源；本模块仅在 initStore() 迁移时被调用，
 * 把旧版写入 IndexedDB 的数据并入文件/新后端，成功后即删除旧库。
 */

import Dexie, { type Table } from 'dexie';
import type { DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TrashItem, TaskItem } from '../types';
import type { StoreShape } from '../types/storage';

/** 旧版数据库结构（v1–v4 原样保留） */
class LegacyDailyNoteDB extends Dexie {
  dailyPlans!: Table<DailyPlan, number>;
  longTermGoals!: Table<LongTermGoal, number>;
  reflections!: Table<Reflection, number>;
  harvests!: Table<Harvest, number>;
  fixedRoutines!: Table<FixedRoutine, number>;
  trashItems!: Table<TrashItem, number>;
  taskItems!: Table<TaskItem, string>;

  constructor() {
    super('DailyNoteDB');
    this.version(1).stores({
      dailyPlans: '++id, &date',
      longTermGoals: '++id',
      reflections: '++id, date, period',
      harvests: '++id, date, period',
      fixedRoutines: '++id',
    });
    // v2: longTermGoals 增加 createdAt 索引
    this.version(2).stores({
      longTermGoals: '++id, createdAt',
    });
    // v3: 回收站
    this.version(3).stores({
      trashItems: '++id, originalTable, deletedAt',
    });
    // v4: 任务清单
    this.version(4).stores({
      taskItems: 'id, date, completed',
    });
  }
}

export let legacyDb = new LegacyDailyNoteDB();

export function legacyDatabaseExists(): Promise<boolean> {
  return Dexie.exists(legacyDb.name);
}

/** 读取旧库全部表数据（库不存在/空库返回空结构） */
export async function readLegacyTables(): Promise<Partial<StoreShape>> {
  try {
    const [dailyPlans, longTermGoals, reflections, harvests, fixedRoutines, trashItems, taskItems] = await Promise.all([
      legacyDb.dailyPlans.toArray(),
      legacyDb.longTermGoals.toArray(),
      legacyDb.reflections.toArray(),
      legacyDb.harvests.toArray(),
      legacyDb.fixedRoutines.toArray(),
      legacyDb.trashItems.toArray(),
      legacyDb.taskItems.toArray(),
    ]);
    return { dailyPlans, longTermGoals, reflections, harvests, fixedRoutines, trashItems, taskItems };
  } catch (e) {
    console.warn('读取旧数据库失败:', e);
    return {};
  }
}

/** 删除旧数据库（迁移持久化成功后的提交标记）。删除后重建实例，便于后续复用。 */
export async function deleteLegacyDB(): Promise<void> {
  try {
    await legacyDb.delete();
  } finally {
    legacyDb = new LegacyDailyNoteDB();
  }
}
