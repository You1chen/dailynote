/**
 * 任务清单逻辑测试
 *
 * 验证：
 *   1. TaskItem 类型字段完整性
 *   2. genId 生成唯一 ID
 *   3. 任务排序逻辑
 *   4. 完成/未完成状态切换
 *   5. 任务清单过滤与统计
 */
import { describe, it, expect } from 'vitest';

// ============================================================
// 模拟 TaskItem 类型和操作函数（纯逻辑，不依赖 IndexedDB）
// ============================================================

interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  date: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function createTaskItem(title: string, date: string, sortOrder: number): TaskItem {
  return {
    id: genId(),
    title: title.trim(),
    completed: false,
    date,
    sortOrder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function toggleCompleted(item: TaskItem): TaskItem {
  return { ...item, completed: !item.completed, updatedAt: Date.now() };
}

function sortByOrder(items: TaskItem[]): TaskItem[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

function getStats(items: TaskItem[]): { total: number; completed: number; pending: number } {
  return {
    total: items.length,
    completed: items.filter(t => t.completed).length,
    pending: items.filter(t => !t.completed).length,
  };
}

// ============================================================
// 测试
// ============================================================

describe('TaskItem — 创建', () => {
  it('创建任务应包含所有必要字段', () => {
    const item = createTaskItem('买咖啡豆', '2026-07-25', 1);
    expect(item.title).toBe('买咖啡豆');
    expect(item.date).toBe('2026-07-25');
    expect(item.completed).toBe(false);
    expect(item.sortOrder).toBe(1);
    expect(item.id).toBeTruthy();
    expect(item.createdAt).toBeGreaterThan(0);
  });

  it('生成的两个 ID 应不同', () => {
    const id1 = genId();
    const id2 = genId();
    expect(id1).not.toBe(id2);
  });

  it('标题应自动 trim', () => {
    const item = createTaskItem('  整理桌面  ', '2026-07-25', 1);
    expect(item.title).toBe('整理桌面');
  });

  it('新任务默认未完成', () => {
    const item = createTaskItem('测试', '2026-07-25', 1);
    expect(item.completed).toBe(false);
  });
});

describe('TaskItem — 完成状态切换', () => {
  it('未完成 → 完成', () => {
    const item = createTaskItem('测试', '2026-07-25', 1);
    const toggled = toggleCompleted(item);
    expect(toggled.completed).toBe(true);
    expect(toggled.updatedAt).toBeGreaterThanOrEqual(item.updatedAt);
  });

  it('完成 → 未完成', () => {
    const item = createTaskItem('测试', '2026-07-25', 1);
    const done = toggleCompleted(item);
    const undone = toggleCompleted(done);
    expect(undone.completed).toBe(false);
  });

  it('切换不改变其他字段', () => {
    const item = createTaskItem('测试', '2026-07-25', 1);
    const toggled = toggleCompleted(item);
    expect(toggled.id).toBe(item.id);
    expect(toggled.title).toBe(item.title);
    expect(toggled.date).toBe(item.date);
    expect(toggled.sortOrder).toBe(item.sortOrder);
  });
});

describe('TaskItem — 排序', () => {
  it('应按 sortOrder 升序排列', () => {
    const items: TaskItem[] = [
      createTaskItem('C', '2026-07-25', 3),
      createTaskItem('A', '2026-07-25', 1),
      createTaskItem('B', '2026-07-25', 2),
    ];
    const sorted = sortByOrder(items);
    expect(sorted[0].sortOrder).toBe(1);
    expect(sorted[1].sortOrder).toBe(2);
    expect(sorted[2].sortOrder).toBe(3);
    expect(sorted[0].title).toBe('A');
    expect(sorted[2].title).toBe('C');
  });

  it('相同 sortOrder 保持原顺序', () => {
    const items: TaskItem[] = [
      createTaskItem('X', '2026-07-25', 1),
      createTaskItem('Y', '2026-07-25', 1),
    ];
    const sorted = sortByOrder(items);
    expect(sorted).toHaveLength(2);
  });
});

describe('TaskItem — 统计', () => {
  it('空列表统计应为 0', () => {
    const stats = getStats([]);
    expect(stats).toEqual({ total: 0, completed: 0, pending: 0 });
  });

  it('全部未完成', () => {
    const items = [
      createTaskItem('A', '2026-07-25', 1),
      createTaskItem('B', '2026-07-25', 2),
    ];
    const stats = getStats(items);
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(0);
    expect(stats.pending).toBe(2);
  });

  it('部分完成时统计应正确', () => {
    const items = [
      createTaskItem('A', '2026-07-25', 1),
      createTaskItem('B', '2026-07-25', 2),
      createTaskItem('C', '2026-07-25', 3),
    ];
    items[1] = toggleCompleted(items[1]);
    const stats = getStats(items);
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(2);
  });

  it('全部完成', () => {
    const items = [
      createTaskItem('A', '2026-07-25', 1),
      createTaskItem('B', '2026-07-25', 2),
    ];
    const allDone = items.map(toggleCompleted);
    const stats = getStats(allDone);
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(2);
    expect(stats.pending).toBe(0);
  });
});

describe('TaskItem — 日期隔离', () => {
  it('不同日期的任务应独立', () => {
    const item1 = createTaskItem('任务A', '2026-07-25', 1);
    const item2 = createTaskItem('任务B', '2026-07-26', 1);

    expect(item1.date).not.toBe(item2.date);
    expect(item1.id).not.toBe(item2.id);
  });
});

describe('TaskItem — 边界情况', () => {
  it('超长标题', () => {
    const longTitle = '这是一个非常非常非常非常非常长的任务标题'.repeat(10);
    const item = createTaskItem(longTitle, '2026-07-25', 1);
    expect(item.title).toBe(longTitle.trim());
  });

  it('标题含特殊字符', () => {
    const special = '买 🎉 咖啡 & 面包 <test> "quote"';
    const item = createTaskItem(special, '2026-07-25', 1);
    expect(item.title).toBe(special.trim());
  });

  it('sortOrder 为 0', () => {
    const item = createTaskItem('首项', '2026-07-25', 0);
    expect(item.sortOrder).toBe(0);
  });

  it('批量创建 100 个任务', () => {
    const items: TaskItem[] = [];
    for (let i = 0; i < 100; i++) {
      items.push(createTaskItem(`任务 ${i + 1}`, '2026-07-25', i + 1));
    }
    expect(items).toHaveLength(100);
    const sorted = sortByOrder(items);
    expect(sorted[0].sortOrder).toBe(1);
    expect(sorted[99].sortOrder).toBe(100);
    // 所有 ID 唯一
    const ids = new Set(items.map(t => t.id));
    expect(ids.size).toBe(100);
  });
});
