import { useSyncExternalStore } from 'react';
import { getPreferences, resetPreferences, subscribePreferences, updatePreferences } from '../services/store';
export type { UserPreferences } from '../types/preferences';

export function usePreferences() {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences, getPreferences);
  return { prefs, updatePrefs: updatePreferences, resetPrefs: resetPreferences };
}
