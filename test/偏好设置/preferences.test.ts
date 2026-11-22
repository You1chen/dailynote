import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeStartup } from '../../src/services/startup';
import { _resetForTest, exportJSON, getPreferences, importJSONIntoStore, initStore, resetPreferences, storeHasData, updatePreferences } from '../../src/services/store';
import type { UserPreferences } from '../../src/types/preferences';
import { defaultPreferences, LEGACY_HOME_ALARM_KEY, LEGACY_PREFERENCES_KEY } from '../../src/utils/preferenceValues';
import { loadCourseTimeCombinations } from '../../src/utils/courseTimeCombinations';
import { readTodoConfirmations } from '../../src/utils/todoConfirmations';

const custom: UserPreferences = {
  sleepStart: '22:15', sleepEnd: '06:45', hideSleepHours: false, defaultDuration: 30,
  hourHeight: 80, futureOnly: true, theme: 'dark', username: '小明 🚀',
  avatar: 'data:image/webp;base64,UklGRg==', courseTimeCombinations: [{ startTime: '12:20', endTime: '13:30' }],
  todoConfirmations: { startTimer: false, stopTimer: true, moveToBacklog: false },
  homeAlarm: { flashDisabled: false, pausedUntil: 1_900_000_000_000 },
};

let legacy: Map<string, string>;
beforeEach(async () => {
  legacy = new Map();
  vi.stubGlobal('localStorage', {
    get length() { return legacy.size; },
    key: (index: number) => [...legacy.keys()][index] ?? null,
    getItem: (key: string) => legacy.get(key) ?? null,
    removeItem: (key: string) => { legacy.delete(key); },
  });
  await _resetForTest();
});
afterEach(() => vi.unstubAllGlobals());

async function preferencesFile(): Promise<UserPreferences | undefined> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open('dailynote_kv', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const query = db.transaction('kv', 'readonly').objectStore('kv').get('preferences.json');
      query.onsuccess = () => { db.close(); resolve(query.result === undefined ? undefined : JSON.parse(query.result)); };
      query.onerror = () => { db.close(); reject(query.error); };
    };
  });
}

const importBackup = (extras: object) => importJSONIntoStore(JSON.stringify({ version: 1, dailyPlans: [], ...extras }));

describe('Web preference storage', () => {
  it('keeps fresh install defaults in memory and allows onboarding', async () => {
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: -1, showOnboarding: true });
    expect(getPreferences()).toMatchObject({ theme: 'system', username: '', avatar: '👤', defaultDuration: 60 });
    expect(await preferencesFile()).toBeUndefined();
  });

  it('migrates all legacy localStorage settings before startup and removes the old key', async () => {
    const { homeAlarm, ...oldPrefs } = custom;
    legacy.set(LEGACY_PREFERENCES_KEY, JSON.stringify(oldPrefs));
    legacy.set(LEGACY_HOME_ALARM_KEY, JSON.stringify(homeAlarm));
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: 0, showOnboarding: false });
    expect(getPreferences()).toEqual(custom);
    expect(await preferencesFile()).toEqual(custom);
    expect(legacy.has(LEGACY_PREFERENCES_KEY)).toBe(false);
    expect(legacy.has(LEGACY_HOME_ALARM_KEY)).toBe(false);
    expect(await storeHasData()).toBe(true);

    legacy.set(LEGACY_PREFERENCES_KEY, '{"username":"stale local value","avatar":"🐱"}');
    expect(await initStore()).toBe(0);
    expect(getPreferences()).toEqual(custom);
    expect(legacy.has(LEGACY_PREFERENCES_KEY)).toBe(false);
  });

  it('round trips all fields through a backup to an empty Web store', async () => {
    await initStore();
    expect(await updatePreferences(custom)).toBe(true);
    const backup = exportJSON();
    expect(JSON.parse(backup).preferences).toEqual(custom);
    await _resetForTest();
    await initStore();
    expect(getPreferences()).toEqual(defaultPreferences());
    expect(await importJSONIntoStore(backup)).toBe(0);
    expect(getPreferences()).toEqual(custom);
    expect(await preferencesFile()).toEqual(custom);
    expect(loadCourseTimeCombinations()).toEqual(custom.courseTimeCombinations);
    expect(readTodoConfirmations()).toEqual(custom.todoConfirmations);
    expect(await initStore()).toBe(0);
    expect(getPreferences()).toEqual(custom);
  });

  it('preserves unrelated choices for old or partial backups and accepts explicitly empty values', async () => {
    await updatePreferences(custom);
    await importBackup({});
    expect(getPreferences()).toEqual(custom);
    await importBackup({ courseTimeCombinations: [] });
    expect(getPreferences()).toEqual({ ...custom, courseTimeCombinations: [] });
    await importBackup({ preferences: { username: '', avatar: '🐱', theme: null, defaultDuration: -1, todoConfirmations: { stopTimer: false } } });
    expect(getPreferences()).toEqual({
      ...custom, username: '', avatar: '🐱', courseTimeCombinations: [],
      todoConfirmations: { startTimer: false, stopTimer: false, moveToBacklog: false },
    });
    await resetPreferences();
    expect(await preferencesFile()).toEqual(defaultPreferences());
  });
});
