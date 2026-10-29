import { describe, expect, it } from 'vitest';
import { CATEGORY_TABLES, DEFAULT_WRITE_ORDER, NUMERIC_TABLES, emptyStore } from '../../src/services/storeSchema';
import type { AnyStoreTable, StoreShape } from '../../src/types/storage';

describe('持久化表注册定义', () => {
  it('每个非日期分类表恰好有唯一文件，并且有默认写入顺序', () => {
    const shape = emptyStore();
    const categoryTables = CATEGORY_TABLES.map(meta => meta.table);
    const files = CATEGORY_TABLES.map(meta => meta.file);
    const nonDayTables = (Object.keys(shape) as AnyStoreTable[])
      .filter(table => !['dailyPlans', 'reflections', 'harvests', 'taskItems', 'activityEvents'].includes(table));

    expect(new Set(categoryTables).size).toBe(categoryTables.length);
    expect(new Set(files).size).toBe(files.length);
    expect(categoryTables.sort()).toEqual(nonDayTables.sort());
    expect(DEFAULT_WRITE_ORDER).toHaveLength(Object.keys(shape).length);
    expect(new Set(DEFAULT_WRITE_ORDER).size).toBe(DEFAULT_WRITE_ORDER.length);
  });

  it('数字主键注册覆盖除字符串主键任务外的全部表', () => {
    const shape = emptyStore() satisfies StoreShape;
    expect([...NUMERIC_TABLES].sort()).toEqual(
      (Object.keys(shape) as AnyStoreTable[]).filter(table => table !== 'taskItems' && table !== 'activityEvents').sort(),
    );
  });
});
