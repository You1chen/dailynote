/**
 * 应用内更新的纯逻辑：版本比较、签名/包名校验结果的展示文案与选择。
 *
 * 原生侧只负责读出「当前版本」和「目录里 APK 的包名、版本、签名」，
 * 这里决定哪些包可以覆盖安装、界面上怎么写，便于单元测试。
 */

export interface InstalledAppInfo {
  packageName: string;
  versionCode: number;
  versionName: string;
  signerSha256: string;
}

export interface ApkFileInfo {
  path: string;
  name: string;
  size: number;
  modified: number;
  packageName: string;
  versionCode: number;
  versionName: string;
  signerSha256: string;
  samePackage: boolean;
  sameSignature: boolean;
}

export type ApkKind = 'newer' | 'same' | 'older' | 'foreign';

/** 只有同包名且同签名才能被系统原地覆盖安装。 */
export function isCoverInstallable(file: ApkFileInfo): boolean {
  return file.samePackage && file.sameSignature;
}

export function apkKind(file: ApkFileInfo, installed: InstalledAppInfo): ApkKind {
  if (!isCoverInstallable(file)) return 'foreign';
  if (file.versionCode > installed.versionCode) return 'newer';
  if (file.versionCode === installed.versionCode) return 'same';
  return 'older';
}

export function kindLabel(kind: ApkKind): string {
  switch (kind) {
    case 'newer': return '新版本';
    case 'same': return '同版本';
    case 'older': return '更旧';
    default: return '签名不一致';
  }
}

/** 版本号展示：没有 versionName 时退回 versionCode。 */
export function versionText(versionName: string, versionCode: number): string {
  const name = (versionName || '').trim();
  return name ? `${name} (${versionCode})` : `#${versionCode}`;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function newestFirst(a: ApkFileInfo, b: ApkFileInfo): number {
  return b.versionCode - a.versionCode || b.modified - a.modified;
}

/**
 * 对话框默认选中的包：优先版本号最高、签名一致的包；
 * 没有可覆盖安装的包时返回 null。
 */
export function pickBestApk(files: readonly ApkFileInfo[], installed: InstalledAppInfo): ApkFileInfo | null {
  const usable = files.filter(isCoverInstallable).slice().sort(newestFirst);
  if (usable.length === 0) return null;
  return usable[0] ?? null;
}

/**
 * 启动时自动弹窗的条件：存在比当前版本更高、同包名同签名的安装包。
 * 同版本或更旧的包只在设置里手动安装，避免每次启动都打扰。
 */
export function pickAutoUpdate(files: readonly ApkFileInfo[], installed: InstalledAppInfo): ApkFileInfo | null {
  const newer = files
    .filter(file => isCoverInstallable(file) && file.versionCode > installed.versionCode)
    .slice()
    .sort(newestFirst);
  return newer[0] ?? null;
}

/** 对话框里的结论句。 */
export function describeApk(file: ApkFileInfo, installed: InstalledAppInfo): string {
  const kind = apkKind(file, installed);
  if (kind === 'foreign') {
    return file.samePackage
      ? '签名与当前应用不一致，不能覆盖安装。'
      : '包名不是 DailyNote，不能安装。';
  }
  const target = versionText(file.versionName, file.versionCode);
  const current = versionText(installed.versionName, installed.versionCode);
  if (kind === 'newer') return `签名一致：将从 ${current} 覆盖安装到 ${target}，本机数据保留。`;
  if (kind === 'same') return `签名一致：将用同版本 ${target} 覆盖重装，本机数据保留。`;
  return `签名一致：这个包是 ${target}，比当前的 ${current} 更旧。`;
}
