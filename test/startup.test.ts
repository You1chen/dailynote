import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyDb } from '../src/db/legacy';
import { initializeStartup } from '../src/services/startup';
import { _resetForTest, getStoragePath, getStore, setStoragePath } from '../src/services/store';

const native = vi.hoisted(() => ({ apiLevel: 34, manager: false, getStorageStatus: vi.fn() }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => native }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readdir: async () => ({ files: [] }),
    readFile: async () => { throw new Error('File does not exist'); },
  },
}));

async function seedWebFile(key: string, text: string) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('dailynote_kv', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(text, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

beforeEach(async () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  });
  native.manager = false;
  native.getStorageStatus.mockReset().mockImplementation(async () => native);
  await _resetForTest();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('startup', () => {
  it('starts Web automatically on the default path', async () => {
    localStorage.setItem('unrelated-site-preference', '1');
    expect(getStoragePath()).toBe('Documents/DailyNote');
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: -1 });
    expect(native.getStorageStatus).not.toHaveBeenCalled();
  });

  it('retains a saved custom path even if the store is empty', async () => {
    setStoragePath('Documents/MyNotes');
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: -1 });
    expect(getStoragePath()).toBe('Documents/MyNotes');
  });

  it('restores existing data from the default location', async () => {
    const plan = { date: '2026-11-19', timeBlocks: [], createdAt: 1, updatedAt: 1 };
    await seedWebFile(`days/${plan.date}/plan.json`, JSON.stringify(plan));
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: 1 });
    expect(getStore().dailyPlans).toEqual([plan]);
  });

  it.each([
    ['semester.json', '[]'],
    ['garden-keys.json', '[]'],
    ['dailynote-data', '{broken'],
    ['dailynote-backup-example.json', '{}'],
  ])('does not count an existing file as a fresh install: %s', async (key, value) => {
    await seedWebFile(key, value);
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: 0 });
  });

  it('recognizes an existing empty legacy database as previous state', async () => {
    await legacyDb.open();
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: 0 });
  });

  it('waits for Android storage access before reading data', async () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    expect(await initializeStartup()).toEqual({ phase: 'storagePermission' });
    native.manager = true;
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: -1 });
  });
});
