import { registerPlugin } from '@capacitor/core';
import { getStoragePath, isCapacitor } from './store';
import { pickAutoUpdate, type ApkFileInfo, type InstalledAppInfo } from '../utils/apkUpdate';

interface ApkUpdateNative {
  installedInfo(): Promise<InstalledAppInfo>;
  canInstall(): Promise<{ allowed: boolean }>;
  scan(options: { dirs: string[] }): Promise<{ files: ApkFileInfo[] }>;
  install(options: { path: string }): Promise<{ started: boolean }>;
  openInstallSettings(): Promise<void>;
}

const Native = registerPlugin<ApkUpdateNative>('ApkUpdate');

/** 只有 Android 原生包能做应用内覆盖安装。 */
export function apkUpdateSupported(): boolean {
  return isCapacitor();
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function getInstalledAppInfo(): Promise<InstalledAppInfo | null> {
  if (!apkUpdateSupported()) return null;
  try {
    return await Native.installedInfo();
  } catch {
    return null;
  }
}

/** 会扫描的位置：当前存储目录、Documents 根目录、系统 Download 目录。 */
export function updateScanDirs(): string[] {
  const dirs = [getStoragePath(), 'Documents', 'Download'];
  return Array.from(new Set(dirs.filter(Boolean)));
}

/** 只保留 DailyNote 自己的安装包，按版本号从新到旧。 */
export async function scanUpdatePackages(): Promise<ApkFileInfo[]> {
  if (!apkUpdateSupported()) return [];
  const { files } = await Native.scan({ dirs: updateScanDirs() });
  return files
    .filter(file => file.samePackage)
    .sort((a, b) => b.versionCode - a.versionCode || b.modified - a.modified);
}

/** 启动时自动检查：只有更高版本且签名一致才返回。 */
export async function findAutoUpdate(): Promise<ApkFileInfo | null> {
  if (!apkUpdateSupported()) return null;
  try {
    const [installed, files] = await Promise.all([Native.installedInfo(), scanUpdatePackages()]);
    return pickAutoUpdate(files, installed);
  } catch {
    return null;
  }
}

export async function canRequestInstall(): Promise<boolean> {
  if (!apkUpdateSupported()) return false;
  try {
    return (await Native.canInstall()).allowed;
  } catch {
    return false;
  }
}

/** 交给系统安装器覆盖安装；调用成功只代表安装器已打开。 */
export async function installUpdatePackage(file: ApkFileInfo): Promise<void> {
  if (!apkUpdateSupported()) throw new Error('仅 Android 支持应用内安装');
  await Native.install({ path: file.path });
}

export async function openInstallPermissionSettings(): Promise<void> {
  await Native.openInstallSettings();
}
