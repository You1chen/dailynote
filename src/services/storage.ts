/**
 * 文件存储服务（兼容 facade）
 *
 * 所有逻辑均在 src/services/store.ts（权威存储）。
 * 本模块保留旧导出名，让 main.tsx / BackupRestore.tsx 无需改动即可编译运行。
 */

import {
  getStoragePath,
  setStoragePath,
  getDisplayPath,
  normalizePath,
  initStore,
  persist,
  flush,
  importJSONIntoStore,
  storeHasData,
  changeStoragePath,
  getLastPersistError,
  exportJSON,
  exportBackupFile,
  isCapacitor,
  listSubdirs,
  storageAccessStatus,
  storageAccessBlocked,
  requestAllFilesAccess,
  INIT_STORAGE_BLOCKED,
} from './store';

export type { StorageData, NativeStorageStatus } from './store';

export {
  getStoragePath,
  setStoragePath,
  getDisplayPath,
  normalizePath,
  flush,
  getLastPersistError,
  isCapacitor,
  storageAccessStatus,
  storageAccessBlocked,
  requestAllFilesAccess,
  INIT_STORAGE_BLOCKED,
};

/** 启动时：从用户目录文件加载数据到内存（含一次性旧库迁移）。返回恢复条数，-1 表示首次使用 */
export async function loadFromFile(): Promise<number> {
  return initStore();
}

/** 立即保存当前数据到存储文件 */
export async function saveNow(): Promise<boolean> {
  return persist();
}

/** 当前内存数据导出为 JSON 字符串 */
export function exportData(): string {
  return exportJSON();
}

/** 导出备份文件：Web 触发浏览器下载，Android 写入 Documents/<dir>/。返回下载文件名或完整路径 */
export async function saveBackupFile(): Promise<string> {
  return exportBackupFile();
}

/** 从 JSON 字符串导入数据（文件选择器）。返回合并的记录数 */
export async function importFromJSON(json: string): Promise<number> {
  return importJSONIntoStore(json);
}

/** 检查当前存储位置是否已有数据（供恢复提示） */
export async function fileExists(): Promise<boolean> {
  return storeHasData();
}

/** 列出 Documents 下的已有子目录（Android 真实读取；Web 返回空） */
export async function listStorageSubdirs(): Promise<string[]> {
  return listSubdirs();
}

/** 更改存储位置 */
export async function switchStoragePath(path: string): Promise<{ recovered: boolean; count: number }> {
  return changeStoragePath(path);
}

/** 兼容旧接口：数据变更后无需再手动安排保存（立即写盘），保留为 no-op */
export function scheduleSave(): void {
  /* no-op：数据已在变更时立即写盘 */
}
