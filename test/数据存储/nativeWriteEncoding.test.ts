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

// 记录 Filesystem.writeFile 的每次调用（原生路径）+ 内存文件盘（模拟磁盘）
const writeFileCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const memFiles = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: async (opts: Record<string, unknown>) => {
      writeFileCalls.push(opts);
      memFiles.set(opts.path as string, opts.data as string);
    },
    readFile: async (opts: Record<string, unknown>) => ({ data: memFiles.get(opts.path as string) ?? null }),
    readdir: async (opts: Record<string, unknown>) => {
      // 模拟磁盘目录：列出 path 下的直接子项（子目录按前缀推导）
      const prefix = `${opts.path as string}/`;
      const names = new Set<string>();
      for (const k of memFiles.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const seg = rest.split('/')[0];
        if (seg) names.add(seg);
      }
      return { files: [...names].map(name => ({ name, type: 'directory' as const })) };
    },
    deleteFile: async (opts: Record<string, unknown>) => { memFiles.delete(opts.path as string); },
  },
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}));

import {
  initStore,
  setStoragePath,
  flush,
  _resetForTest,
  getPreferences,
  updatePreferences,
} from '../../src/services/store';
import * as db from '../../src/db';
import type { DailyPlan, LongTermGoal } from '../../src/types';

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
  memFiles.clear();
  await _resetForTest();
  (globalThis as any).localStorage.clear();
  setStoragePath('DailyNote');
  await initStore();
});

describe('Android 原生写入编码', () => {
  it('把旧的本地偏好写成 UTF-8 preferences.json，并且只有偏好的目录也能启动', async () => {
    const legacy = { hourHeight: 72, defaultDuration: 45 };
    localStorage.setItem('dailynote_preferences', JSON.stringify(legacy));
    expect(await initStore()).toBe(0);
    expect(localStorage.getItem('dailynote_preferences')).toBeNull();
    expect(writeFileCalls.at(-1)).toMatchObject({ path: 'DailyNote/preferences.json', encoding: 'utf8' });
    expect(JSON.parse(memFiles.get('DailyNote/preferences.json')!)).toMatchObject(legacy);

    // 自定义路径兼容：换到只有 preferences.json 的目录，直接读该目录的偏好
    memFiles.set('OtherNotes/preferences.json', JSON.stringify({ hourHeight: 90 }));
    setStoragePath('OtherNotes');
    expect(await initStore()).toBe(0);
    expect(getPreferences()).toMatchObject({ hourHeight: 90 });
    expect(await updatePreferences({ defaultDuration: 60 })).toBe(true);
    expect(JSON.parse(memFiles.get('OtherNotes/preferences.json')!)).toMatchObject({ hourHeight: 90, defaultDuration: 60 });
  });
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

  it('原生后端完整往返：写盘 → 重置内存 → 从「磁盘」读回数据一致', async () => {
    // 通过内存文件盘模拟真实磁盘：写入的每个文件都落盘，重置后必须能读回
    await db.saveGoal(makeGoal('往返目标'));
    await db.savePlan({ date: '2026-08-13', timeBlocks: [], createdAt: 1, updatedAt: 1 } as DailyPlan);
    await flush();

    // 磁盘上应有 days/2026-08-13/plan.json 与 goals.json，且都是合法 JSON 文本
    const planText = memFiles.get('DailyNote/days/2026-08-13/plan.json');
    const goalsText = memFiles.get('DailyNote/goals.json');
    expect(planText).toBeDefined();
    expect(JSON.parse(planText!)).toHaveProperty('date', '2026-08-13');
    expect(JSON.parse(goalsText!)).toHaveLength(1);

    // 模拟重装：内存清零，从磁盘重新加载
    await _resetForTest();
    await initStore();

    const goals = await db.getAllGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0].title).toBe('往返目标');
    const plan = await db.getPlanByDate('2026-08-13');
    expect(plan).toBeDefined();
  });
});
