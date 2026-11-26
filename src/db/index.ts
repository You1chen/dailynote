/**
 * 内存 CRUD 层
 *
 * 所有读写直接作用于权威内存 store（src/services/store.ts），
 * 每次变更立即写回用户目录文件（file-authoritative）。
 * 保持与旧版完全一致的导出函数签名，页面/Hook 无需改动。
 */

import type {
  KnowledgeMap, KnowledgeNode, KnowledgeStatus, KnowledgeCardLibrary,
 DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TaskItem, TaskTemplate, TrashItem, Course, SemesterRecord, DdlItem, TaskBoard, TaskNode, ImportantItem, LinkGroup } from '../types';
import { normalizeCourseDayOfWeek } from '../types';
import { store, mutate, allocId, deepClone, bindLegacyCourses, type AnyStoreTable } from '../services/store';
import { toggleLeafDone, removeLeaf, setLeafShelved, normalizeExecutionOrder, reorderExecutionLeaves, pruneExpiredTasks, pruneDoneLeaves, isExpiredTask, updateLeaf } from '../utils/taskTree';
import { elapsedTaskMs } from '../utils/taskTiming';
import { searchStore, type SearchHit } from '../utils/search';
import { DDL_DEFAULT_TIME } from '../utils/ddl';
import { isRetiredPrivateGoal, isRetiredTrashItem } from '../utils/retiredRecords';

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
  return deepClone(store.longTermGoals.filter(goal => !isRetiredPrivateGoal(goal)).sort((a, b) => b.createdAt - a.createdAt));
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
  if (isRetiredPrivateGoal(clean)) return { id: clean.id ?? 0, ok: false };
  if (clean.id != null && store.longTermGoals.some(goal => goal.id === clean.id && isRetiredPrivateGoal(goal))) {
    return { id: clean.id, ok: false };
  }
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
    if (goal && !isRetiredPrivateGoal(goal)) {
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
        title: `记事 - ${r.problem?.slice(0, 30) || '无标题'}`,
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

export async function getKnowledgeCardLibrary(): Promise<import('../types/knowledge').KnowledgeCardLibrary | undefined> {
  const library = store.knowledgeCards.find(item => item.id === 1) ?? store.knowledgeCards[0];
  return library ? deepClone(library) : undefined;
}

export async function saveKnowledgeCardLibrary(library: import('../types/knowledge').KnowledgeCardLibrary): Promise<number> {
  const clean = deepClone(library);
  const id = 1;
  await mutate(() => {
    store.knowledgeCards = [{ ...clean, id, updatedAt: Date.now() }];
  });
  return id;
}

export async function saveKnowledgeCardRecords(library: import('../types/knowledge').KnowledgeCardLibrary): Promise<void> {
  await mutate(() => { store.knowledgeCards = [deepClone({ ...library, id: 1, updatedAt: Date.now() })]; });
}

export async function getKnowledgeMap(courseId: number): Promise<KnowledgeMap | undefined> {
  const map = store.knowledgeMaps.find(item => item.courseId === courseId);
  return map ? deepClone(map) : undefined;
}

export async function saveKnowledgeMap(map: KnowledgeMap): Promise<number> {
  const clean = deepClone(map);
  let resultId = 0;
  await mutate(() => {
    const idx = store.knowledgeMaps.findIndex(item => item.courseId === clean.courseId);
    if (idx >= 0) {
      resultId = store.knowledgeMaps[idx].id!;
      store.knowledgeMaps[idx] = { ...clean, id: resultId, updatedAt: Date.now() };
    } else {
      resultId = allocId('knowledgeMaps');
      store.knowledgeMaps.push({ ...clean, id: resultId, createdAt: clean.createdAt || Date.now(), updatedAt: Date.now() });
    }
  });
  return resultId;
}

export async function deleteKnowledgeMap(courseId: number): Promise<void> {
  await mutate(() => { store.knowledgeMaps = store.knowledgeMaps.filter(item => item.courseId !== courseId); });
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
  return deepClone(store.trashItems.filter(item => !isRetiredTrashItem(item)).sort((a, b) => b.deletedAt - a.deletedAt));
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
  linkGroups: 'linkGroups',
  timeBlocks: 'dailyPlans',
};

export async function restoreFromTrash(trashId: number): Promise<boolean> {
  const item = store.trashItems.find(t => t.id === trashId);
  if (!item || isRetiredTrashItem(item)) return false;
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
    store.trashItems = store.trashItems.filter(t => t.id !== trashId || isRetiredTrashItem(t));
  });
}

export async function clearAllTrash(): Promise<void> {
  await mutate(() => { store.trashItems = store.trashItems.filter(isRetiredTrashItem); });
}

/** 清理超过30天的回收站项 */
export async function cleanOldTrash(): Promise<void> {
  await mutate(() => {
    cleanOldTrashSync();
  });
}

function cleanOldTrashSync(): void {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  store.trashItems = store.trashItems.filter(t => t.deletedAt >= cutoff || isRetiredTrashItem(t));
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

// ============ 任务树 CRUD（单记录数组表，id 恒 1） ============

const EMPTY_TASK_BOARD: TaskBoard = { id: 1, nodes: [], order: [], updatedAt: 0 };

export async function getTaskBoard(): Promise<TaskBoard> {
  const board = store.taskBoard.find(b => b.id === 1) ?? EMPTY_TASK_BOARD;
  return deepClone({ ...board, order: normalizeExecutionOrder(board.nodes, board.order ?? []) });
}

async function mutateTaskBoard(update: (board: TaskBoard) => TaskBoard): Promise<void> {
  let previous: TaskBoard | undefined;
  let next: TaskBoard | undefined;
  const ok = await mutate(() => {
    previous = store.taskBoard.find(b => b.id === 1);
    const current = previous ?? EMPTY_TASK_BOARD;
    const updated = update(current);
    if (updated === current) return;

    next = { ...updated, updatedAt: Date.now() };
    if (previous) store.taskBoard[store.taskBoard.indexOf(previous)] = next;
    else store.taskBoard.push(next);
  });
  if (ok) return;

  // mutate applies in memory before persisting. Do not undo a newer write.
  if (next) {
    const index = store.taskBoard.indexOf(next);
    if (index >= 0) {
      if (previous) store.taskBoard[index] = previous;
      else store.taskBoard.splice(index, 1);
    }
  }
  throw new Error('保存任务清单失败');
}

function mergeTaskEdits(current: TaskNode[], edited: TaskNode[], base?: TaskNode[]): TaskNode[] {
  const collect = (nodes: TaskNode[], index = new Map<string, TaskNode>()): Map<string, TaskNode> => {
    for (const node of nodes) {
      index.set(node.id, node);
      collect(node.children, index);
    }
    return index;
  };
  const currentById = collect(current);
  const baseById = base ? collect(base) : currentById;
  const merge = (nodes: TaskNode[]): TaskNode[] => nodes.map(node => {
    const latest = currentById.get(node.id);
    const initial = baseById.get(node.id);
    const children = merge(node.children);
    if (!latest) return { ...node, children };
    return {
      ...node,
      title: initial?.title === node.title ? latest.title : node.title,
      done: latest.done,
      doneAt: latest.doneAt,
      shelved: initial?.shelved === node.shelved ? latest.shelved : node.shelved,
      taskTiming: latest.taskTiming,
      children,
    };
  });
  return merge(edited);
}

export async function saveTaskBoard(next: { nodes: TaskNode[]; order: string[] }): Promise<void> {
  await mutateTaskBoard(board => {
    const nodes = mergeTaskEdits(board.nodes, next.nodes);
    return { ...board, nodes, order: normalizeExecutionOrder(nodes, next.order) };
  });
}

export async function saveTaskTree(nodes: TaskNode[], base?: TaskNode[]): Promise<void> {
  await mutateTaskBoard(board => {
    // Resolve old paths before replacing the tree, so renamed IDs keep their slots.
    const order = normalizeExecutionOrder(board.nodes, board.order ?? []);
    const active = pruneExpiredTasks(mergeTaskEdits(board.nodes, nodes, base));
    return { ...board, nodes: active, order: normalizeExecutionOrder(active, order) };
  });
}

function pruneTaskBoard(board: TaskBoard, shouldRemove: (node: TaskNode) => boolean): TaskBoard {
  const nodes = pruneDoneLeaves(board.nodes, shouldRemove);
  if (nodes === board.nodes) return board;
  const order = normalizeExecutionOrder(board.nodes, board.order ?? []);
  return { ...board, nodes, order: normalizeExecutionOrder(nodes, order) };
}

export async function clearExpiredTaskLeaves(now = Date.now()): Promise<void> {
  await mutateTaskBoard(board => pruneTaskBoard(board, node => isExpiredTask(node, now)));
}

export async function toggleTaskLeaf(key: string): Promise<void> {
  await mutateTaskBoard(board => {
    const now = Date.now();
    const nodes = toggleLeafDone(board.nodes, key, now);
    return nodes === board.nodes ? board : { ...board, nodes };
  });
}

export async function toggleTaskTimer(key: string, now = Date.now()): Promise<void> {
  await mutateTaskBoard(board => {
    const nodes = updateLeaf(board.nodes, key, node => {
      if (node.done) return node;
      const elapsedMs = elapsedTaskMs(node.taskTiming, now);
      const taskTiming = node.taskTiming?.startedAt !== undefined ? { elapsedMs } : { elapsedMs, startedAt: now };
      return { ...node, taskTiming };
    });
    return nodes === board.nodes ? board : { ...board, nodes };
  });
}

/** 搁置 / 撤销搁置：只改标记，链结构原样保留 */
export async function shelveTaskLeaf(key: string, shelved = true): Promise<void> {
  await mutateTaskBoard(board => {
    const nodes = setLeafShelved(board.nodes, key, shelved);
    return nodes === board.nodes ? board : { ...board, nodes };
  });
}

export async function removeTaskLeaf(key: string): Promise<void> {
  await mutateTaskBoard(board => {
    const nodes = removeLeaf(board.nodes, key);
    const order = normalizeExecutionOrder(board.nodes, board.order ?? []);
    return nodes === board.nodes ? board : { ...board, nodes, order: normalizeExecutionOrder(nodes, order) };
  });
}

/** Reorder the current board without replacing any node or its metadata. */
export async function reorderTaskLeaves(fromKey: string, toKey: string): Promise<void> {
  await mutateTaskBoard(board => {
    const currentOrder = board.order ?? [];
    const order = reorderExecutionLeaves(board.nodes, currentOrder, fromKey, toKey);
    return order === currentOrder ? board : { ...board, order };
  });
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