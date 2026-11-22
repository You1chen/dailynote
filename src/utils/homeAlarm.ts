export const HOME_ALARM_STORAGE_KEY = 'dailynote_home_alarm';
export const DEFAULT_ALARM_PAUSE_MINUTES = 60;
const MINUTE_MS = 60_000;

export interface HomeAlarmPreference {
  flashDisabled: boolean;
  pausedUntil: number;
}

const DEFAULT_PREFERENCE: HomeAlarmPreference = { flashDisabled: false, pausedUntil: 0 };

type AlarmStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadAlarmPreference(storage?: Pick<AlarmStorage, 'getItem'>): HomeAlarmPreference {
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(HOME_ALARM_STORAGE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      return {
        flashDisabled: saved.flashDisabled === true,
        pausedUntil: Number.isSafeInteger(saved.pausedUntil) && saved.pausedUntil > 0 ? saved.pausedUntil : 0,
      };
    }
  } catch { /* Use defaults when storage is unavailable or malformed. */ }
  return DEFAULT_PREFERENCE;
}

export function saveAlarmPreference(preference: HomeAlarmPreference, storage?: Pick<AlarmStorage, 'setItem'>) {
  try {
    (storage ?? localStorage).setItem(HOME_ALARM_STORAGE_KEY, JSON.stringify(preference));
  } catch { /* The current session can still use the new setting. */ }
}

export function alarmPauseDeadline(value: string, now: number): number | undefined {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1) return;
  const deadline = now + minutes * MINUTE_MS;
  // Date's range is narrower than the range of safe integers.
  if (Number.isSafeInteger(deadline) && deadline <= 8.64e15) return deadline;
}

export function alarmFlashState(preference: HomeAlarmPreference, now: number) {
  if (preference.flashDisabled) return 'disabled';
  return preference.pausedUntil > now ? 'paused' : 'active';
}
