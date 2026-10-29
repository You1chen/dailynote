/**
 * 全局内容搜索 + DDL 红点测试
 *
 * 验证：
 *   1. 只命中用户录入的内容（标题/正文/清单项/备注/教师…），不命中界面文案
 *   2. 日期不参与搜索
 *   3. 命中结果带位置与跳转路由（日维度带 ?date=）
 *   4. 任务节点返回 onOpen='tasks'
 *   5. 大小写不敏感、空查询为空、limit 生效
 *   6. DDL「剩余不足一周」计数（含过期、排除非法格式）
 */

import { describe, it, expect } from 'vitest';
import { searchStore } from '../../src/utils/search';
import { countDdlNear, DDL_NEAR_MIN } from '../../src/utils/ddl';
import type { StoreShape } from '../../src/services/store';

const store = {
  dailyPlans: [{
    id: 1,
    date: '2026-08-13',
    timeBlocks: [{
      id: 'b1',
      startTime: '08:00',
      endTime: '09:00',
      taskTitle: '数学作业',
      plannedContent: '第3章习题',
      checklist: [{ id: 'c1', text: '清单项甲', done: false }],
      actualExecution: '',
      focusScore: 0,
      efficiencyScore: 0,
      completed: false,
      notes: '备注乙',
    }],
    createdAt: 0,
    updatedAt: 0,
  }],
  longTermGoals: [{
    id: 1, title: '考研目标', description: '冲985', category: '学业',
    tasks: [{ id: 't1', title: '子任务丙', completed: false, createdAt: 0 }],
    createdAt: 0, updatedAt: 0,
  }],
  reflections: [],
  harvests: [],
  fixedRoutines: [],
  taskItems: [],
  taskTemplates: [],
  trashItems: [],
  courses: [{
    id: 1, name: '高等数学', teacher: '张老师', location: '三教302', dayOfWeek: [1],
    startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 16,
    createdAt: 0, updatedAt: 0,
  }],
  semester: [],
  ddls: [{
    id: 1, name: '交实验报告', deadlineDate: '2026-08-20', deadlineTime: '18:00',
    location: '实验楼 B2', notes: '补做数据', images: [], createdAt: 0, updatedAt: 0,
  }],
  important: [{
    id: 1, name: '毕业答辩', deadlineDate: '2026-08-20', deadlineTime: '',
    location: '一教 101', notes: '带三份材料', images: [], createdAt: 0, updatedAt: 0,
  }],
  backlog: [{
    id: 1, title: '口语表达未突破', startMode: 'text', startAt: null, startText: '小时候',
    blocker: '能力不足', detail: '需要环境', status: 'blocked', createdAt: 0, updatedAt: 0,
  }],
  taskBoard: [{
    id: 1,
    nodes: [{
      id: 'n1', title: '量子力学', done: false,
      children: [{ id: 'n2', title: '广义统计诠释', done: true, children: [] }],
    }],
    order: [],
    updatedAt: 0,
  }],
} as unknown as StoreShape;

const find = (q: string, limit?: number) => searchStore(store, q, limit);

describe('全局内容搜索', () => {
  it('命中时间块标题，带位置与日期路由', () => {
    const hits = find('数学作业');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('数学作业');
    expect(hits[0].where).toBe('时间块 · 8/13 08:00-09:00');
    expect(hits[0].route).toBe('/?date=2026-08-13');
  });

  it('命中清单项与备注', () => {
    expect(find('清单项甲')).toHaveLength(1);
    expect(find('备注乙')).toHaveLength(1);
  });

  it('命中课程教师，跳到课程表', () => {
    const hits = find('张老师');
    expect(hits[0].title).toBe('高等数学');
    expect(hits[0].route).toBe('/courses');
  });

  it('命中 DDL 备注，跳到 DDL', () => {
    expect(find('补做数据')[0].route).toBe('/ddl');
    expect(find('实验楼 B2')[0].route).toBe('/ddl');
  });

  it('命中重要的事（名称/备注/地点），跳到 /important', () => {
    expect(find('毕业答辩')[0].route).toBe('/important');
    expect(find('三份材料')[0].route).toBe('/important');
    expect(find('一教 101')[0].route).toBe('/important');
  });

  it('命中遗留问题的困难与详情', () => {
    expect(find('能力不足')[0].route).toBe('/backlog');
    expect(find('需要环境')[0].route).toBe('/backlog');
  });

  it('命中目标子任务', () => {
    const hits = find('子任务丙');
    expect(hits[0].title).toBe('考研目标');
    expect(hits[0].route).toBe('/goals');
  });

  it('任务节点返回 onOpen=tasks', () => {
    const hits = find('广义统计诠释');
    expect(hits).toHaveLength(1);
    expect(hits[0].route).toBe('/');
    expect(hits[0].onOpen).toBe('tasks');
    expect(hits[0].where).toContain('量子力学');
  });

  it('不命中界面文案（"时间块"不是用户内容）', () => {
    expect(find('时间块')).toHaveLength(0);
    expect(find('遗留问题')).toHaveLength(0);
  });

  it('日期不参与搜索', () => {
    expect(find('2026')).toHaveLength(0);
    expect(find('2026-08-13')).toHaveLength(0);
  });

  it('大小写不敏感', () => {
    expect(find('PPT')).toHaveLength(0);
    expect(find('数学作业')).toHaveLength(1);
  });

  it('空查询返回空', () => {
    expect(find('')).toHaveLength(0);
    expect(find('   ')).toHaveLength(0);
  });

  it('limit 生效', () => {
    expect(find('数学', 1)).toHaveLength(1);
  });
});

describe('目标树搜索', () => {
  const withTree = {
    ...store,
    longTermGoals: [
      {
        id: 2, title: '英语考试', description: '', category: '学业', tasks: [],
        nodes: [{
          id: 'g1', title: '听力', completed: false,
          children: [{ id: 'g2', title: '精听训练', completed: false, children: [] }],
        }],
        createdAt: 0, updatedAt: 0,
      },
      {
        id: 3, kind: 'wish', title: '去海边', vision: '坐在礁石上听浪', description: '想记住安静',
        category: '其他', tasks: [{ id: 'm1', title: '攒路费', completed: false, createdAt: 0 }],
        createdAt: 0, updatedAt: 0,
      },
    ],
  } as unknown as StoreShape;

  it('递归命中树的深层节点', () => {
    const hits = searchStore(withTree, '精听训练');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('英语考试');
    expect(hits[0].where).toBe('长期目标 · 学业');
    expect(hits[0].route).toBe('/goals');
  });

  it('命中的是大愿望时位置文案是「大愿望」', () => {
    const hits = searchStore(withTree, '攒路费');
    expect(hits).toHaveLength(1);
    expect(hits[0].where).toBe('大愿望 · 其他');
  });

  it('大愿望的愿景与动机可被搜索', () => {
    expect(searchStore(withTree, '礁石上听浪')).toHaveLength(1);
    expect(searchStore(withTree, '想记住安静')).toHaveLength(1);
  });
});

describe('DDL 剩余不足一周计数', () => {
  const now = new Date('2026-08-13T12:00:00');
  const mk = (deadlineDate: string, deadlineTime = '18:00') => ({ deadlineDate, deadlineTime });

  it('剩余 6 天 → 计入', () => {
    expect(countDdlNear([mk('2026-08-19')], now)).toBe(1);
  });

  it('剩余 10 天 → 不计入', () => {
    expect(countDdlNear([mk('2026-08-23')], now)).toBe(0);
  });

  it('已过期 → 计入', () => {
    expect(countDdlNear([mk('2026-08-01')], now)).toBe(1);
  });

  it('恰好一周内（阈值前 1 分钟）计入，超过阈值不计', () => {
    const inDays = (min: number) => {
      const d = new Date(now.getTime() + min * 60000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    expect(countDdlNear([mk(inDays(DDL_NEAR_MIN - 10), '00:00')], now)).toBe(1);
    expect(countDdlNear([mk(inDays(DDL_NEAR_MIN + 24 * 60), '00:00')], now)).toBe(0);
  });

  it('格式非法 → 不计入', () => {
    expect(countDdlNear([mk('2026-13-40')], now)).toBe(0);
    expect(countDdlNear([mk('2026-08-19', '25:00')], now)).toBe(0);
  });

  it('混合列表只数临近的', () => {
    expect(countDdlNear([mk('2026-08-14'), mk('2026-09-30'), mk('2026-08-01')], now)).toBe(2);
  });
});
