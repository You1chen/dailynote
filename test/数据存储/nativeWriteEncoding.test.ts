/**
 * Android 原生写入必须带 encoding: 'utf8'（回归测试）
 *
 * 背景（真机事故）：Capacitor 8 的 ionfilesystem-android 在 writeFile 缺省 encoding 时
 * 把 data 当 base64 宽容解码（substringAfter(",") 后跳过非法字符），JSON 文本被写成
 * 乱码二进制——盘上文件全是乱码，重装后自然读不回；导出备份同样是乱码，导入报
 * 「无效的数据文件格式」。本测试锁定：原生写路径必须显式传 encoding，data 必须是
 * JSON 文本本身。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 记录 Filesystem.writeFile 的每次调用（原生路径）
const writeFileCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: async (opts: Record<string, unknown>) => { writeFileCalls.push(opts); },
    readFile: async () => ({ data: null }),
    readdir: async () => ({ files: [] }),
    deleteFile: async () => { /* 无文件可删 */ },
  },
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}));

import {
  initStore,
  setStoragePath,
  flush,
  exportBackupFile,
  _resetForTest,
} from '../../src/services/store';
import * as db from '../../src/db';
import type { LongTermGoal } from '../../src/types';

// ---- 模拟 localStorage（Node 环境没有）----
const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = v; },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
};

function makeGoal(title: string): LongTermGoal {
  return { title, description: '', category: '学习', tasks: [], createdAt: 1, updatedAt: 1 } as LongTermGoal;
}

beforeEach(async () => {
  // 模拟原生环境：isNativePlatform() = true → 走 Capacitor Filesystem
  (globalThis as any).window = { Capacitor: { isNativePlatform: () => true } };
  writeFileCalls.length = 0;
  await _resetForTest();
  (globalThis as any).localStorage.clear();
  setStoragePath('DailyNote');
  await initStore();
});

describe('Android 原生写入编码', () => {
  it('增量写盘必须带 encoding: utf8，且 data 是 JSON 文本本身（不是 base64）', async () => {
    await db.saveGoal(makeGoal('编码回归'));
    await flush();

    expect(writeFileCalls.length).toBeGreaterThan(0);
    const call = writeFileCalls[writeFileCalls.length - 1];
    expect(call.encoding).toBe('utf8');
    expect(call.directory).toBe('DOCUMENTS');

    // data 必须是 JSON 文本：以 [ 开头、可解析、包含原始中文
    const data = call.data as string;
    expect(data.startsWith('[')).toBe(true);
    const parsed = JSON.parse(data) as Array<{ title: string }>;
    expect(parsed[0].title).toBe('编码回归');
  });

  it('导出备份文件同样带 encoding: utf8', async () => {
    const name = await exportBackupFile();
    expect(name).toMatch(/^Documents\/DailyNote\/dailynote-backup-.*\.json$/);

    expect(writeFileCalls.length).toBeGreaterThan(0);
    const call = writeFileCalls[writeFileCalls.length - 1];
    expect(call.encoding).toBe('utf8');

    const data = call.data as string;
    expect(data.startsWith('{')).toBe(true);
    expect(JSON.parse(data)).toHaveProperty('version', 1);
  });
});
