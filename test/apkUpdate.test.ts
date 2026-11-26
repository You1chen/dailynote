import { describe, expect, it } from 'vitest';
import {
  apkKind,
  describeApk,
  formatSize,
  isCoverInstallable,
  kindLabel,
  pickAutoUpdate,
  pickBestApk,
  versionText,
  type ApkFileInfo,
  type InstalledAppInfo,
} from '../src/utils/apkUpdate';

const installed: InstalledAppInfo = {
  packageName: 'com.dailynote.app',
  versionCode: 6,
  versionName: '1.3.0',
  signerSha256: 'same-signature',
};

function apk(overrides: Partial<ApkFileInfo> = {}): ApkFileInfo {
  return {
    path: '/storage/emulated/0/Documents/DailyNote/DailyNote-1.4.0.apk',
    name: 'DailyNote-1.4.0.apk',
    size: 26_236_001,
    modified: 1_760_000_000_000,
    packageName: 'com.dailynote.app',
    versionCode: 7,
    versionName: '1.4.0',
    signerSha256: 'same-signature',
    samePackage: true,
    sameSignature: true,
    ...overrides,
  };
}

describe('update package rules', () => {
  it('only allows cover install for the same package and signature', () => {
    expect(isCoverInstallable(apk())).toBe(true);
    expect(isCoverInstallable(apk({ sameSignature: false }))).toBe(false);
    expect(isCoverInstallable(apk({ samePackage: false }))).toBe(false);
  });

  it('classifies newer, same, older and foreign packages', () => {
    expect(apkKind(apk({ versionCode: 7 }), installed)).toBe('newer');
    expect(apkKind(apk({ versionCode: 6 }), installed)).toBe('same');
    expect(apkKind(apk({ versionCode: 5 }), installed)).toBe('older');
    expect(apkKind(apk({ signerSha256: 'other', sameSignature: false }), installed)).toBe('foreign');
    expect(apkKind(apk({ packageName: 'other.app', samePackage: false }), installed)).toBe('foreign');
    expect(kindLabel('newer')).toBe('新版本');
    expect(kindLabel('foreign')).toBe('签名不一致');
  });

  it('prefers the highest installable version and ignores mismatched packages', () => {
    const files = [
      apk({ path: 'a', versionCode: 5, versionName: '1.2.0' }),
      apk({ path: 'b', versionCode: 7, versionName: '1.4.0' }),
      apk({ path: 'c', versionCode: 9, versionName: '1.5.0', sameSignature: false }),
      apk({ path: 'd', versionCode: 10, packageName: 'other.app', samePackage: false }),
    ];
    expect(pickBestApk(files, installed)?.path).toBe('b');
    expect(pickBestApk(files.filter(file => file.path === 'c'), installed)).toBeNull();
  });

  it('auto-prompts only for a newer, same-signature package', () => {
    const newer = apk({ path: 'newer', versionCode: 7 });
    const same = apk({ path: 'same', versionCode: 6 });
    const older = apk({ path: 'older', versionCode: 5 });
    const foreign = apk({ path: 'foreign', versionCode: 8, sameSignature: false });
    expect(pickAutoUpdate([same, older, foreign, newer], installed)?.path).toBe('newer');
    expect(pickAutoUpdate([same, older, foreign], installed)).toBeNull();
  });

  it('writes readable version, size and conclusion copy', () => {
    expect(versionText('1.3.0', 6)).toBe('1.3.0 (6)');
    expect(versionText('', 6)).toBe('#6');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(26_236_001)).toBe('25.0 MB');
    const newerCopy = describeApk(apk({ versionCode: 7, versionName: '1.4.0' }), installed);
    expect(newerCopy).toContain('1.4.0 (7)');
    expect(newerCopy).toContain('1.3.0 (6)');
    expect(newerCopy).toContain('本机数据保留');
    expect(describeApk(apk({ sameSignature: false }), installed)).toContain('签名');
  });
});
