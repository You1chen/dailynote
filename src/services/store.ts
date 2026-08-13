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
 *
 * 写盘策略：
 *   - mutate() 先对每张表做指纹快照，变更后对比，只写"变脏"的文件
 *   - 跨文件操作（删除/还原）通过 writeOrder 控制写序：先写"新增"侧、再写"移除"侧，
 *     崩溃中断不会丢数据（加载时自愈：回收站条目若原表已存在则丢弃其副本）
 *   - 启动时若发现旧版单文件 dailynote-data.json → 迁移到新布局并删除旧文件（提交标记）
 */

import type { DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TaskItem, TaskTemplate, TrashItem, Course, SemesterRecord } from '../types';
import { normalizeCourseDayOfWeek } from '../types';
import { readLegacyTables, deleteLegacyDB } from '../db/legacy';

// ============ 数据结构 ============

export interface StorageData {
  version: 1;
  savedAt: number;
  dailyPlans: DailyPlan[];
  longTermGoals: LongTermGoal[];
  reflections: Reflection[];
  harvests: Harvest[];
  fixedRoutines: FixedRoutine[];
  taskItems: TaskItem[];
  taskTemplates: TaskTemplate[];
  trashItems: TrashItem[];
  courses: Course[];
  semester: SemesterRecord[];
}

export interface StoreShape {
  dailyPlans: DailyPlan[];
  longTermGoals: LongTermGoal[];
  reflections: Reflection[];
  harvests: Harvest[];
  fixedRoutines: FixedRoutine[];
  taskItems: TaskItem[];
  taskTemplates: TaskTemplate[];
  trashItems: TrashItem[];
  courses: Course[];
  semester: SemesterRecord[];
}

export type AnyStoreTable = keyof StoreShape;

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
const DAY_TYPES = ['reflections', 'harvests', 'tasks'] as const;
const CATEGORY_FILES: Record<'longTermGoals' | 'fixedRoutines' | 'trashItems' | 'taskTemplates' | 'courses' | 'semester', string> = {
  longTermGoals: 'goals.json',
  fixedRoutines: 'routines.json',
  trashItems: 'trash.json',
  taskTemplates: 'templates.json',
  courses: 'courses.json',
  semester: 'semester.json',
};

function dayPlan(date: string): string {
  return `${DAY_DIR}/${date}/plan.json`;
}
function dayTypeFile(date: string, type: 'reflections' | 'harvests' | 'tasks'): string {
  return `${DAY_DIR}/${date}/${type}.json`;
}

const KV_DB = 'dailynote_kv';
const KV_STORE = 'kv';

type NumericTable = 'dailyPlans' | 'longTermGoals' | 'reflections' | 'harvests' | 'fixedRoutines' | 'taskTemplates' | 'trashItems' | 'courses' | 'semester';

// ============ 内存 store ============

const store: StoreShape = {
  dailyPlans: [],
  longTermGoals: [],
  reflections: [],
  harvests: [],
  fixedRoutines: [],
  taskItems: [],
  taskTemplates: [],
  trashItems: [],
  courses: [],
  semester: [],
};

/**
 * 每表单调递增 id 计数器（不复用，杜绝与回收站还原撞 id）。
 * initStore / 导入 / 迁移后需调用 resetNextId() 重建。
 */
const nextId: Record<NumericTable, number> = {
  dailyPlans: 1,
  longTermGoals: 1,
  reflections: 1,
  harvests: 1,
  fixedRoutines: 1,
  taskTemplates: 1,
  trashItems: 1,
  courses: 1,
  semester: 1,
};

export function allocId(table: NumericTable): number {
  return nextId[table]++;
}

function resetNextId(): void {
  const tables: NumericTable[] = ['dailyPlans', 'longTermGoals', 'reflections', 'harvests', 'fixedRoutines', 'taskTemplates', 'trashItems', 'courses', 'semester'];
  for (const t of tables) {
    let max = 0;
    for (const rec of store[t] as { id?: number }[]) {
      if (typeof rec.id === 'number' && rec.id > max) max = rec.id;
    }
    nextId[t] = max + 1;
  }
}

function clearStore(): void {
  store.dailyPlans = [];
  store.longTermGoals = [];
  store.reflections = [];
  store.harvests = [];
  store.fixedRoutines = [];
  store.taskItems = [];
  store.taskTemplates = [];
  store.trashItems = [];
  store.courses = [];
  store.semester = [];
}

function countData(): number {
  return store.dailyPlans.length + store.longTermGoals.length + store.reflections.length
    + store.harvests.length + store.fixedRoutines.length + store.taskItems.length + store.taskTemplates.length + store.trashItems.length
    + store.courses.length + store.semester.length;
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
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.writeFile({ path: nativePath(dir, rel), data: json, directory: Directory.Documents, recursive: true });
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
    };
  } catch {
    return null;
  }
}

function hasAny(d: StorageData): boolean {
  return d.dailyPlans.length > 0 || d.longTermGoals.length > 0 || d.reflections.length > 0
    || d.harvests.length > 0 || d.fixedRoutines.length > 0 || d.taskItems.length > 0 || d.taskTemplates.length > 0 || d.trashItems.length > 0
    || d.courses.length > 0 || d.semester.length > 0;
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
  if (dates.length === 0 && !longTermGoals && !fixedRoutines && !trashItems && !taskTemplates && !courses && !semester) return null;
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
  };
}

/** 旧版单文件（迁移用）。返回 'CORRUPT' 表示文件存在但解析失败 */
async function readOldSingleFile(dir: string): Promise<StorageData | 'CORRUPT' | null> {
  const text = await readFile(dir, oldSingleRel());
  if (text == null) return null;
  const data = parseStorageData(text);
  return data ?? 'CORRUPT';
}

/** 读取当前路径的后端数据（新布局优先；旧单文件存在则视为迁移未完成，优先取它） */
async function readBackend(): Promise<{ data: StorageData | null; oldFormat: boolean }> {
  const dir = getStoragePath();
  const old = await readOldSingleFile(dir);
  if (old === 'CORRUPT') console.warn('旧版数据文件损坏，尝试读取新布局:', dir);
  if (old && old !== 'CORRUPT') return { data: old, oldFormat: true };
  const data = await readNewStructure(dir);
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

const DEFAULT_WRITE_ORDER: AnyStoreTable[] = ['dailyPlans', 'reflections', 'harvests', 'taskItems', 'longTermGoals', 'fixedRoutines', 'taskTemplates', 'courses', 'semester', 'trashItems'];

function snapshot(): StorageData {
  return {
    version: 1,
    savedAt: Date.now(),
    dailyPlans: store.dailyPlans,
    longTermGoals: store.longTermGoals,
    reflections: store.reflections,
    harvests: store.harvests,
    fixedRoutines: store.fixedRoutines,
    taskItems: store.taskItems,
    taskTemplates: store.taskTemplates,
    trashItems: store.trashItems,
    courses: store.courses,
    semester: store.semester,
  };
}

/**
 * 入队写任务：入队时刻同步捕获 { dir, 待写文件列表 } 快照，promise 链串行执行。
 * 写入失败记 lastPersistError，绝不 throw。
 */
function enqueue(build: () => { writes: FileWrite[]; deletes: string[] }): Promise<boolean> {
  const dir = getStoragePath();
  const { writes, deletes } = build();
  const job = persistQueue.then(async () => {
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
  persistQueue = job.catch(() => {});
  return job;
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
  writes.push({ relPath: CATEGORY_FILES.longTermGoals, json: JSON.stringify(store.longTermGoals, null, 2), table: 'longTermGoals' });
  writes.push({ relPath: CATEGORY_FILES.fixedRoutines, json: JSON.stringify(store.fixedRoutines, null, 2), table: 'fixedRoutines' });
  writes.push({ relPath: CATEGORY_FILES.taskTemplates, json: JSON.stringify(store.taskTemplates, null, 2), table: 'taskTemplates' });
  writes.push({ relPath: CATEGORY_FILES.courses, json: JSON.stringify(store.courses, null, 2), table: 'courses' });
  writes.push({ relPath: CATEGORY_FILES.semester, json: JSON.stringify(store.semester, null, 2), table: 'semester' });
  writes.push({ relPath: CATEGORY_FILES.trashItems, json: JSON.stringify(store.trashItems, null, 2), table: 'trashItems' });
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
  trashItems: string;
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
    trashItems: JSON.stringify(store.trashItems),
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

  if (a.longTermGoals !== b.longTermGoals) {
    writes.push({ relPath: CATEGORY_FILES.longTermGoals, json: JSON.stringify(store.longTermGoals, null, 2), table: 'longTermGoals' });
  }
  if (a.fixedRoutines !== b.fixedRoutines) {
    writes.push({ relPath: CATEGORY_FILES.fixedRoutines, json: JSON.stringify(store.fixedRoutines, null, 2), table: 'fixedRoutines' });
  }
  if (a.taskTemplates !== b.taskTemplates) {
    writes.push({ relPath: CATEGORY_FILES.taskTemplates, json: JSON.stringify(store.taskTemplates, null, 2), table: 'taskTemplates' });
  }
  if (a.courses !== b.courses) {
    writes.push({ relPath: CATEGORY_FILES.courses, json: JSON.stringify(store.courses, null, 2), table: 'courses' });
  }
  if (a.semester !== b.semester) {
    writes.push({ relPath: CATEGORY_FILES.semester, json: JSON.stringify(store.semester, null, 2), table: 'semester' });
  }
  if (a.trashItems !== b.trashItems) {
    writes.push({ relPath: CATEGORY_FILES.trashItems, json: JSON.stringify(store.trashItems, null, 2), table: 'trashItems' });
  }

  // writeOrder：跨文件操作控制写序（先写"新增"侧，再写"移除"侧）
  const orderIndex = new Map<string, number>();
  (order ?? DEFAULT_WRITE_ORDER).forEach((t, i) => orderIndex.set(t, i));
  writes.sort((x, y) => (orderIndex.get(x.table) ?? 999) - (orderIndex.get(y.table) ?? 999));

  return { writes, deletes };
}

export function persist(): Promise<boolean> {
  return enqueue(() => buildWriteSetFromStore());
}

export async function flush(): Promise<void> {
  await persistQueue;
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
  return enqueue(() => buildWriteSetDirty(before, after, opts?.writeOrder));
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
    { key: 'trashItems', items: data.trashItems, numeric: true },
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

/**
 * 初始化 store：从当前后端读入数据，并做一次性迁移（旧单文件 → 新布局、旧 Dexie → 文件）。
 * 迁移以"持久化成功 → 删除旧数据源"作为提交标记；失败则下次启动重试。
 * 返回：-1 = 首次使用（无任何数据）；否则为恢复的记录总数。
 */
export async function initStore(): Promise<number> {
  const { data: backend, oldFormat } = await readBackend();
  const legacy = await readLegacyTablesSafe();

  clearStore();
  const hadBackend = !!backend;
  if (backend) applyData(backend);

  const legacyHasData = legacy ? Object.values(legacy).some(arr => Array.isArray(arr) && arr.length > 0) : false;
  if (legacyHasData && legacy) mergeLegacy(legacy);

  resetNextId();

  const healed = healTrashDuplicates();

  if (legacyHasData || oldFormat || healed) {
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
  store.dailyPlans = data.dailyPlans;
  store.longTermGoals = data.longTermGoals;
  store.reflections = data.reflections;
  store.harvests = data.harvests;
  store.fixedRoutines = data.fixedRoutines;
  store.taskItems = data.taskItems;
  store.taskTemplates = data.taskTemplates;
  store.trashItems = data.trashItems;
  store.courses = data.courses;
  store.semester = data.semester;
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
  const data = parseStorageData(clean);
  if (!data) throw new Error('无效的数据文件格式');
  let count = 0;
  await mutate(() => {
    count = mergeIntoStore(data);
  });
  resetNextId();
  return count;
}

/** 当前内存数据的 JSON 字符串（手动导出 / 备份包） */
export function exportJSON(): string {
  return JSON.stringify(snapshot(), null, 2);
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
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const dir = getStoragePath();
    const rel = nativePath(dir, name);
    await Filesystem.writeFile({ path: rel, data: json, directory: Directory.Documents, recursive: true });
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

// ============ 测试专用重置 ============

export async function _resetForTest(): Promise<void> {
  clearStore();
  resetNextId();
  persistQueue = Promise.resolve();
  lastPersistError = null;
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
