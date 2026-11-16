/**
 * 启动快照（类似 git 的索引）：把上一次成功读入/写出的整份数据留在本地，
 * 下次启动只要「目录里有哪些文件」没变，就直接用快照，不再逐个读文件。
 *
 * 存 IndexedDB（原生 WebView 与浏览器都可用），不放进用户的数据目录。
 * 快照只是缓存：目录结构一变、或用户点「重新扫描」，就回到全量读取。
 */

import type { StorageData } from '../types/storage';

const DB_NAME = 'dailynote_snapshot';
const STORE = 'snap';
const KEY = 'current';

export interface Snapshot {
  /** 存储目录（换了目录就不复用） */
  root: string;
  /** days/ 下的日期目录名 */
  dates: string[];
  /** 根目录下的分类文件名 */
  files: string[];
  /** 快照时间 */
  savedAt: number;
  data: StorageData;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readSnapshot(root: string): Promise<Snapshot | null> {
  try {
    const db = await openDb();
    return await new Promise<Snapshot | null>(resolve => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        db.close();
        const v = req.result as Snapshot | undefined;
        resolve(v && v.root === root && v.data ? v : null);
      };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

export async function writeSnapshot(snap: Snapshot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snap, KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    /* 快照失败不影响主流程 */
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    /* 忽略 */
  }
}

/** 快照里的文件集合是否覆盖磁盘现有文件。
 * 快照写入时可能列出全部类别文件，而某类文件尚未创建；
 * 只要磁盘上的文件都在快照里，就可复用。
 */
export function filesCover(snapshotFiles: string[], diskFiles: string[]): boolean {
  const known = new Set(snapshotFiles);
  return diskFiles.every(file => known.has(file));
}

/** 两个名字集合是否一致（顺序无关） */
export function sameNames(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
