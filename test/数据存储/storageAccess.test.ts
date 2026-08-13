/**
 * Android 存储权限守卫（所有文件访问 / MANAGE_EXTERNAL_STORAGE）
 *
 * 背景：Android 11+ 未授权时，公共 Documents 的读写必然被系统拒绝。
 * 守卫必须保证：被阻塞时 initStore 不动内存 store、不做任何写入
 * （否则会把磁盘数据误判为空，随后把空数组写回覆盖磁盘）。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 模拟原生 DailyNoteStorage 插件（registerPlugin 返回可控桩）
const statusStub = vi.hoisted(() => ({ apiLevel: 0, manager: true }));
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    getStorageStatus: async () => statusStub,
    requestAllFilesAccess: async () => ({ granted: statusStub.manager }),
  }),
}));

import {
  storageAccessBlocked,
  requestAllFilesAccess,
  initStore,
  INIT_STORAGE_BLOCKED,
  getStore,
  _resetForTest,
} from '../../src/services/store';

// ---- 模拟 localStorage（Node 环境没有）----
const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = v; },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
};

beforeEach(async () => {
  // 模拟原生环境：isNativePlatform() = true
  (globalThis as any).window = { Capacitor: { isNativePlatform: () => true } };
  statusStub.apiLevel = 0;
  statusStub.manager = true;
  await _resetForTest();
  (globalThis as any).localStorage.clear();
});

describe('storageAccessBlocked', () => {
  it('Android 11+ 未授权「所有文件访问」→ 阻塞', async () => {
    statusStub.apiLevel = 34;
    statusStub.manager = false;
    expect(await storageAccessBlocked()).toBe(true);
  });

  it('Android 11+ 已授权 → 不阻塞', async () => {
    statusStub.apiLevel = 34;
    statusStub.manager = true;
    expect(await storageAccessBlocked()).toBe(false);
  });

  it('Android 10 无 AFA 概念（走运行时权限对话框）→ 不阻塞', async () => {
    statusStub.apiLevel = 29;
    statusStub.manager = false;
    expect(await storageAccessBlocked()).toBe(false);
  });

  it('插件缺失（如 Web 端）→ 不阻塞', async () => {
    delete (globalThis as any).window;
    expect(await storageAccessBlocked()).toBe(false);
  });
});

describe('initStore 权限守卫', () => {
  it('被阻塞时返回 INIT_STORAGE_BLOCKED，内存 store 保持为空且不写任何文件', async () => {
    statusStub.apiLevel = 34;
    statusStub.manager = false;

    expect(await initStore()).toBe(INIT_STORAGE_BLOCKED);

    const s = getStore();
    expect(s.dailyPlans).toHaveLength(0);
    expect(s.longTermGoals).toHaveLength(0);
    expect(s.trashItems).toHaveLength(0);
    expect(localStorage.getItem('dailynote_storage_path')).toBeNull();
  });

  it('授权后重新 initStore 正常返回（-1 = 无数据）', async () => {
    statusStub.apiLevel = 34;
    statusStub.manager = false;
    expect(await initStore()).toBe(INIT_STORAGE_BLOCKED);

    statusStub.manager = true;
    expect(await initStore()).toBe(-1);
  });
});

describe('requestAllFilesAccess', () => {
  it('未授权时返回 false（用户需去系统设置页返回后重新检测）', async () => {
    statusStub.apiLevel = 34;
    statusStub.manager = false;
    expect(await requestAllFilesAccess()).toBe(false);
  });

  it('已授权时返回 true', async () => {
    statusStub.apiLevel = 34;
    statusStub.manager = true;
    expect(await requestAllFilesAccess()).toBe(true);
  });
});
