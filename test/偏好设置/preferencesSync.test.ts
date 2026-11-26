import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ subscriptions: [] as (() => void)[] }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: <T>(subscribe: (listener: () => void) => () => void, getSnapshot: () => T) => {
    const listener = vi.fn(() => getSnapshot());
    hooks.subscriptions.push(subscribe(listener));
    return { snapshot: getSnapshot(), listener };
  },
}));
import { usePreferences } from '../../src/hooks/usePreferences';
import { _resetForTest, initStore } from '../../src/services/store';
import type { UserPreferences } from '../../src/types/preferences';

beforeEach(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  await _resetForTest();
  await initStore();
});
afterEach(() => {
  for (const unsubscribe of hooks.subscriptions.splice(0)) unsubscribe();
  vi.unstubAllGlobals();
});

function renderPreferences() {
  const { prefs, updatePrefs, resetPrefs } = usePreferences();
  const { snapshot, listener } = prefs as unknown as { snapshot: UserPreferences; listener: ReturnType<typeof vi.fn> };
  return { prefs: snapshot, listener, updatePrefs, resetPrefs };
}

describe('shared preferences', () => {
  it('notifies every mounted consumer and merges updates from independent callers', async () => {
    const first = renderPreferences();
    const second = renderPreferences();
    const firstWrite = first.updatePrefs({ defaultDuration: 30, hourHeight: 48 });
    expect(second.listener).toHaveLastReturnedWith(expect.objectContaining({ defaultDuration: 30, hourHeight: 48 }));
    const secondWrite = second.updatePrefs({ futureOnly: true });
    expect(first.listener).toHaveLastReturnedWith(expect.objectContaining({ defaultDuration: 30, futureOnly: true }));
    expect(await Promise.all([firstWrite, secondWrite])).toEqual([true, true]);
  });

  it('publishes the default settings on reset', async () => {
    const first = renderPreferences();
    const second = renderPreferences();
    await first.updatePrefs({ futureOnly: true, defaultDuration: 15 });
    await first.resetPrefs();
    expect(second.listener).toHaveLastReturnedWith(expect.objectContaining({ futureOnly: false, defaultDuration: 60 }));
  });
});
