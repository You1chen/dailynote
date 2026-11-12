/**
 * 权威存储（file-authoritative）
 *
 * 架构：用户目录中的 JSON 文件（或 Web 端 IndexedDB KV）= 唯一数据源
 *       └── 内存 store = 文件的实时投影，每次变更立即写回
 *
 * 存储布局（分门别类，不再是一个大文件）：
 *   <dir>/
 *     days/<date>/plan.json          当天计划（含时间块）
 *     days/<date>/reflections.json   当天反思
 *     days/<date>/harvests.json      当天收获
 *     days/<date>/tasks.json         当天任务清单
 *     goals.json                     长期目标
 *     routines.json                  固定作息模板
 *     trash.json                     回收站
 *     templates.json                 任务清单模板
 *     courses.json                   课程表课程
 *     semester.json                  学期设置（单记录数组，id 恒 1）
 *     ddls.json                      DDL 截止清单
 *     important.json                 重要的事
 *     backlog.json                   遗留问题（backlog）
 *     taskboard.json                 任务树（单记录，id 恒 1）
 *
 * 写盘策略：
 *   - mutate() 先对每张表做指纹快照，变更后对比，只写"变脏"的文件
 *   - 跨文件操作（删除/还原）通过 writeOrder 控制写序：先写"新增"侧、再写"移除"侧，
 *     崩溃中断不会丢数据（加载时自愈：回收站条目若原表已存在则丢弃其副本）
 *   - 启动时若发现旧版单文件 dailynote-data.json → 迁移到新布局并删除旧文件（提交标记）
 */

import type { DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TaskItem, TaskTemplate, TrashItem, Course, SemesterRecord, DdlItem, BacklogItem, TaskBoard, ImportantItem, LinkGroup, Idea } from '../types';
import { normalizeCourseDayOfWeek } from '../types';
import { loadCourseTimeCombinations, saveCourseTimeCombinations } from '../utils/courseTimeCombinations';
import type { AnyStoreTable, StorageData, StoreShape } from '../types/storage';
import { CATEGORY_FILES, CATEGORY_NAMES, CATEGORY_TABLES, DEFAULT_WRITE_ORDER, NUMERIC_TABLES, emptyStore } from './storeSchema';
export type { AnyStoreTable, StorageData, StoreShape } from '../types/storage';
import { readLegacyTables, deleteLegacyDB } from '../db/legacy';
import { registerPlugin } from '@capacitor/core';
import { readSnapshot, writeSnapshot, clearSnapshot, sameNames } from './snapshot';
import type { ActivityEvent, ActivityOptions } from '../types/settlement';
import type { KnowledgeMap } from '../types/knowledge';
import { detectActivity, recoverTimestampedActivity } from '../utils/settlement';

// ============ 布局常量 ============

/**
 * 旧版单文件（迁移前）；仍是导入/导出的备份包格式，但不再是运行期存储。
 * Web 端旧版 KV 键是 dailynote-data（无扩展名），原生端旧文件是 dailynote-data.json。
 */
export const OLD_SINGLE_REL = 'dailynote-data.json';
function oldSingleRel(): string {
  return isCapacitor() ? 'dailynote-data.json' : 'dailynote-data';
}
const DAY_DIR = 'days';
const DAY_TYPES = ['reflections', 'harvests', 'tasks', 'activity'] as const;
function dayPlan(date: string): string {
  return `${DAY_DIR}/${date}/plan.json`;
}
function dayTypeFile(date: string, type: 'reflections' | 'harvests' | 'tasks' | 'activity'): string {
  return `${DAY_DIR}/${date}/${type}.json`;
}

const KV_DB = 'dailynote_kv';
const KV_STORE = 'kv';

type NumericTable = import('./storeSchema').NumericTable;

// ============ 内存 store ============

const store: StoreShape = emptyStore();

/**
 * 每表单调递增 id 计数器（不复用，杜绝与回收站还原撞 id）。
 * initStore / 导入 / 迁移后需调用 resetNextId() 重建。
 */
const nextId = Object.fromEntries(NUMERIC_TABLES.map(table => [table, 1])) as Record<NumericTable, number>;

export function allocId(table: NumericTable): number {
  return nextId[table]++;
}

function resetNextId(): void {
  const tables: NumericTable[] = NUMERIC_TABLES;
  for (const t of tables) {
    let max = 0;
    for (const rec of store[t] as { id?: number }[]) {
      if (typeof rec.id === 'number' && rec.id > max) max = rec.id;
    }
    // 回收站中的数字主键仍被占用，重启后不能分配给新记录。
    for (const item of store.trashItems) {
      if (item.originalTable === t && typeof item.originalId === 'number' && Number.isSafeInteger(item.originalId)) {
        max = Math.max(max, item.originalId);
      }
    }
    nextId[t] = Math.max(nextId[t], max + 1);
  }
}

/** 旧课程仅补一次归属；切换学期前调用可保留历史学期。 */
export function bindLegacyCourses(startDate: string | null | undefined): boolean {
  if (!startDate) return false;
  let changed = false;
  const bind = (course: Course) => {
    if (course.semesterStartDate === undefined) {
      course.semesterStartDate = startDate;
      changed = true;
    }
  };
  store.courses.forEach(bind);
  for (const item of store.trashItems) {
    if (item.originalTable === 'courses' && item.originalData) bind(item.originalData);
  }
  return changed;
}

function clearStore(): void {
  Object.assign(store, emptyStore());
}

function countData(): number {
  // 交互记录只服务于结算，不计入「恢复了多少条记录」的用户可见统计。
  return Object.entries(store).reduce(
    (total, [table, rows]) => total + (table === 'activityEvents' ? 0 : rows.length),
    0,
  );
}

// ============ 路径管理 ============

export function getStoragePath(): string {
  return localStorage.getItem('dailynote_storage_path') || 'Documents/DailyNote';
}

export function setStoragePath(path: string): void {
  localStorage.setItem('dailynote_storage_path', path);
}

/** 规范化用户输入：接受 "MyNotes" 或 "Documents/MyNotes"，统一存为 "Documents/MyNotes" */
export function normalizePath(input: string): string {
  let p = (input ?? '').trim().replace(/[\\/]+/g, '/');
  p = p.replace(/^Documents\//i, '');
  p = p.replace(/^\/+|\/+$/g, '');
  if (!p) throw new Error('路径不能为空');
  if (p === '.' || p.includes('..')) throw new Error('路径不能包含 ".."');
  if (/^[A-Za-z]:/.test(p)) throw new Error('路径不能是绝对路径');
  if (/[<>:"|?*]/.test(p)) throw new Error('路径包含非法字符');
  return `Documents/${p}`;
}

/** 展示路径（统一补全 Documents/ 前缀，仅影响显示） */
export function getDisplayPath(): string {
  const dir = getStoragePath();
  const shown = /^Documents[\/\\]/.test(dir) ? dir : `Documents/${dir}`;
  return `${shown}/`;
}

// ============ 环境检测 ============

/**
 * 是否运行在原生平台（Android/iOS）。
 *
 * 注意：不能仅凭 `window.Capacitor` 是否存在判断——Web 端静态引入
 * `@capacitor/app`（BackButtonContext / main.tsx）就会让 @capacitor/core
 * 把该全局对象挂到浏览器 window 上。必须看平台：isNativePlatform() 在
 * Web 上返回 false，只有原生 WebView（有原生桥）才返回 true。
 */
export function isCapacitor(): boolean {
  try {
    const cap = (window as any).Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function') {
      return !!cap.isNativePlatform();
    }
    // 兜底：运行时未提供 isNativePlatform 时，直接看原生桥是否存在
    return !!(window as any).androidBridge || !!((window as any).webkit?.messageHandlers?.bridge);
  } catch {
    return false;
  }
}

// ============ 原生存储权限（Android 11+ 所有文件访问） ============

export interface NativeStorageStatus {
  apiLevel: number;
  manager: boolean;
}

interface DailyNoteStorageNative {
  getStorageStatus(): Promise<NativeStorageStatus>;
  requestAllFilesAccess(): Promise<{ granted: boolean }>;
}

const NativeStorage = registerPlugin<DailyNoteStorageNative>('DailyNoteStorage');

/** 原生端存储访问状态（Web 端 / 插件缺失时视为可访问） */
export async function storageAccessStatus(): Promise<NativeStorageStatus> {
  if (!isCapacitor()) return { apiLevel: 0, manager: true };
  try {
    return await NativeStorage.getStorageStatus();
  } catch {
    return { apiLevel: 0, manager: true };
  }
}

/**
 * Android 11+ 且未授予「所有文件访问」时，公共 Documents 的读写必然被系统拒绝。
 * 此时禁止读后端（否则误判为空数据）也禁止写（否则空数组覆盖磁盘数据）。
 */
export async function storageAccessBlocked(): Promise<boolean> {
  const st = await storageAccessStatus();
  return st.apiLevel >= 30 && !st.manager;
}

/** 跳转系统设置请求「所有文件访问」。通常返回 false（用户去设置页返回后需重新检测） */
export async function requestAllFilesAccess(): Promise<boolean> {
  if (!isCapacitor()) return true;
  try {
    const r = await NativeStorage.requestAllFilesAccess();
    return !!r.granted;
  } catch {
    return true;
  }
}

// ============ Web 端 IndexedDB KV 后端（key = 相对路径） ============

let kvDbPromise: Promise<IDBDatabase> | null = null;

function idbOpen(): Promise<IDBDatabase> {
  if (kvDbPromise) return kvDbPromise;
  kvDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(KV_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KV_STORE)) {
        req.result.createObjectStore(KV_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return kvDbPromise;
}

async function idbKvPut(key: string, value: string): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbKvGet(key: string): Promise<string | null> {
  try {
    const db = await idbOpen();
    const value = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(KV_STORE, 'readonly');
      const req = tx.objectStore(KV_STORE).get(key);
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => reject(req.error);
    });
    return value ?? null;
  } catch {
    return null;
  }
}

async function idbKvDelete(key: string): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KV_STORE, 'readwrite');
      tx.objectStore(KV_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 键不存在，忽略 */
  }
}

async function idbKvKeys(): Promise<string[]> {
  try {
    const db = await idbOpen();
    const value = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(KV_STORE, 'readonly');
      const req = tx.objectStore(KV_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return value.map(String);
  } catch {
    return [];
  }
}

// ============ 后端读写原语（dir = 用户目录，rel = 相对该目录） ============

function nativePath(dir: string, rel: string): string {
  const sub = dir.replace(/^Documents[\/\\]/, '');
  return sub ? `${sub}/${rel}` : `DailyNote/${rel}`;
}

async function writeFile(dir: string, rel: string, json: string): Promise<boolean> {
  try {
    if (isCapacitor()) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      // 必须显式传 encoding：Capacitor 8 的 ionfilesystem 在缺省时把 data 当 base64 解码
      //（substringAfter(",") 后宽容解码），会把 JSON 文本写成乱码二进制
      await Filesystem.writeFile({ path: nativePath(dir, rel), data: json, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    } else {
      await idbKvPut(rel, json);
    }
    return true;
  } catch (e) {
    console.error('写入存储失败:', e);
    return false;
  }
}

async function readFile(dir: string, rel: string): Promise<string | null> {
  try {
    if (isCapacitor()) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const result = await Filesystem.readFile({
        path: nativePath(dir, rel),
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      return result.data as string;
    }
    return await idbKvGet(rel);
  } catch {
    return null;
  }
}

async function deleteFile(dir: string, rel: string): Promise<void> {
  try {
    if (isCapacitor()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({ path: nativePath(dir, rel), directory: Directory.Documents });
    } else {
      await idbKvDelete(rel);
    }
  } catch {
    /* 文件可能不存在，忽略 */
  }
}

/** 列出 days/ 下的日期子目录 */
async function listDayDates(dir: string): Promise<string[]> {
  try {
    if (isCapacitor()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const result = await Filesystem.readdir({ path: nativePath(dir, DAY_DIR), directory: Directory.Documents });
      return result.files.map(f => f.name).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n));
    }
    const keys = await idbKvKeys();
    const dates = new Set<string>();
    for (const k of keys) {
      const parts = k.split('/');
      if (parts[0] === DAY_DIR && parts[1]) dates.add(parts[1]);
    }
    return [...dates];
  } catch {
    return [];
  }
}

/** 枚举应用拥有的日期数据文件；日期目录以外的文件永不参与清理。 */
async function listManagedDayFiles(dir: string): Promise<string[]> {
  const managed = /^days\/\d{4}-\d{2}-\d{2}\/(plan|reflections|harvests|tasks|activity)\.json$/;
  if (!isCapacitor()) return (await idbKvKeys()).filter(key => managed.test(key));
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const files: string[] = [];
  for (const date of await listDayDates(dir)) {
    const result = await Filesystem.readdir({ path: nativePath(dir, `${DAY_DIR}/${date}`), directory: Directory.Documents });
    for (const entry of result.files) {
      const rel = `${DAY_DIR}/${date}/${entry.name}`;
      if (entry.type === 'file' && managed.test(rel)) files.push(rel);
    }
  }
  return files;
}

// ============ 解析 ============

function parseStorageData(text: string): StorageData | null {
  try {
    const data = JSON.parse(text);
    if (!data || data.version !== 1 || !Array.isArray(data.dailyPlans)) return null;
    return {
      version: 1,
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
      dailyPlans: data.dailyPlans,
      longTermGoals: Array.isArray(data.longTermGoals) ? data.longTermGoals : [],
      reflections: Array.isArray(data.reflections) ? data.reflections : [],
      harvests: Array.isArray(data.harvests) ? data.harvests : [],
      fixedRoutines: Array.isArray(data.fixedRoutines) ? data.fixedRoutines : [],
      taskItems: Array.isArray(data.taskItems) ? data.taskItems : [],
      taskTemplates: Array.isArray(data.taskTemplates) ? data.taskTemplates : [],
      trashItems: Array.isArray(data.trashItems) ? data.trashItems : [],
      courses: Array.isArray(data.courses) ? data.courses.map(normalizeCourseDayOfWeek) : [],
      semester: Array.isArray(data.semester) ? data.semester : [],
      ddls: Array.isArray(data.ddls) ? data.ddls : [],
      important: Array.isArray(data.important) ? data.important : [],
      backlog: Array.isArray(data.backlog) ? data.backlog : [],
       ideas: Array.isArray(data.ideas) ? data.ideas : [],
      taskBoard: Array.isArray(data.taskBoard) ? data.taskBoard : [],
      linkGroups: Array.isArray(data.linkGroups) ? data.linkGroups : [],
      activityEvents: Array.isArray(data.activityEvents) ? data.activityEvents : [],
      gardenKeys: Array.isArray(data.gardenKeys) ? data.gardenKeys : [],
      knowledgeMaps: Array.isArray(data.knowledgeMaps) ? data.knowledgeMaps : [],
    };
  } catch {
    return null;
  }
}

function hasAny(d: StorageData): boolean {
  return DEFAULT_WRITE_ORDER.some(table => d[table].length > 0);
}

async function readDayArray<T>(dir: string, rel: string): Promise<T[]> {
  const text = await readFile(dir, rel);
  if (text == null) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    console.warn('数据文件损坏，按空处理:', rel);
    return [];
  }
}

async function readCategory<T>(dir: string, rel: string): Promise<T[] | null> {
  const text = await readFile(dir, rel);
  if (text == null) return null;
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    console.warn('数据文件损坏，按空处理:', rel);
    return [];
  }
}

/** 读取新布局（days/ 目录 + 三个分类文件） */
async function readNewStructure(dir: string): Promise<StorageData | null> {
  const dates = await listDayDates(dir);
  const dailyPlans: DailyPlan[] = [];
  const reflections: Reflection[] = [];
  const harvests: Harvest[] = [];
  const taskItems: TaskItem[] = [];
  const activityEvents: ActivityEvent[] = [];
  for (const date of dates) {
    const planText = await readFile(dir, dayPlan(date));
    if (planText != null) {
      try {
        const p = JSON.parse(planText);
        if (p && p.date === date) dailyPlans.push(p);
      } catch {
        console.warn('计划文件损坏，跳过:', dayPlan(date));
      }
    }
    reflections.push(...(await readDayArray<Reflection>(dir, dayTypeFile(date, 'reflections'))));
    harvests.push(...(await readDayArray<Harvest>(dir, dayTypeFile(date, 'harvests'))));
    taskItems.push(...(await readDayArray<TaskItem>(dir, dayTypeFile(date, 'tasks'))));
    activityEvents.push(...(await readDayArray<ActivityEvent>(dir, dayTypeFile(date, 'activity'))));
  }
  const longTermGoals = await readCategory<LongTermGoal>(dir, CATEGORY_FILES.longTermGoals);
  const fixedRoutines = await readCategory<FixedRoutine>(dir, CATEGORY_FILES.fixedRoutines);
  const trashItems = await readCategory<TrashItem>(dir, CATEGORY_FILES.trashItems);
  const taskTemplates = await readCategory<TaskTemplate>(dir, CATEGORY_FILES.taskTemplates);
  const courses = await readCategory<Course>(dir, CATEGORY_FILES.courses);
  const semester = await readCategory<SemesterRecord>(dir, CATEGORY_FILES.semester);
  const ddls = await readCategory<DdlItem>(dir, CATEGORY_FILES.ddls);
  const important = await readCategory<ImportantItem>(dir, CATEGORY_FILES.important);
  const backlog = await readCategory<BacklogItem>(dir, CATEGORY_FILES.backlog);
   const ideas = await readCategory<Idea>(dir, CATEGORY_FILES.ideas);
  const taskBoard = await readCategory<TaskBoard>(dir, CATEGORY_FILES.taskBoard);
  const linkGroups = await readCategory<LinkGroup>(dir, CATEGORY_FILES.linkGroups);
  const knowledgeMaps = await readCategory<KnowledgeMap>(dir, CATEGORY_FILES.knowledgeMaps);
  if (dates.length === 0 && !longTermGoals && !fixedRoutines && !trashItems && !taskTemplates && !courses && !semester && !ddls && !important && !backlog && !ideas && !taskBoard && !linkGroups && !knowledgeMaps) return null;
  return {
    version: 1,
    savedAt: 0,
    dailyPlans,
    longTermGoals: longTermGoals ?? [],
    reflections,
    harvests,
    fixedRoutines: fixedRoutines ?? [],
    taskItems,
    taskTemplates: taskTemplates ?? [],
    trashItems: trashItems ?? [],
    courses: (courses ?? []).map(normalizeCourseDayOfWeek),
    semester: semester ?? [],
    ddls: ddls ?? [],
    important: important ?? [],
    backlog: backlog ?? [],
     ideas: ideas ?? [],
    taskBoard: taskBoard ?? [],
    linkGroups: linkGroups ?? [],
    activityEvents,
    gardenKeys: (await readCategory<any>(dir, CATEGORY_FILES.gardenKeys)) ?? [],
    knowledgeMaps: knowledgeMaps ?? [],
  };
}

/** 旧版单文件（迁移用）。返回 'CORRUPT' 表示文件存在但解析失败 */
async function readOldSingleFile(dir: string): Promise<StorageData | 'CORRUPT' | null> {
  const text = await readFile(dir, oldSingleRel());
  if (text == null) return null;
  const data = parseStorageData(text);
  return data ?? 'CORRUPT';
}

/** 只列出「有哪些文件」（不读内容），用于判断能否复用快照 */
async function listBackendNames(dir: string): Promise<{ dates: string[]; files: string[] }> {
  if (isCapacitor()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    let dates: string[] = [];
    try {
      const res = await Filesystem.readdir({ path: nativePath(dir, DAY_DIR), directory: Directory.Documents });
      dates = res.files.map(f => f.name).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n));
    } catch {
      dates = [];
    }
    let files: string[] = [];
    try {
      const sub = dir.replace(/^Documents[\/\\]/, '');
      const res = await Filesystem.readdir({ path: sub || '', directory: Directory.Documents });
      files = res.files.filter(f => f.type === 'file' && f.name.endsWith('.json')).map(f => f.name);
    } catch {
      files = [];
    }
    return { dates, files };
  }

  const keys = await idbKvKeys();
  const dates = new Set<string>();
  const files = new Set<string>();
  for (const k of keys) {
    const parts = k.split('/');
    if (parts[0] === DAY_DIR && parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) dates.add(parts[1]);
    else if (parts.length === 1 && k.endsWith('.json')) files.add(k);
  }
  return { dates: [...dates], files: [...files] };
}


/** 由内存数据推算目录结构（写快照用，不访问磁盘） */
function currentNames(): { dates: string[]; files: string[] } {
  const dates = new Set<string>();
  for (const p of store.dailyPlans) dates.add(p.date);
  for (const r of store.reflections) dates.add(r.date);
  for (const h of store.harvests) dates.add(h.date);
  for (const t of store.taskItems) dates.add(t.date);
  for (const e of store.activityEvents) dates.add(e.date);
  return { dates: [...dates], files: CATEGORY_NAMES };
}

/** 由读到的数据推算目录结构（首次写快照用） */
function namesFromData(data: StorageData): { dates: string[]; files: string[] } {
  const dates = new Set<string>();
  for (const p of data.dailyPlans) dates.add(p.date);
  for (const r of data.reflections) dates.add(r.date);
  for (const h of data.harvests) dates.add(h.date);
  for (const t of data.taskItems) dates.add(t.date);
  for (const e of data.activityEvents ?? []) dates.add(e.date);
  return { dates: [...dates], files: CATEGORY_NAMES };
}

/** 落一份快照（失败不影响主流程） */
function pendingGardenEncryption(): boolean {
  return store.longTermGoals.some(g => g.kind === 'wish' && !g.encrypted) || store.trashItems.some(t => t.originalTable === 'longTermGoals' && t.originalData?.kind === 'wish' && !t.originalData?.encrypted) || store.activityEvents.some(e => e.category === 'wish-milestone' && !e.encrypted);
}
function saveSnapshot(): Promise<void> {
  if (pendingGardenEncryption()) return clearSnapshot();
  const { dates, files } = currentNames();
  return writeSnapshot({ root: getStoragePath(), dates, files, savedAt: Date.now(), data: snapshot() });
}

/** 快照防抖：连续写操作只落一次 */
let snapTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnapshot(): void {
  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    snapTimer = null;
    saveSnapshot();
  }, 400);
}

/** 立即落快照（flush / 切后台时用） */
async function flushSnapshot(): Promise<void> {
  if (pendingGardenEncryption()) { await clearSnapshot(); return; }
  if (snapTimer) {
    clearTimeout(snapTimer);
    snapTimer = null;
  }
  const { dates, files } = currentNames();
  await writeSnapshot({ root: getStoragePath(), dates, files, savedAt: Date.now(), data: snapshot() });
}

/** 读取当前路径的后端数据（新布局优先；旧单文件存在则视为迁移未完成，优先取它） */
async function readBackend(): Promise<{ data: StorageData | null; oldFormat: boolean }> {
  const dir = getStoragePath();

  // 旧单文件仍在 → 走迁移路径（本来就要读它）
  const old = await readOldSingleFile(dir);
  if (old === 'CORRUPT') console.warn('旧版数据文件损坏，尝试读取新布局:', dir);
  if (old && old !== 'CORRUPT') return { data: old, oldFormat: true };

  // 快照命中：日期目录没变就直接用，不再逐文件读取
  // （只比日期集合：分类文件由本应用自己维护，外部改动靠「重新扫描」）
  if (!old) {
    const names = await listBackendNames(dir);
    const snap = await readSnapshot(dir);
    if (snap && sameNames(snap.dates, names.dates) && sameNames(snap.files, names.files)) {
      return { data: snap.data, oldFormat: false };
    }
  }

  const data = await readNewStructure(dir);
  if (data && !data.longTermGoals.some(g => g.kind === 'wish' && !g.encrypted) && !data.trashItems.some(t => t.originalTable === 'longTermGoals' && t.originalData?.kind === 'wish' && !t.originalData?.encrypted) && !data.activityEvents.some(e => e.category === 'wish-milestone' && !e.encrypted)) {
    const names = await listBackendNames(dir);
    const { dates, files } = namesFromData(data);
    await writeSnapshot({
      root: dir,
      dates: names.dates.length ? names.dates : dates,
      files: names.files.length ? names.files : files,
      savedAt: Date.now(),
      data,
    });
  }
  return { data, oldFormat: false };
}

/** 探测指定路径的数据（不切换当前路径） */
async function readBackendAt(path: string): Promise<StorageData | 'CORRUPT' | null> {
  const old = await readOldSingleFile(path);
  if (old === 'CORRUPT') return 'CORRUPT';
  if (old) return old;
  return await readNewStructure(path);
}

// ============ 持久化队列（增量写 + 快照捕获） ============

let persistQueue: Promise<unknown> = Promise.resolve();
let lastPersistError: string | null = null;

interface FileWrite {
  relPath: string;
  json: string;
  table: AnyStoreTable;
}


function snapshot(): StorageData {
  return deepClone({ ...store, version: 1, savedAt: Date.now() });
}

/**
 * 入队写任务：入队时刻同步捕获 { dir, 待写文件列表 } 快照，promise 链串行执行。
 * 写入失败记 lastPersistError，绝不 throw。
 */
function enqueue(build: () => { writes: FileWrite[]; deletes: string[] }, cleanOrphans = false): Promise<boolean> {
  const dir = getStoragePath();
  const { writes, deletes } = build();
  const job = persistQueue.then(async () => {
    // 只清理由应用管理的日期 JSON，不碰备份、自定义文件或其他目录。
    if (cleanOrphans) {
      const wanted = new Set(writes.map(w => w.relPath));
      for (const rel of await listManagedDayFiles(dir)) {
        if (!wanted.has(rel)) deletes.push(rel);
      }
    }
    for (const w of writes) {
      if (!(await writeFile(dir, w.relPath, w.json))) {
        lastPersistError = `写入失败: ${dir}/${w.relPath}`;
        return false;
      }
    }
    for (const rel of deletes) {
      await deleteFile(dir, rel);
    }
    return true;
  });
  const settled = job.catch(error => {
    lastPersistError = `存储失败: ${dir} (${String(error)})`;
    return false;
  });
  persistQueue = settled;
  return settled;
}

function groupByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const arr = m.get(it.date) ?? [];
    arr.push(it);
    m.set(it.date, arr);
  }
  return m;
}

/** 全量写：把当前内存状态分布写入所有文件 */
function buildWriteSetFromStore(): { writes: FileWrite[]; deletes: string[] } {
  const writes: FileWrite[] = [];
  for (const p of store.dailyPlans) {
    writes.push({ relPath: dayPlan(p.date), json: JSON.stringify(p, null, 2), table: 'dailyPlans' });
  }
  const dayMaps: [typeof DAY_TYPES[number], AnyStoreTable][] = [
    ['reflections', 'reflections'],
    ['harvests', 'harvests'],
    ['tasks', 'taskItems'],
    ['activity', 'activityEvents'],
  ];
  for (const [type, table] of dayMaps) {
    for (const [date, items] of groupByDate(store[table] as unknown as { date: string }[])) {
      writes.push({ relPath: dayTypeFile(date, type), json: JSON.stringify(items, null, 2), table });
    }
  }
  for (const { table, file } of CATEGORY_TABLES) {
    writes.push({ relPath: file, json: JSON.stringify(store[table], null, 2), table });
  }
  writes.sort((a, b) => Number(b.table === 'gardenKeys') - Number(a.table === 'gardenKeys'));
  return { writes, deletes: [] };
}

// ---- 脏检测：指纹 = 每张表的序列化（日期表按日期分桶） ----

interface Fp {
  planDates: Map<string, string>;
  dayDates: Record<'reflections' | 'harvests' | 'tasks' | 'activity', Map<string, string>>;
  longTermGoals: string;
  fixedRoutines: string;
  taskTemplates: string;
  courses: string;
  semester: string;
  ddls: string;
  important: string;
  backlog: string;
   ideas: string;
  taskBoard: string;
  linkGroups: string;
  trashItems: string;
  gardenKeys: string;
  knowledgeMaps: string;
}

function fingerprint(): Fp {
  const planDates = new Map<string, string>();
  for (const p of store.dailyPlans) planDates.set(p.date, JSON.stringify(p));
  const mk = (arr: { date: string }[]): Map<string, string> => {
    const m = new Map<string, string>();
    for (const it of arr) {
      const key = it.date;
      m.set(key, (m.get(key) ?? '') + JSON.stringify(it));
    }
    return m;
  };
  return {
    planDates,
    dayDates: {
      reflections: mk(store.reflections),
      harvests: mk(store.harvests),
      tasks: mk(store.taskItems),
      activity: mk(store.activityEvents),
    },
    longTermGoals: JSON.stringify(store.longTermGoals),
    fixedRoutines: JSON.stringify(store.fixedRoutines),
    taskTemplates: JSON.stringify(store.taskTemplates),
    courses: JSON.stringify(store.courses),
    semester: JSON.stringify(store.semester),
    ddls: JSON.stringify(store.ddls),
    important: JSON.stringify(store.important),
    backlog: JSON.stringify(store.backlog),
     ideas: JSON.stringify(store.ideas),
    taskBoard: JSON.stringify(store.taskBoard),
    linkGroups: JSON.stringify(store.linkGroups),
    trashItems: JSON.stringify(store.trashItems),
    gardenKeys: JSON.stringify(store.gardenKeys),
    knowledgeMaps: JSON.stringify(store.knowledgeMaps),
  };
}

function changedKeys(a: Map<string, string>, b: Map<string, string>): string[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out: string[] = [];
  for (const k of keys) if (a.get(k) !== b.get(k)) out.push(k);
  return out;
}

/** 增量写：对比前后指纹，只写"变脏"的文件；日期桶变空则删除对应文件 */
function buildWriteSetDirty(a: Fp, b: Fp, order?: AnyStoreTable[]): { writes: FileWrite[]; deletes: string[] } {
  const writes: FileWrite[] = [];
  const deletes: string[] = [];

  for (const date of changedKeys(a.planDates, b.planDates)) {
    const p = store.dailyPlans.find(x => x.date === date);
    if (p) writes.push({ relPath: dayPlan(date), json: JSON.stringify(p, null, 2), table: 'dailyPlans' });
    else deletes.push(dayPlan(date));
  }

  const dayMaps: [typeof DAY_TYPES[number], AnyStoreTable][] = [
    ['reflections', 'reflections'],
    ['harvests', 'harvests'],
    ['tasks', 'taskItems'],
    ['activity', 'activityEvents'],
  ];
  for (const [type, table] of dayMaps) {
    for (const date of changedKeys(a.dayDates[type], b.dayDates[type])) {
      const items = (store[table] as unknown as { date: string }[]).filter(x => x.date === date);
      const rel = dayTypeFile(date, type);
      if (items.length) writes.push({ relPath: rel, json: JSON.stringify(items, null, 2), table });
      else deletes.push(rel);
    }
  }

  for (const { table, file } of CATEGORY_TABLES) {
    if (a[table] !== b[table]) {
      writes.push({ relPath: file, json: JSON.stringify(store[table], null, 2), table });
    }
  }

  // writeOrder：跨文件操作控制写序（先写"新增"侧，再写"移除"侧）
  const orderIndex = new Map<string, number>();
  (order ?? DEFAULT_WRITE_ORDER).forEach((t, i) => orderIndex.set(t, i));
  writes.sort((x, y) => Number(y.table === 'gardenKeys') - Number(x.table === 'gardenKeys') || (orderIndex.get(x.table) ?? 999) - (orderIndex.get(y.table) ?? 999));

  return { writes, deletes };
}

export function persist(): Promise<boolean> {
  return enqueue(() => buildWriteSetFromStore(), true).then(ok => {
    if (ok) scheduleSnapshot();
    return ok;
  });
}

export async function flush(): Promise<void> {
  await persistQueue;
  await flushSnapshot();
}

export function getLastPersistError(): string | null {
  return lastPersistError;
}

/**
 * 同步改 store → 增量持久化（只写被改到的文件）。
 * opts.writeOrder：本操作涉及多文件时指定写序，先写"新增"侧再写"移除"侧。
 */
export async function mutate(fn: () => void, opts?: ActivityOptions & { writeOrder?: AnyStoreTable[] }): Promise<boolean> {
  const before = fingerprint();
  const activityBefore = opts?.skipActivity ? null : deepClone(store);
  fn();
  const events = activityBefore ? detectActivity(activityBefore, store, opts) : [];
  store.activityEvents.push(...events);
  const after = fingerprint();
  const ok = await enqueue(() => buildWriteSetDirty(before, after, opts?.writeOrder));
  if (ok) {
    scheduleSnapshot();
    // 有新交互记录才通知；测试桩等无 dispatchEvent 的环境静默跳过
    if (events.length && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('dailynote-activity-changed'));
    }
  }
  return ok;
}

// ============ 合并逻辑 ============

function recTime(r: any): number {
  const u = typeof r?.updatedAt === 'number' ? r.updatedAt : 0;
  const c = typeof r?.createdAt === 'number' ? r.createdAt : 0;
  const d = typeof r?.deletedAt === 'number' ? r.deletedAt : 0;
  return Math.max(u, c, d);
}

function deepClone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

/** 导入合并：导入数据优先（存在则更新，不存在则新增）。保留导入文件的时间戳。 */
function mergeIntoStore(data: StorageData): number {
  let count = 0;

  // dailyPlans：按 date 匹配
  for (const p of data.dailyPlans) {
    const idx = store.dailyPlans.findIndex(x => x.date === p.date);
    if (idx >= 0) {
      store.dailyPlans[idx] = { ...p, id: store.dailyPlans[idx].id };
    } else {
      store.dailyPlans.push({ ...p, id: allocId('dailyPlans') });
    }
    count++;
  }

  // 按 id 匹配的表
  const tables: { key: AnyStoreTable; items: any[]; numeric: boolean }[] = [
    { key: 'longTermGoals', items: data.longTermGoals, numeric: true },
    { key: 'reflections', items: data.reflections, numeric: true },
    { key: 'harvests', items: data.harvests, numeric: true },
    { key: 'fixedRoutines', items: data.fixedRoutines, numeric: true },
    { key: 'taskItems', items: data.taskItems, numeric: false },
    { key: 'taskTemplates', items: data.taskTemplates, numeric: true },
    { key: 'courses', items: data.courses, numeric: true },
    { key: 'semester', items: data.semester, numeric: true },
    { key: 'ddls', items: data.ddls, numeric: true },
    { key: 'important', items: data.important, numeric: true },
    { key: 'backlog', items: data.backlog, numeric: true },
     { key: 'ideas', items: data.ideas, numeric: true },
    { key: 'taskBoard', items: data.taskBoard, numeric: true },
    { key: 'linkGroups', items: data.linkGroups, numeric: true },
    { key: 'trashItems', items: data.trashItems, numeric: true },
    { key: 'knowledgeMaps', items: data.knowledgeMaps, numeric: true },
  ];
  for (const { key, items, numeric } of tables) {
    for (const rec of items) {
      if (rec?.id == null) continue;
      const arr = store[key] as any[];
      const idx = arr.findIndex(x => x.id === rec.id);
      if (idx >= 0) {
        arr[idx] = rec;
      } else {
        arr.push({ ...rec, id: numeric ? allocId(key as NumericTable) : rec.id });
      }
      count++;
    }
  }

  for (const envelope of data.gardenKeys) {
    const existing = store.gardenKeys.find(k => k.keyId === envelope.keyId);
    if (!existing) store.gardenKeys.push(envelope);
    else if ((envelope.updatedAt ?? 0) > (existing.updatedAt ?? 0)) Object.assign(existing, envelope, { id: existing.id });
    count++;
  }

  // Immutable event IDs survive backup roundtrips; importing twice cannot duplicate history.
  const eventIds = new Set(store.activityEvents.map(e => e.id));
  for (const event of data.activityEvents) if (!eventIds.has(event.id)) {
    store.activityEvents.push(event);
    eventIds.add(event.id);
  }
  return count;
}

/** 迁移合并：文件与旧 Dexie 表取"更新者胜"并集，避免旧文件丢防抖窗口内写入 */
function mergeLegacy(legacy: Partial<StoreShape>): void {
  // dailyPlans 按 date
  for (const p of legacy.dailyPlans ?? []) {
    const idx = store.dailyPlans.findIndex(x => x.date === p.date);
    if (idx >= 0) {
      if (recTime(p) > recTime(store.dailyPlans[idx])) store.dailyPlans[idx] = p;
    } else {
      store.dailyPlans.push(p);
    }
  }

  // 其余按 id
  const tables: { key: AnyStoreTable; items: any[] | undefined }[] = [
    { key: 'longTermGoals', items: legacy.longTermGoals },
    { key: 'reflections', items: legacy.reflections },
    { key: 'harvests', items: legacy.harvests },
    { key: 'fixedRoutines', items: legacy.fixedRoutines },
    { key: 'taskItems', items: legacy.taskItems },
    { key: 'taskTemplates', items: legacy.taskTemplates },
    { key: 'courses', items: legacy.courses },
    { key: 'semester', items: legacy.semester },
    { key: 'ddls', items: legacy.ddls },
    { key: 'important', items: legacy.important },
    { key: 'backlog', items: legacy.backlog },
     { key: 'ideas', items: legacy.ideas },
    { key: 'taskBoard', items: legacy.taskBoard },
    { key: 'linkGroups', items: legacy.linkGroups },
    { key: 'trashItems', items: legacy.trashItems },
  ];
  for (const { key, items } of tables) {
    for (const rec of items ?? []) {
      if (rec?.id == null) continue;
      const arr = store[key] as any[];
      const idx = arr.findIndex(x => x.id === rec.id);
      if (idx >= 0) {
        if (recTime(rec) > recTime(arr[idx])) arr[idx] = rec;
      } else {
        arr.push(rec);
      }
    }
  }
}

// ============ 加载自愈（跨文件一致性） ============

function liveArr(table: string): any[] {
  switch (table) {
    case 'longTermGoals': return store.longTermGoals;
    case 'reflections': return store.reflections;
    case 'harvests': return store.harvests;
    case 'fixedRoutines': return store.fixedRoutines;
    case 'taskItems': return store.taskItems;
    case 'taskTemplates': return store.taskTemplates;
    case 'courses': return store.courses;
    case 'ddls': return store.ddls;
    case 'important': return store.important;
    case 'backlog': return store.backlog;
     case 'ideas': return store.ideas;
    case 'taskBoard': return store.taskBoard;
    case 'linkGroups': return store.linkGroups;
    case 'knowledgeMaps': return store.knowledgeMaps;
    default: return [];
  }
}

/** 回收站条目对应的原数据是否已在原表存在（删除/还原只完成一半的中间态） */
function existsLive(t: TrashItem): boolean {
  if (t.originalTable === 'timeBlocks') {
    const d = (t.originalData as any)?.date;
    const plan = store.dailyPlans.find(p => p.date === d);
    return !!plan && plan.timeBlocks.some(b => b.id === t.originalId);
  }
  const arr = liveArr(t.originalTable);
  return arr.some((r: any) => r.id === t.originalId);
}

/** 丢弃"原表已存在该数据"的回收站副本（恢复/删除任一方向半提交，都不丢数据） */
function healTrashDuplicates(): boolean {
  const seen = new Set<string>();
  const out: TrashItem[] = [];
  for (const t of store.trashItems) {
    const key = `${t.originalTable}:${t.originalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (existsLive(t)) continue;
    out.push(t);
  }
  if (out.length === store.trashItems.length) return false;
  store.trashItems = out;
  return true;
}

// ============ 启动 / 一次性迁移 ============

/** 初始化被阻塞：Android 11+ 未授予「所有文件访问」，需用户授权后重试 */
export const INIT_STORAGE_BLOCKED = -2;

/**
 * 初始化 store：从当前后端读入数据，并做一次性迁移（旧单文件 → 新布局、旧 Dexie → 文件）。
 * 迁移以"持久化成功 → 删除旧数据源"作为提交标记；失败则下次启动重试。
 * 返回：-2 = 存储权限被阻塞；-1 = 首次使用（无任何数据）；否则为恢复的记录总数。
 */
export async function initStore(): Promise<number> {
  // 权限被阻塞时不动内存 store：既不能把磁盘数据误判为空，更不能把空数组写回覆盖磁盘
  if (await storageAccessBlocked()) return INIT_STORAGE_BLOCKED;

  const cached = await readSnapshot(getStoragePath());
  if (cached && (cached.data.longTermGoals.some(g => g.kind === 'wish' && !g.encrypted) || cached.data.trashItems.some(t => t.originalData?.kind === 'wish' && !t.originalData?.encrypted) || cached.data.activityEvents?.some(e => e.category === 'wish-milestone' && !e.encrypted))) await clearSnapshot();
  const { data: backend, oldFormat } = await readBackend();
  const legacy = await readLegacyTablesSafe();

  clearStore();
  const hadBackend = !!backend;
  if (backend) applyData(backend);

  const legacyHasData = legacy ? Object.values(legacy).some(arr => Array.isArray(arr) && arr.length > 0) : false;
  if (legacyHasData && legacy) mergeLegacy(legacy);

  resetNextId();

  const healed = healTrashDuplicates();
  const boundCourses = bindLegacyCourses(store.semester[0]?.startDate);
  const recoveredActivity = recoverTimestampedActivity(store);

  if (legacyHasData || oldFormat || healed || boundCourses || recoveredActivity) {
    const ok = await persist();
    if (ok) {
      if (oldFormat) {
        await deleteFile(getStoragePath(), oldSingleRel());
      }
      if (legacyHasData) {
        try {
          await deleteLegacyDB();
        } catch (e) {
          console.warn('旧数据库清理失败（不影响使用）:', e);
        }
      }
    }
  }

  const total = countData();
  if (!hadBackend && !legacyHasData) return -1;
  return total;
}

function applyData(data: StorageData): void {
  for (const table of DEFAULT_WRITE_ORDER) {
    Object.assign(store, { [table]: data[table] ?? [] });
  }
}

async function readLegacyTablesSafe(): Promise<Partial<StoreShape> | null> {
  try {
    return await readLegacyTables();
  } catch (e) {
    console.warn('读取旧数据库失败（跳过迁移）:', e);
    return null;
  }
}

// ============ 导入 / 导出 ============

/** 从 JSON 字符串导入（备份包格式；纯合并：存在则更新、不存在则新增）。返回合并的记录数 */
export async function importJSONIntoStore(json: string): Promise<number> {
  const clean = json.codePointAt(0) === 0xFEFF ? json.slice(1) : json;
  const trimmed = clean.trimStart();
  if (!trimmed) throw new Error('文件内容为空，无法导入');
  if (!trimmed.startsWith('{')) throw new Error('文件内容不是 JSON 文本');
  try {
    JSON.parse(trimmed);
  } catch {
    throw new Error('文件内容不是有效的 JSON（可能已损坏或选错文件）');
  }
  const data = parseStorageData(trimmed);
  if (!data) throw new Error('不是 DailyNote 数据文件（缺少 version/dailyPlans 字段）');
  const referenced = [...data.longTermGoals.map(g => g.encrypted?.keyId), ...data.trashItems.map(t => t.originalData?.encrypted?.keyId), ...data.activityEvents.map(e => e.encrypted?.keyId)].filter(Boolean);
  for (const keyId of referenced) if (![...data.gardenKeys, ...store.gardenKeys].some(k => k.keyId === keyId)) throw new Error('备份缺少花园密钥，无法安全导入');
  const security = await import('./gardenSecurity'); security.lockGarden();
  // 导入旧备份时，先按备份自己的学期补归属，避免误绑成本机学期。
  const importedStart = data.semester[0]?.startDate;
  if (importedStart) {
    for (const course of data.courses) course.semesterStartDate ??= importedStart;
    for (const item of data.trashItems) {
      if (item.originalTable === 'courses' && item.originalData) item.originalData.semesterStartDate ??= importedStart;
    }
  }
  let count = 0;
  await mutate(() => {
    bindLegacyCourses(store.semester[0]?.startDate);
    count = mergeIntoStore(data);
    bindLegacyCourses(store.semester[0]?.startDate);
    recoverTimestampedActivity(store);
  }, { skipActivity: true });
  resetNextId();
  // Older backups omit preferences: preserve this device's combinations in that case.
  const imported = JSON.parse(trimmed);
  if (Array.isArray(imported.courseTimeCombinations)) {
    saveCourseTimeCombinations(imported.courseTimeCombinations);
  }
  return count;
}

/** 当前内存数据的 JSON 字符串（手动导出 / 备份包） */
export function exportJSON(): string {
  if (pendingGardenEncryption()) throw new Error('请先进入秘密花园，验证原密码并完成加密迁移，再导出备份');
  return JSON.stringify({ ...snapshot(), courseTimeCombinations: loadCourseTimeCombinations() }, null, 2);
}

function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `dailynote-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

/**
 * 导出备份文件：
 * - Web：触发浏览器下载，返回下载文件名
 * - Android：写入 Documents/<dir>/<文件名>，返回完整显示路径
 * 备份文件仅作存档，不会被读取逻辑当作运行期存储。
 */
export async function exportBackupFile(): Promise<string> {
  const json = exportJSON();
  const name = backupFileName();
  if (isCapacitor()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const dir = getStoragePath();
    const rel = nativePath(dir, name);
    // 与 writeFile 相同：缺省 encoding 会被当 base64 写出乱码
    await Filesystem.writeFile({ path: rel, data: json, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    return `Documents/${rel}`;
  }
  // Web：触发浏览器下载
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** 后端是否已有数据（供首次向导 / 恢复提示使用） */
export async function storeHasData(): Promise<boolean> {
  const { data } = await readBackend();
  return data ? hasAny(data) : false;
}

/** 探测某路径是否已有数据（不切换当前路径）。返回 false 也可能表示该处文件损坏。 */
export async function hasDataAt(path: string): Promise<boolean> {
  const probe = await readBackendAt(path);
  if (!probe || probe === 'CORRUPT') return false;
  return hasAny(probe);
}

/** 列出 Documents 根目录下的子目录，供「浏览已有目录」点选。
 *  - Android：真实读取系统 Documents 下的文件夹（与存储模型 Documents/<子目录> 一致）
 *  - Web：无真实目录，返回空数组（Web 数据在浏览器内置存储，路径仅作区分） */
export async function listSubdirs(): Promise<string[]> {
  if (!isCapacitor()) return [];
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const res = await Filesystem.readdir({ path: '', directory: Directory.Documents });
    return (res.files || [])
      .filter(f => f.type === 'directory')
      .map(f => f.name)
      .sort();
  } catch (e) {
    console.error('读取 Documents 目录失败:', e);
    return [];
  }
}

/**
 * 更改存储位置。
 * - 新位置已有有效数据 → 切换并恢复该处数据（原位置数据保留在盘上）
 * - 新位置无数据/文件损坏 → 报错（损坏不覆盖）；无数据则把当前数据写入新位置
 */
export async function changeStoragePath(path: string): Promise<{ recovered: boolean; count: number }> {
  // 未授权时探测必然失败，随后会把空数据写往新位置覆盖磁盘——先拒绝
  if (await storageAccessBlocked()) throw new Error('需要先授予「所有文件访问」权限');
  await flush();
  const probe = await readBackendAt(path);
  if (probe === 'CORRUPT') throw new Error('目标位置存在文件但已损坏，未做任何更改');
  const hasData = !!probe && hasAny(probe);

  setStoragePath(path);

  if (hasData) {
    const count = await initStore();
    return { recovered: true, count };
  }
  const ok = await persist();
  if (!ok) throw new Error('写入新位置失败');
  return { recovered: false, count: countData() };
}

// ============ 供 CRUD 使用 ============

export function getStore(): StoreShape {
  return store;
}

export { deepClone, countData, store };

/**
 * 忽略快照，按磁盘现状全量重读（外部改过文件时用）。
 * 返回与 initStore 相同：-2 权限阻塞 / -1 首次使用 / >0 记录数。
 */
export async function rescanFromDisk(): Promise<number> {
  await flush();
  await clearSnapshot();
  return initStore();
}
// ============ 测试专用重置 ============

export async function _resetForTest(): Promise<void> {
  await persistQueue;
  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = null;
  clearStore();
  for (const table of Object.keys(nextId) as NumericTable[]) nextId[table] = 1;
  persistQueue = Promise.resolve();
  lastPersistError = null;
  await clearSnapshot();
  if (kvDbPromise) {
    try { (await kvDbPromise).close(); } catch { /* ignore */ }
    kvDbPromise = null;
  }
  await new Promise<void>(res => {
    const req = indexedDB.deleteDatabase(KV_DB);
    req.onsuccess = () => res();
    req.onerror = () => res();
    req.onblocked = () => res();
  });
  try {
    await deleteLegacyDB();
  } catch {
    /* 旧库可能不存在，忽略 */
  }
}
