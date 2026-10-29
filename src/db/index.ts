/**
 * 内存 CRUD 层
 *
 * 所有读写直接作用于权威内存 store（src/services/store.ts），
 * 每次变更立即写回用户目录文件（file-authoritative）。
 * 保持与旧版完全一致的导出函数签名，页面/Hook 无需改动。
 */

import type { DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TaskItem, TaskTemplate, TrashItem, Course, SemesterRecord, DdlItem, BacklogItem, BacklogStatus, TaskBoard, TaskNode, ImportantItem, LinkGroup, Idea } from '../types';
import { normalizeCourseDayOfWeek } from '../types';
import { store, mutate, allocId, deepClone, bindLegacyCourses, type AnyStoreTable } from '../services/store';
import { toggleLeafDone, removeLeaf, setLeafShelved, normalizeOrder } from '../utils/taskTree';
import { searchStore, type SearchHit } from '../utils/search';
import { DDL_DEFAULT_TIME } from '../utils/ddl';

// ============ 每日计划 CRUD ============

export async function getPlanByDate(date: string): Promise<DailyPlan | undefined> {
  const found = store.dailyPlans.find(p => p.date === date);
  return found ? deepClone(found) : undefined;
}

export async function savePlan(plan: DailyPlan): Promise<number> {
  const clean = deepClone(plan);
  let resultId = 0;
  await mutate(() => {
    const idx = store.dailyPlans.findIndex(p => p.date === clean.date);
    if (idx >= 0) {
      resultId = store.dailyPlans[idx].id!;
      store.dailyPlans[idx] = { ...clean, id: resultId, updatedAt: Date.now() };
    } else {
      resultId = allocId('dailyPlans');
      store.dailyPlans.push({ ...clean, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  return resultId;
}

export async function getAllPlans(): Promise<DailyPlan[]> {
  return deepClone([...store.dailyPlans].sort((a, b) => b.date.localeCompare(a.date)));
}

// ============ 长期目标 CRUD ============

export async function getAllGoals(): Promise<LongTermGoal[]> {
  return deepClone([...store.longTermGoals].sort((a, b) => b.createdAt - a.createdAt));
}

export async function saveGoal(goal: LongTermGoal): Promise<number> {
  return (await saveGoalDetailed(goal)).id;
}

/**
 * 保存目标并返回是否落盘成功。
 * 页面编辑目标时需要知道写盘失败（否则关了弹窗却什么都没保存），
 * 又不想破坏 `saveGoal` 原有的 number 返回值。
 */
export async function saveGoalDetailed(goal: LongTermGoal): Promise<{ id: number; ok: boolean }> {
  const clean = deepClone(goal);
  let resultId = 0;
  const ok = await mutate(() => {
    if (clean.id != null) {
      const idx = store.longTermGoals.findIndex(g => g.id === clean.id);
      if (idx >= 0) store.longTermGoals[idx] = { ...clean, updatedAt: Date.now() };
      resultId = clean.id;
      return;
    }
    resultId = allocId('longTermGoals');
    store.longTermGoals.push({ ...clean, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  return { id: resultId, ok };
}

export async function deleteGoal(id: number): Promise<boolean> {
  return mutate(() => {
    const goal = store.longTermGoals.find(g => g.id === id);
    if (goal) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'longTermGoals',
        originalId: id,
        originalData: deepClone(goal),
        title: goal.title,
        deletedAt: Date.now(),
      });
      store.longTermGoals = store.longTermGoals.filter(g => g.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'longTermGoals'] });
}

// ============ 反思 CRUD ============

export async function getReflectionsByDate(date: string): Promise<Reflection[]> {
  return deepClone(store.reflections.filter(r => r.date === date));
}

export async function saveReflection(r: Reflection): Promise<number> {
  r = deepClone(r);
  let resultId = 0;
  await mutate(() => {
    if (r.id != null) {
      const idx = store.reflections.findIndex(x => x.id === r.id);
      if (idx >= 0) store.reflections[idx] = r;
      resultId = r.id;
      return;
    }
    resultId = allocId('reflections');
    store.reflections.push({ ...r, id: resultId, createdAt: Date.now() });
  });
  return resultId;
}

export async function deleteReflection(id: number): Promise<void> {
  await mutate(() => {
    const r = store.reflections.find(x => x.id === id);
    if (r) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'reflections',
        originalId: id,
        originalData: deepClone(r),
        title: `反思 - ${r.problem?.slice(0, 30) || '无标题'}`,
        deletedAt: Date.now(),
      });
      store.reflections = store.reflections.filter(x => x.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'reflections'] });
}

export async function getAllReflections(): Promise<Reflection[]> {
  return deepClone([...store.reflections].sort((a, b) => b.date.localeCompare(a.date)));
}

// ============ 收获 CRUD ============

export async function getHarvestsByDate(date: string): Promise<Harvest[]> {
  return deepClone(store.harvests.filter(h => h.date === date));
}

export async function saveHarvest(h: Harvest): Promise<number> {
  h = deepClone(h);
  let resultId = 0;
  await mutate(() => {
    if (h.id != null) {
      const idx = store.harvests.findIndex(x => x.id === h.id);
      if (idx >= 0) store.harvests[idx] = h;
      resultId = h.id;
      return;
    }
    resultId = allocId('harvests');
    store.harvests.push({ ...h, id: resultId, createdAt: Date.now() });
  });
  return resultId;
}

export async function deleteHarvest(id: number): Promise<void> {
  await mutate(() => {
    const h = store.harvests.find(x => x.id === id);
    if (h) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'harvests',
        originalId: id,
        originalData: deepClone(h),
        title: `收获 - ${h.content?.slice(0, 30) || '无标题'}`,
        deletedAt: Date.now(),
      });
      store.harvests = store.harvests.filter(x => x.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'harvests'] });
}

export async function getAllHarvests(): Promise<Harvest[]> {
  return deepClone([...store.harvests].sort((a, b) => b.date.localeCompare(a.date)));
}

// ============ 固定作息 CRUD ============

export async function getAllRoutines(): Promise<FixedRoutine[]> {
  return deepClone([...store.fixedRoutines]);
}

export async function getActiveRoutine(): Promise<FixedRoutine | undefined> {
  return deepClone(store.fixedRoutines.find(r => r.isActive));
}

export async function saveRoutine(r: FixedRoutine): Promise<number> {
  r = deepClone(r);
  let resultId = 0;
  await mutate(() => {
    if (r.id != null) {
      const idx = store.fixedRoutines.findIndex(x => x.id === r.id);
      if (idx >= 0) store.fixedRoutines[idx] = { ...r } as FixedRoutine;
      resultId = r.id;
      return;
    }
    resultId = allocId('fixedRoutines');
    store.fixedRoutines.push({ ...r, id: resultId, createdAt: Date.now() });
  });
  return resultId;
}

export async function setActiveRoutine(id: number): Promise<void> {
  await mutate(() => {
    store.fixedRoutines = store.fixedRoutines.map(r => ({ ...r, isActive: r.id === id }));
  });
}

export async function deleteRoutine(id: number): Promise<void> {
  await mutate(() => {
    const r = store.fixedRoutines.find(x => x.id === id);
    if (r) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'fixedRoutines',
        originalId: id,
        originalData: deepClone(r),
        title: `作息模板 - ${r.name || '未命名'}`,
        deletedAt: Date.now(),
      });
      store.fixedRoutines = store.fixedRoutines.filter(x => x.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'fixedRoutines'] });
}

// ============ 课程表 CRUD ============

export async function getAllCourses(): Promise<Course[]> {
  // 多星期课程按最早的一天排序（同门课在多个分组重复出现，卡片顺序仍稳定）
  const minDay = (c: Course) => (c.dayOfWeek.length > 0 ? Math.min(...c.dayOfWeek) : 0);
  return deepClone([...store.courses].sort((a, b) => minDay(a) - minDay(b) || a.startTime.localeCompare(b.startTime)));
}

export async function saveCourse(course: Course): Promise<number> {
  course = deepClone(course);
  const clean = normalizeCourseDayOfWeek(course);
  let resultId = 0;
  await mutate(() => {
    if (clean.id != null) {
      const idx = store.courses.findIndex(c => c.id === clean.id);
      if (idx >= 0) store.courses[idx] = {
        ...clean,
        semesterStartDate: clean.semesterStartDate ?? store.courses[idx].semesterStartDate ?? store.semester[0]?.startDate ?? undefined,
        updatedAt: Date.now(),
      };
      resultId = clean.id;
      return;
    }
    resultId = allocId('courses');
    store.courses.push({ ...clean, semesterStartDate: clean.semesterStartDate ?? store.semester[0]?.startDate ?? undefined, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  return resultId;
}

export async function deleteCourse(id: number): Promise<void> {
  await mutate(() => {
    const course = store.courses.find(c => c.id === id);
    if (course) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'courses',
        originalId: id,
        originalData: deepClone(course),
        title: `课程 - ${course.name}`,
        deletedAt: Date.now(),
      });
      store.courses = store.courses.filter(c => c.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'courses'] });
}

/** 学期设置（单记录，id 恒为 1；从未设置过则返回 undefined） */
export async function getSemester(): Promise<SemesterRecord | undefined> {
  const rec = store.semester.find(s => s.id === 1) ?? store.semester[0];
  return deepClone(rec ? { ...rec, specialDates: rec.specialDates.map(d => ({ ...d })) } : undefined);
}

export async function saveSemester(record: SemesterRecord): Promise<number> {
  record = deepClone(record);
  await mutate(() => {
    bindLegacyCourses(store.semester[0]?.startDate ?? record.startDate);
    // 恒单记录：强制 id = 1，不调用 allocId（避免计数器膨胀）
    const clean = { ...record, id: 1, updatedAt: Date.now() };
    const idx = store.semester.findIndex(s => s.id === 1);
    if (idx >= 0) store.semester[idx] = clean;
    else store.semester.push(clean);
  });
  return 1;
}

// ============ DDL 截止清单 CRUD ============

export async function getAllDdls(): Promise<DdlItem[]> {
  // 按截止时间升序（日期 → 时间 → id），已过期的自然排在最前；时间未填按 23:59
  const tm = (x: { deadlineTime: string }) => x.deadlineTime?.trim() || DDL_DEFAULT_TIME;
  return deepClone([...store.ddls].sort((a, b) =>
    a.deadlineDate.localeCompare(b.deadlineDate)
    || tm(a).localeCompare(tm(b))
    || (a.id ?? 0) - (b.id ?? 0)));
}

export async function saveDdl(ddl: DdlItem): Promise<number> {
  ddl = deepClone(ddl);
  let resultId = 0;
  await mutate(() => {
    if (ddl.id != null) {
      const idx = store.ddls.findIndex(d => d.id === ddl.id);
      if (idx >= 0) store.ddls[idx] = { ...ddl, updatedAt: Date.now() };
      resultId = ddl.id;
      return;
    }
    resultId = allocId('ddls');
    store.ddls.push({ ...ddl, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  notifyDdlChanged();
  return resultId;
}

export async function deleteDdl(id: number): Promise<void> {
  await mutate(() => {
    const ddl = store.ddls.find(d => d.id === id);
    if (ddl) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'ddls',
        originalId: id,
        originalData: deepClone(ddl),
        title: `DDL - ${ddl.name}`,
        deletedAt: Date.now(),
      });
      store.ddls = store.ddls.filter(d => d.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'ddls'] });
  notifyDdlChanged();
}

// ============ 关联分组 CRUD（内置的「课程」组直接读课程表，不落库） ============

export async function getAllLinkGroups(): Promise<LinkGroup[]> {
  // 按创建顺序，用户自己排的组不会每次打开都跳位置
  return deepClone([...store.linkGroups].sort((a, b) => a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0)));
}

export async function saveLinkGroup(group: LinkGroup): Promise<number> {
  group = deepClone(group);
  let resultId = 0;
  await mutate(() => {
    if (group.id != null) {
      const idx = store.linkGroups.findIndex(g => g.id === group.id);
      if (idx >= 0) store.linkGroups[idx] = { ...group, updatedAt: Date.now() };
      resultId = group.id;
      return;
    }
    resultId = allocId('linkGroups');
    store.linkGroups.push({ ...group, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  return resultId;
}

export async function deleteLinkGroup(id: number): Promise<void> {
  await mutate(() => {
    const group = store.linkGroups.find(g => g.id === id);
    if (group) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'linkGroups',
        originalId: id,
        originalData: deepClone(group),
        title: `关联分组 - ${group.name}`,
        deletedAt: Date.now(),
      });
      store.linkGroups = store.linkGroups.filter(g => g.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'linkGroups'] });
}

// ============ 回收站 CRUD ============

export async function getTrashItems(): Promise<TrashItem[]> {
  return deepClone([...store.trashItems].sort((a, b) => b.deletedAt - a.deletedAt));
}

/** 回收站条目对应的原表（timeBlocks 还原到当天计划） */
const TRASH_TARGET: Record<string, AnyStoreTable> = {
  longTermGoals: 'longTermGoals',
  reflections: 'reflections',
  harvests: 'harvests',
  fixedRoutines: 'fixedRoutines',
  taskItems: 'taskItems',
  taskTemplates: 'taskTemplates',
  courses: 'courses',
  ddls: 'ddls',
  important: 'important',
  backlog: 'backlog',
  ideas: 'ideas',
  linkGroups: 'linkGroups',
  timeBlocks: 'dailyPlans',
};

export async function restoreFromTrash(trashId: number): Promise<boolean> {
  const item = store.trashItems.find(t => t.id === trashId);
  if (!item) return false;
  // 先写"新增"侧（原表），再写"移除"侧（回收站），崩溃中断不丢数据
  const target = TRASH_TARGET[item.originalTable];
  const writeOrder: AnyStoreTable[] | undefined = target ? [target, 'trashItems'] : undefined;
  let ok = false;
  await mutate(() => {
    const it = store.trashItems.find(t => t.id === trashId);
    if (!it) return;
    const { originalTable, originalData } = it;
    try {
      switch (originalTable) {
        case 'longTermGoals': {
          const rec = originalData as LongTermGoal;
          if (rec.id != null && store.longTermGoals.some(g => g.id === rec.id)) { ok = false; return; }
          store.longTermGoals.push(rec);
          break;
        }
        case 'reflections': {
          const rec = originalData as Reflection;
          if (rec.id != null && store.reflections.some(x => x.id === rec.id)) { ok = false; return; }
          store.reflections.push(rec);
          break;
        }
        case 'harvests': {
          const rec = originalData as Harvest;
          if (rec.id != null && store.harvests.some(x => x.id === rec.id)) { ok = false; return; }
          store.harvests.push(rec);
          break;
        }
        case 'fixedRoutines': {
          const rec = originalData as FixedRoutine;
          if (rec.id != null && store.fixedRoutines.some(x => x.id === rec.id)) { ok = false; return; }
          store.fixedRoutines.push(rec);
          break;
        }
        case 'taskItems': {
          const rec = originalData as TaskItem;
          if (rec.id && store.taskItems.some(t => t.id === rec.id)) { ok = false; return; }
          store.taskItems.push(rec);
          break;
        }
        case 'taskTemplates': {
          const rec = originalData as TaskTemplate;
          if (rec.id != null && store.taskTemplates.some(x => x.id === rec.id)) { ok = false; return; }
          store.taskTemplates.push(rec);
          break;
        }
        case 'courses': {
          const rec = originalData as Course;
          if (rec.id != null && store.courses.some(c => c.id === rec.id)) { ok = false; return; }
          store.courses.push(normalizeCourseDayOfWeek(rec));
          break;
        }
        case 'ddls': {
          const rec = originalData as DdlItem;
          if (rec.id != null && store.ddls.some(d => d.id === rec.id)) { ok = false; return; }
          store.ddls.push(rec);
          break;
        }
        case 'important': {
          const rec = originalData as ImportantItem;
          if (rec.id != null && store.important.some(d => d.id === rec.id)) { ok = false; return; }
          store.important.push(rec);
          break;
        }
        case 'backlog': {
          const rec = originalData as BacklogItem;
          if (rec.id != null && store.backlog.some(b => b.id === rec.id)) { ok = false; return; }
          store.backlog.push(rec);
          break;
        }
        case 'ideas': {
          const rec = originalData as Idea;
          if (rec.id != null && store.ideas.some(i => i.id === rec.id)) { ok = false; return; }
          store.ideas.push(rec);
          break;
        }
        case 'linkGroups': {
          const rec = originalData as LinkGroup;
          if (rec.id != null && store.linkGroups.some(g => g.id === rec.id)) { ok = false; return; }
          store.linkGroups.push(rec);
          break;
        }
        case 'timeBlocks':
          restoreTimeBlockSync(originalData);
          break;
        default:
          return;
      }
      store.trashItems = store.trashItems.filter(t => t.id !== trashId);
      ok = true;
    } catch {
      ok = false;
    }
  }, { writeOrder });
  if (ok && item.originalTable === 'ideas') notifyIdeasChanged();
  return ok;
}

/** 还原时间块到对应日期的 DailyPlan */
function restoreTimeBlockSync(block: any): void {
  const { date, ...blockData } = block;
  if (!date) return;
  const idx = store.dailyPlans.findIndex(p => p.date === date);
  if (idx >= 0) {
    store.dailyPlans[idx] = {
      ...store.dailyPlans[idx],
      timeBlocks: [...store.dailyPlans[idx].timeBlocks, blockData],
      updatedAt: Date.now(),
    };
  } else {
    store.dailyPlans.push({
      date,
      timeBlocks: [blockData],
      id: allocId('dailyPlans'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

export async function permanentlyDelete(trashId: number): Promise<void> {
  await mutate(() => {
    store.trashItems = store.trashItems.filter(t => t.id !== trashId);
  });
}

export async function clearAllTrash(): Promise<void> {
  await mutate(() => {
    store.trashItems = [];
  });
}

/** 清理超过30天的回收站项 */
export async function cleanOldTrash(): Promise<void> {
  await mutate(() => {
    cleanOldTrashSync();
  });
}

function cleanOldTrashSync(): void {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  store.trashItems = store.trashItems.filter(t => t.deletedAt >= cutoff);
}

/** 将时间块移入回收站 */
export async function moveTimeBlockToTrash(date: string, block: any, title: string): Promise<void> {
  await mutate(() => {
    store.trashItems.push({
      id: allocId('trashItems'),
      originalTable: 'timeBlocks',
      originalId: block.id,
      originalData: deepClone({ date, ...block }),
      title,
      deletedAt: Date.now(),
    });
    cleanOldTrashSync();
  });
}

// ============ 任务清单 CRUD ============

export async function getTaskItemsByDate(date: string): Promise<TaskItem[]> {
  return deepClone(store.taskItems
    .filter(t => t.date === date)
    .sort((a, b) => a.sortOrder - b.sortOrder));
}

export async function saveTaskItem(item: TaskItem): Promise<void> {
  await mutate(() => {
    const idx = store.taskItems.findIndex(t => t.id === item.id);
    if (idx >= 0) {
      store.taskItems[idx] = { ...item, updatedAt: Date.now() };
    } else {
      store.taskItems.push({ ...item, createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
}

export async function toggleTaskItem(id: string): Promise<void> {
  await mutate(() => {
    const idx = store.taskItems.findIndex(t => t.id === id);
    if (idx >= 0) {
      const cur = store.taskItems[idx];
      store.taskItems[idx] = { ...cur, completed: !cur.completed, updatedAt: Date.now() };
    }
  });
}

export async function deleteTaskItem(id: string): Promise<void> {
  await mutate(() => {
    const item = store.taskItems.find(t => t.id === id);
    if (item) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'taskItems',
        originalId: id,
        originalData: deepClone(item),
        title: `任务清单项 - ${item.title?.slice(0, 30) || '无标题'}`,
        deletedAt: Date.now(),
      });
      store.taskItems = store.taskItems.filter(t => t.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'taskItems'] });
}

// ============ 任务清单模板 CRUD ============

export async function getAllTaskTemplates(): Promise<TaskTemplate[]> {
  return deepClone([...store.taskTemplates]);
}

export async function saveTaskTemplate(t: TaskTemplate): Promise<number> {
  t = deepClone(t);
  let resultId = 0;
  await mutate(() => {
    if (t.id != null) {
      const idx = store.taskTemplates.findIndex(x => x.id === t.id);
      if (idx >= 0) store.taskTemplates[idx] = { ...t, updatedAt: Date.now() };
      resultId = t.id;
      return;
    }
    resultId = allocId('taskTemplates');
    store.taskTemplates.push({ ...t, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  return resultId;
}

export async function deleteTaskTemplate(id: number): Promise<void> {
  await mutate(() => {
    const t = store.taskTemplates.find(x => x.id === id);
    if (t) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'taskTemplates',
        originalId: id,
        originalData: deepClone(t),
        title: `任务模板 - ${t.name || '未命名'}`,
        deletedAt: Date.now(),
      });
      store.taskTemplates = store.taskTemplates.filter(x => x.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'taskTemplates'] });
}

// ============ 杂念（小愿望 / 琐事 / 灵感） CRUD ============

/**
 * 杂念变更通知：计划页的分类计数、收获页的按日统计各自持有 useIdeas 实例，
 * 靠这个事件立即刷新，而不是等切换页面重新挂载。
 */
function notifyIdeasChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('dailynote-ideas-changed'));
}

/** 按日期倒序、同日按创建时间倒序 */
export async function getAllIdeas(): Promise<Idea[]> {
  return deepClone([...store.ideas].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt;
  }));
}

export async function saveIdea(item: Idea): Promise<number> {
  item = deepClone(item);
  let resultId = 0;
  await mutate(() => {
    if (item.id != null) {
      const idx = store.ideas.findIndex(x => x.id === item.id);
      if (idx >= 0) store.ideas[idx] = { ...item, updatedAt: Date.now() };
      resultId = item.id;
      return;
    }
    resultId = allocId('ideas');
    store.ideas.push({ ...item, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  notifyIdeasChanged();
  return resultId;
}

export async function deleteIdea(id: number): Promise<void> {
  await mutate(() => {
    const item = store.ideas.find(x => x.id === id);
    if (item) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'ideas',
        originalId: id,
        title: `灵感 - ${item.text.slice(0, 12)}`,
        originalData: JSON.parse(JSON.stringify(item)),
        deletedAt: Date.now(),
      });
      store.ideas = store.ideas.filter(x => x.id !== id);
      cleanOldTrashSync();
    }
  }, { writeOrder: ['trashItems', 'ideas'] });
  notifyIdeasChanged();
}
// ============ 遗留问题 CRUD ============

export async function getAllBacklog(): Promise<BacklogItem[]> {
  return deepClone([...store.backlog]);
}

export async function saveBacklog(item: BacklogItem): Promise<number> {
  item = deepClone(item);
  let resultId = 0;
  await mutate(() => {
    if (item.id != null) {
      const idx = store.backlog.findIndex(x => x.id === item.id);
      if (idx >= 0) store.backlog[idx] = { ...item, updatedAt: Date.now() };
      resultId = item.id;
      return;
    }
    resultId = allocId('backlog');
    store.backlog.push({ ...item, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  return resultId;
}

/** 只改状态：更新时间戳即"重新计时"（气泡不催刚动过的） */
export async function setBacklogStatus(id: number, status: BacklogStatus): Promise<void> {
  await mutate(() => {
    const idx = store.backlog.findIndex(x => x.id === id);
    if (idx >= 0) store.backlog[idx] = { ...store.backlog[idx], status, updatedAt: Date.now() };
  });
}

export async function deleteBacklog(id: number): Promise<void> {
  await mutate(() => {
    const item = store.backlog.find(x => x.id === id);
    if (item) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'backlog',
        originalId: id,
        originalData: deepClone(item),
        title: `遗留问题 - ${item.title?.slice(0, 30) || '无标题'}`,
        deletedAt: Date.now(),
      });
      store.backlog = store.backlog.filter(x => x.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'backlog'] });
}


// ============ 任务树 CRUD（单记录数组表，id 恒 1） ============

export async function getTaskBoard(): Promise<TaskBoard> {
  return deepClone(store.taskBoard.find(b => b.id === 1) ?? { id: 1, nodes: [], order: [], updatedAt: 0 });
}

export async function saveTaskBoard(next: { nodes: TaskNode[]; order: string[] }): Promise<void> {
  await mutate(() => {
    const rec: TaskBoard = { id: 1, nodes: next.nodes, order: next.order, updatedAt: Date.now() };
    const idx = store.taskBoard.findIndex(b => b.id === 1);
    if (idx >= 0) store.taskBoard[idx] = rec;
    else store.taskBoard.push(rec);
  });
}

export async function toggleTaskLeaf(key: string): Promise<void> {
  const board = await getTaskBoard();
  const nodes = toggleLeafDone(board.nodes, key);
  await saveTaskBoard({ nodes, order: board.order });
}

/** 搁置 / 撤销搁置：只改标记，链结构原样保留 */
export async function shelveTaskLeaf(key: string, shelved = true): Promise<void> {
  const board = await getTaskBoard();
  const nodes = setLeafShelved(board.nodes, key, shelved);
  await saveTaskBoard({ nodes, order: board.order });
}

export async function removeTaskLeaf(key: string): Promise<void> {
  const board = await getTaskBoard();
  const nodes = removeLeaf(board.nodes, key);
  const order = normalizeOrder(nodes, board.order.filter(k => k !== key));
  await saveTaskBoard({ nodes, order });
}

// ============ 全局内容搜索 ============

/** 只在用户自己录入的内容里搜（不含界面文案与日期），返回带位置与路由的结果 */
export async function searchEverything(query: string, limit = 60): Promise<SearchHit[]> {
  return searchStore(store, query, limit);
}

/** DDL 变更通知（侧栏红点用） */
function notifyDdlChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('dailynote-ddl-changed'));
}

// ============ 重要的事 CRUD ============

function importantTime(x: { deadlineTime: string }): string {
  return x.deadlineTime?.trim() || DDL_DEFAULT_TIME;
}

export async function getAllImportant(): Promise<ImportantItem[]> {
  return deepClone([...store.important].sort((a, b) =>
    a.deadlineDate.localeCompare(b.deadlineDate)
    || importantTime(a).localeCompare(importantTime(b))
    || (a.id ?? 0) - (b.id ?? 0)));
}

export async function saveImportant(item: ImportantItem): Promise<number> {
  item = deepClone(item);
  let resultId = 0;
  await mutate(() => {
    if (item.id != null) {
      const idx = store.important.findIndex(x => x.id === item.id);
      if (idx >= 0) store.important[idx] = { ...item, updatedAt: Date.now() };
      resultId = item.id;
      return;
    }
    resultId = allocId('important');
    store.important.push({ ...item, id: resultId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  notifyImportantChanged();
  return resultId;
}

export async function deleteImportant(id: number): Promise<void> {
  await mutate(() => {
    const item = store.important.find(x => x.id === id);
    if (item) {
      store.trashItems.push({
        id: allocId('trashItems'),
        originalTable: 'important',
        originalId: id,
        originalData: deepClone(item),
        title: `重要 - ${item.name?.slice(0, 30) || '无标题'}`,
        deletedAt: Date.now(),
      });
      store.important = store.important.filter(x => x.id !== id);
    }
    cleanOldTrashSync();
  }, { writeOrder: ['trashItems', 'important'] });
  notifyImportantChanged();
}

function notifyImportantChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('dailynote-important-changed'));
}