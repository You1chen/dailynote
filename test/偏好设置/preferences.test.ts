import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeStartup } from '../../src/services/startup';
import { _resetForTest, getPreferences, initStore, resetPreferences, updatePreferences } from '../../src/services/store';
import type { UserPreferences } from '../../src/types/preferences';
import { LEGACY_HOME_ALARM_KEY, LEGACY_PREFERENCES_KEY } from '../../src/utils/preferenceValues';
import { loadCourseTimeCombinations } from '../../src/utils/courseTimeCombinations';
import { readTodoConfirmations } from '../../src/utils/todoConfirmations';

const custom: UserPreferences = {
  sleepStart: '22:15', sleepEnd: '06:45', hideSleepHours: false, defaultDuration: 30,
  hourHeight: 80, futureOnly: true, courseTimeCombinations: [{ startTime: '12:20', endTime: '13:30' }],
  todoConfirmations: { startTimer: false, stopTimer: true, moveToBacklog: false },
  homeAlarm: { flashDisabled: false, pausedUntil: 1_900_000_000_000 },
};

/** 旧版本遗留的账号与主题字段，读入时应被丢弃。 */
const legacyExtras = { theme: 'dark', username: '小明 🚀', avatar: 'data:image/webp;base64,UklGRg==' };

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

describe('Web preference storage', () => {
  it('keeps fresh install defaults in memory', async () => {
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: -1 });
    expect(getPreferences()).toEqual({
      sleepStart: '23:00', sleepEnd: '07:00', hideSleepHours: true, defaultDuration: 60, hourHeight: 64,
      futureOnly: false, courseTimeCombinations: [
        { startTime: '08:00', endTime: '09:40' }, { startTime: '10:00', endTime: '11:00' }, { startTime: '14:30', endTime: '17:05' },
      ],
      todoConfirmations: { startTimer: true, stopTimer: true, moveToBacklog: true },
      homeAlarm: { flashDisabled: false, pausedUntil: 0 },
    });
    expect(await preferencesFile()).toBeUndefined();
  });

  it('migrates legacy settings before startup, drops retired fields and removes the old keys', async () => {
    const { homeAlarm, ...oldPrefs } = custom;
    legacy.set(LEGACY_PREFERENCES_KEY, JSON.stringify({ ...oldPrefs, ...legacyExtras }));
    legacy.set(LEGACY_HOME_ALARM_KEY, JSON.stringify(homeAlarm));
    expect(await initializeStartup()).toEqual({ phase: 'ready', count: 0 });
    expect(getPreferences()).toEqual(custom);
    expect(await preferencesFile()).toEqual(custom);
    expect(legacy.has(LEGACY_PREFERENCES_KEY)).toBe(false);
    expect(legacy.has(LEGACY_HOME_ALARM_KEY)).toBe(false);

    // A second start reads the saved file instead of re-importing stale local values.
    legacy.set(LEGACY_PREFERENCES_KEY, JSON.stringify({ ...oldPrefs, ...legacyExtras, defaultDuration: 15 }));
    expect(await initStore()).toBe(0);
    expect(getPreferences()).toEqual(custom);
  });

  it('writes preferences to the preferences file and feeds the derived helpers', async () => {
    await initStore();
    expect(await updatePreferences(custom)).toBe(true);
    expect(await preferencesFile()).toEqual(custom);
    expect(loadCourseTimeCombinations()).toEqual(custom.courseTimeCombinations);
    expect(readTodoConfirmations()).toEqual(custom.todoConfirmations);
  });

  it('restores defaults without touching stored content', async () => {
    await updatePreferences(custom);
    await resetPreferences();
    expect(await preferencesFile()).toEqual(getPreferences());
    expect(getPreferences().defaultDuration).toBe(60);
  });
});
