import type { HomeAlarmPreference } from '../types/preferences';
export type { HomeAlarmPreference } from '../types/preferences';

export const DEFAULT_ALARM_PAUSE_MINUTES = 60;
const MINUTE_MS = 60_000;

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
