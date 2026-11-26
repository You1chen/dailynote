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
 *     taskboard.json                 任务树（单记录，id 恒 1）
 *     preferences.json               应用偏好（单个对象）
 *
 * 写盘策略：
 *   - mutate() 先对每张表做指纹快照，变更后对比，只写"变脏"的文件
 *   - 跨文件操作（删除/还原）通过 writeOrder 控制写序：先写"新增"侧、再写"移除"侧，
 *     崩溃中断不会丢数据（加载时自愈：回收站条目若原表已存在则丢弃其副本）
 *   - 启动时若发现旧版单文件 dailynote-data.json → 迁移到新布局并删除旧文件（提交标记）
 */

import type { DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TaskItem, TaskTemplate, TrashItem, Course, SemesterRecord, DdlItem, TaskBoard, ImportantItem, LinkGroup } from '../types';
import { normalizeCourseDayOfWeek } from '../types';
import type { PreferencesPatch, UserPreferences } from '../types/preferences';
import { defaultPreferences, LEGACY_HOME_ALARM_KEY, LEGACY_PREFERENCES_KEY, mergePreferences, normalizeCourseTimeCombinations, parsePreferencesPatch, PREFERENCES_CHANGED } from '../utils/preferenceValues';
import type { AnyStoreTable, StorageData, StoreShape } from '../types/storage';
import { CATEGORY_FILES, CATEGORY_NAMES, CATEGORY_TABLES, DEFAULT_WRITE_ORDER, NUMERIC_TABLES, emptyStore } from './storeSchema';
export type { AnyStoreTable, StorageData, StoreShape } from '../types/storage';
import { readLegacyTables, deleteLegacyDB, legacyDatabaseExists } from '../db/legacy';
import { registerPlugin } from '@capacitor/core';
import { readSnapshot, writeSnapshot, clearSnapshot, sameNames, filesCover } from './snapshot';
import type { KnowledgeCardLibrary } from '../types/knowledge';
import { migrateLegacyKnowledgeCards, type LegacyKnowledgeMap } from '../utils/knowledgeMigration';
import { isRetiredTrashItem } from '../utils/retiredRecords';

// ============ 布局常量 ============

/**
 * 旧版单文件（迁移前）；仅供启动迁移。
 * Web 端旧版 KV 键是 dailynote-data（无扩展名），原生端旧文件是 dailynote-data.json。
 */
export const OLD_SINGLE_REL = 'dailynote-data.json';
function oldSingleRel(): string {
  return isCapacitor() ? 'dailynote-data.json' : 'dailynote-data';
}
const LEGACY_KNOWLEDGE_MAPS_FILE = 'knowledge-maps.json';
const PREFERENCES_FILE = 'preferences.json';
const DAY_DIR = 'days';
const DAY_TYPES = ['reflections', 'harvests', 'tasks'] as const;
function dayPlan(date: string): string {
  return `${DAY_DIR}/${date}/plan.json`;
}
function dayTypeFile(date: string, type: 'reflections' | 'harvests' | 'tasks'): string {
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
  return Object.values(store).reduce((total, rows) => total + rows.length, 0);
}

// ============ 路径管理 ============

const DEFAULT_STORAGE_PATH = 'Documents/Ji';

export function getStoragePath(): string {
  try {
    return localStorage.getItem('dailynote_storage_path') || DEFAULT_STORAGE_PATH;
  } catch {
    return DEFAULT_STORAGE_PATH;
  }
}

export function setStoragePath(path: string): void {
  localStorage.setItem('dailynote_storage_path', path);
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
  const managed = /^days\/\d{4}-\d{2}-\d{2}\/(plan|reflections|harvests|tasks)\.json$/;
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

function parseStorageData(text: string): { data: StorageData; legacyMaps: LegacyKnowledgeMap[]; archive?: string } | null {
  try {
    const data = JSON.parse(text);
    if (!data || data.version !== 1 || !Array.isArray(data.dailyPlans)) return null;
    const legacyMaps = Array.isArray(data.knowledgeMaps) ? data.knowledgeMaps : [];
    const hasRetiredData = legacyMaps.length > 0 || ['backlog', 'ideas', 'activityEvents', 'gardenKeys'].some(key =>
      Array.isArray(data[key]) && data[key].length > 0,
    );
    return {
      legacyMaps,
      archive: hasRetiredData ? text : undefined,
      data: {
        version: 1,
        savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
        preferences: parsePreferencesPatch(data.preferences) ?? (
          Array.isArray(data.courseTimeCombinations)
            ? { courseTimeCombinations: normalizeCourseTimeCombinations(data.courseTimeCombinations) }
            : undefined
        ),
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
        taskBoard: Array.isArray(data.taskBoard) ? data.taskBoard : [],
        linkGroups: Array.isArray(data.linkGroups) ? data.linkGroups : [],
        knowledgeCards: Array.isArray(data.knowledgeCards) ? data.knowledgeCards : [],
      },
    };
  } catch {
    return null;
  }
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
  }
  const longTermGoals = await readCategory<LongTermGoal>(dir, CATEGORY_FILES.longTermGoals);
  const fixedRoutines = await readCategory<FixedRoutine>(dir, CATEGORY_FILES.fixedRoutines);
  const trashItems = await readCategory<TrashItem>(dir, CATEGORY_FILES.trashItems);
  const taskTemplates = await readCategory<TaskTemplate>(dir, CATEGORY_FILES.taskTemplates);
  const courses = await readCategory<Course>(dir, CATEGORY_FILES.courses);
  const semester = await readCategory<SemesterRecord>(dir, CATEGORY_FILES.semester);
  const ddls = await readCategory<DdlItem>(dir, CATEGORY_FILES.ddls);
  const important = await readCategory<ImportantItem>(dir, CATEGORY_FILES.important);
  const taskBoard = await readCategory<TaskBoard>(dir, CATEGORY_FILES.taskBoard);
  const linkGroups = await readCategory<LinkGroup>(dir, CATEGORY_FILES.linkGroups);
  const knowledgeCards = await readCategory<KnowledgeCardLibrary>(dir, CATEGORY_FILES.knowledgeCards);
  if (dates.length === 0 && !longTermGoals && !fixedRoutines && !trashItems && !taskTemplates && !courses && !semester && !ddls && !important && !taskBoard && !linkGroups && !knowledgeCards) return null;
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
    taskBoard: taskBoard ?? [],
    linkGroups: linkGroups ?? [],
    knowledgeCards: knowledgeCards ?? [],
  };
}

/** 旧版单文件（迁移用）。返回 'CORRUPT' 表示文件存在但解析失败 */
async function readOldSingleFile(dir: string): Promise<ReturnType<typeof parseStorageData> | 'CORRUPT'> {
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
  return { dates: [...dates], files: CATEGORY_NAMES };
}

/** 由读到的数据推算目录结构（首次写快照用） */
function namesFromData(data: StorageData): { dates: string[]; files: string[] } {
  const dates = new Set<string>();
  for (const p of data.dailyPlans) dates.add(p.date);
  for (const r of data.reflections) dates.add(r.date);
  for (const h of data.harvests) dates.add(h.date);
  for (const t of data.taskItems) dates.add(t.date);
  return { dates: [...dates], files: CATEGORY_NAMES };
}

function saveSnapshot(): Promise<void> {
  const { dates, files } = currentNames();
  return writeSnapshot({ root: getStoragePath(), dates, files, savedAt: Date.now(), data: snapshot() });
}

/** 快照防抖：连续写操作只落一次 */
let snapTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotWrite = Promise.resolve();
function scheduleSnapshot(): void {
  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    snapTimer = null;
    const writesAtSchedule = persistQueue;
    void writesAtSchedule.then(() => {
      if (writesAtSchedule === persistQueue) snapshotWrite = saveSnapshot().catch(() => {});
    });
  }, 400);
}

/** 立即落快照（flush / 切后台时用） */
async function flushSnapshot(): Promise<void> {
  if (snapTimer) {
    clearTimeout(snapTimer);
    snapTimer = null;
  }
  const { dates, files } = currentNames();
  await writeSnapshot({ root: getStoragePath(), dates, files, savedAt: Date.now(), data: snapshot() });
}

/** 读取当前路径的后端数据（新布局优先；旧单文件存在则视为迁移未完成，优先取它） */
async function readBackend(): Promise<{
  data: StorageData | null;
  oldFormat: boolean;
  hasPreviousState: boolean;
  hasLegacyMapsFile?: boolean;
  legacyMaps?: LegacyKnowledgeMap[];
  archive?: string;
}> {
  const dir = getStoragePath();

  // 旧单文件仍在 → 走迁移路径（本来就要读它）
  const old = await readOldSingleFile(dir);
  if (old === 'CORRUPT') console.warn('旧版数据文件损坏，尝试读取新布局:', dir);
  if (old && old !== 'CORRUPT') return { ...old, oldFormat: true, hasPreviousState: true };
  const names = await listBackendNames(dir);
  const hasLegacyMapsFile = names.files.includes(LEGACY_KNOWLEDGE_MAPS_FILE);

  // 快照命中：日期目录没变就直接用，不再逐文件读取
  // （只比日期集合：分类文件由本应用自己维护，应用写入时主动使旧快照失效）
  if (!old) {
    const snap = await readSnapshot(dir);
    // 快照写入时可能列出全部类别文件，而某些类别文件尚未创建；只看磁盘上实际存在的文件是否都被快照覆盖。
    const knownCategoryFiles = new Set<string>(Object.values(CATEGORY_FILES));
    const diskCategoryFiles = names.files.filter(file => knownCategoryFiles.has(file));
    if (snap && sameNames(snap.dates, names.dates) && filesCover(snap.files, diskCategoryFiles)) {
      return { data: snap.data, oldFormat: false, hasPreviousState: true, hasLegacyMapsFile };
    }
  }

  const data = await readNewStructure(dir);
  if (data) {
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
  // 旧文件或目录仍表示设备上已有数据。
  const hasPreviousState = !!old || !!data || names.dates.length > 0 || names.files.length > 0;
  return { data, oldFormat: false, hasPreviousState, hasLegacyMapsFile };
}

// ============ 持久化队列（增量写 + 快照捕获） ============

let persistQueue: Promise<unknown> = Promise.resolve();
let lastPersistError: string | null = null;
let preferences = defaultPreferences();
let preferencesConfigured = false;
const preferenceListeners = new Set<() => void>();

export function getPreferences(): UserPreferences {
  return preferences;
}

export function subscribePreferences(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => { preferenceListeners.delete(listener); };
}

function publishPreferences(next: UserPreferences, configured: boolean): void {
  preferences = next;
  preferencesConfigured = configured;
  for (const listener of preferenceListeners) listener();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(PREFERENCES_CHANGED));
  }
}

function preferencesWrite(value = preferences): FileWrite {
  return { relPath: PREFERENCES_FILE, json: JSON.stringify(value, null, 2), table: 'preferences' };
}

function writePreferences(value = preferences): Promise<boolean> {
  return enqueue(() => ({ writes: [preferencesWrite(value)], deletes: [] }));
}

function replacePreferences(next: UserPreferences): Promise<boolean> {
  const write = writePreferences(next);
  publishPreferences(next, true);
  return write;
}

export function updatePreferences(partial: PreferencesPatch): Promise<boolean> {
  const patch = parsePreferencesPatch(partial);
  return patch ? replacePreferences(mergePreferences(preferences, patch)) : Promise.resolve(true);
}

export function resetPreferences(): Promise<boolean> {
  return replacePreferences(defaultPreferences());
}

function readLegacyPreference(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return undefined;
  }
}

function removeLegacyPreference(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Backing JSON is already authoritative. */ }
}

async function readSavedPreferences(dir: string): Promise<PreferencesPatch | 'CORRUPT' | null> {
  const json = await readFile(dir, PREFERENCES_FILE);
  if (json == null) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (value && typeof value === 'object' && !Array.isArray(value)) return parsePreferencesPatch(value) ?? {};
  } catch { /* Report corruption without preventing access to other data. */ }
  console.warn('偏好设置文件损坏:', dir);
  return 'CORRUPT';
}

async function initializePreferences(fromLegacyFile?: PreferencesPatch): Promise<boolean> {
  const saved = await readSavedPreferences(getStoragePath());
  const defaults = defaultPreferences();
  const legacy = parsePreferencesPatch(readLegacyPreference(LEGACY_PREFERENCES_KEY));
  const legacyAlarm = parsePreferencesPatch({ homeAlarm: readLegacyPreference(LEGACY_HOME_ALARM_KEY) })?.homeAlarm;
  const hasSaved = saved !== null && saved !== 'CORRUPT';
  const migrateAlarm = legacyAlarm && !fromLegacyFile?.homeAlarm && (!hasSaved || !saved.homeAlarm);
  const fromLegacy = mergePreferences(defaults, {
    ...(!hasSaved ? legacy : undefined),
    homeAlarm: migrateAlarm ? legacyAlarm : undefined,
  });
  const next = mergePreferences(fromLegacy, hasSaved ? saved : fromLegacyFile ?? {});

  if ((saved === null && (legacy || legacyAlarm || fromLegacyFile)) || (hasSaved && migrateAlarm)) {
    if (!(await replacePreferences(next))) return true;
  } else {
    publishPreferences(next, hasSaved);
  }
  if (saved !== 'CORRUPT') {
    if (legacy) removeLegacyPreference(LEGACY_PREFERENCES_KEY);
    if (legacyAlarm) removeLegacyPreference(LEGACY_HOME_ALARM_KEY);
  }
  return saved !== null || !!legacy || !!legacyAlarm;
}

interface FileWrite {
  relPath: string;
  json: string;
  table: AnyStoreTable | 'preferences';
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
    if (writes.some(write => write.table !== 'preferences') || deletes.length || cleanOrphans) {
      // A reload can interrupt the debounced refresh. Invalidate the old snapshot
      // before changing any backing file, even if the file names do not change.
      if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
      await snapshotWrite;
      await clearSnapshot();
    }
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
  ];
  for (const [type, table] of dayMaps) {
    for (const [date, items] of groupByDate(store[table] as unknown as { date: string }[])) {
      writes.push({ relPath: dayTypeFile(date, type), json: JSON.stringify(items, null, 2), table });
    }
  }
  for (const { table, file } of CATEGORY_TABLES) {
    writes.push({ relPath: file, json: JSON.stringify(store[table], null, 2), table });
  }
  if (preferencesConfigured) writes.push(preferencesWrite());
  return { writes, deletes: [] };
}

// ---- 脏检测：指纹 = 每张表的序列化（日期表按日期分桶） ----

interface Fp {
  planDates: Map<string, string>;
  dayDates: Record<'reflections' | 'harvests' | 'tasks', Map<string, string>>;
  longTermGoals: string;
  fixedRoutines: string;
  taskTemplates: string;
  courses: string;
  semester: string;
  ddls: string;
  important: string;
  taskBoard: string;
  linkGroups: string;
  trashItems: string;
  knowledgeCards: string;
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
    },
    longTermGoals: JSON.stringify(store.longTermGoals),
    fixedRoutines: JSON.stringify(store.fixedRoutines),
    taskTemplates: JSON.stringify(store.taskTemplates),
    courses: JSON.stringify(store.courses),
    semester: JSON.stringify(store.semester),
    ddls: JSON.stringify(store.ddls),
    important: JSON.stringify(store.important),
    taskBoard: JSON.stringify(store.taskBoard),
    linkGroups: JSON.stringify(store.linkGroups),
    trashItems: JSON.stringify(store.trashItems),
    knowledgeCards: JSON.stringify(store.knowledgeCards),
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
  writes.sort((x, y) => (orderIndex.get(x.table) ?? 999) - (orderIndex.get(y.table) ?? 999));

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
export async function mutate(fn: () => void, opts?: { writeOrder?: AnyStoreTable[] }): Promise<boolean> {
  const before = fingerprint();
  fn();
  const after = fingerprint();
  const ok = await enqueue(() => buildWriteSetDirty(before, after, opts?.writeOrder));
  if (ok) scheduleSnapshot();
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
    case 'taskBoard': return store.taskBoard;
    case 'linkGroups': return store.linkGroups;
    case 'knowledgeCards': return store.knowledgeCards;
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
    if (isRetiredTrashItem(t)) { out.push(t); continue; }
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

  const { data: backend, oldFormat, hasPreviousState, archive, hasLegacyMapsFile, legacyMaps = [] } = await readBackend();
  // Avoid creating a legacy database on first launch. If the check fails, still
  // try the migration and don't report the store as fresh.
  const hadLegacy = await legacyDatabaseExists().catch(() => true);
  const legacy = hadLegacy ? await readLegacyTablesSafe() : null;

  clearStore();
  if (backend) applyData(backend);
  // Preferences stay independent of the startup data snapshot so edits are read on every launch.
  const hadPreferences = await initializePreferences(oldFormat ? backend?.preferences : undefined);

  const legacyHasData = legacy ? Object.values(legacy).some(arr => Array.isArray(arr) && arr.length > 0) : false;
  if (legacyHasData && legacy) mergeLegacy(legacy);

  resetNextId();

  const healed = healTrashDuplicates();
  const boundCourses = bindLegacyCourses(store.semester[0]?.startDate);

  if (archive) {
    const dir = getStoragePath();
    const name = 'dailynote-legacy-archive.json';
    const existing = await readFile(dir, name);
    if (existing !== archive && (existing !== null || !await writeFile(dir, name, archive))) {
      throw new Error('无法保存旧版数据归档');
    }
  }

  const dir = getStoragePath();
  const storedCards = oldFormat ? await readCategory<KnowledgeCardLibrary>(dir, CATEGORY_FILES.knowledgeCards) : null;
  const storedLibrary = storedCards?.find(library => library.id === 1) ?? storedCards?.[0];
  // A restart can occur after a full write but before removal of the old bundle.
  if (storedLibrary?.legacyMapsMigrated) store.knowledgeCards = storedCards!;
  const currentLibrary = store.knowledgeCards.find(library => library.id === 1) ?? store.knowledgeCards[0];
  const storedMaps = !currentLibrary?.legacyMapsMigrated && (hasLegacyMapsFile || oldFormat)
    ? await readCategory<LegacyKnowledgeMap>(dir, LEGACY_KNOWLEDGE_MAPS_FILE)
    : null;
  const libraries = currentLibrary?.legacyMapsMigrated ? store.knowledgeCards : [...(storedCards ?? []), ...store.knowledgeCards];
  const migratedCards = migrateLegacyKnowledgeCards([...(storedMaps ?? []), ...legacyMaps], libraries);

  if (legacyHasData || oldFormat || healed || boundCourses) {
    if (migratedCards) store.knowledgeCards = migratedCards;
    const ok = await persist();
    if (!ok && migratedCards) throw new Error('无法保存迁移的知识卡片');
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
  } else if (migratedCards) {
    // Save the records and the completion flag together before exposing the collector.
    const previous = store.knowledgeCards;
    if (!await mutate(() => { store.knowledgeCards = migratedCards; })) {
      store.knowledgeCards = previous;
      throw new Error('无法保存迁移的知识卡片');
    }
  }

  const total = countData();
  if (!hasPreviousState && !hadLegacy && !hadPreferences) return -1;
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

// ============ 供 CRUD 使用 ============

export function getStore(): StoreShape {
  return store;
}

export { deepClone, countData, store };

// ============ 测试专用重置 ============

export async function _resetForTest(): Promise<void> {
  await persistQueue;
  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = null;
  clearStore();
  preferences = defaultPreferences();
  preferencesConfigured = false;
  preferenceListeners.clear();
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
