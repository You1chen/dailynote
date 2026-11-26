import type { CourseTimeCombination, PreferencesPatch, TodoConfirmations, UserPreferences } from '../types/preferences';

export const LEGACY_PREFERENCES_KEY = 'dailynote_preferences';
export const LEGACY_HOME_ALARM_KEY = 'dailynote_home_alarm';
export const PREFERENCES_CHANGED = 'dailynote-preferences-changed';

export const DEFAULT_COURSE_TIME_COMBINATIONS: CourseTimeCombination[] = [
  { startTime: '08:00', endTime: '09:40' },
  { startTime: '10:00', endTime: '11:00' },
  { startTime: '14:30', endTime: '17:05' },
];

export function isValidCourseTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/** One end time per start time keeps automatic matching unambiguous. */
export function normalizeCourseTimeCombinations(value: unknown): CourseTimeCombination[] {
  if (!Array.isArray(value)) return DEFAULT_COURSE_TIME_COMBINATIONS.map(pair => ({ ...pair }));
  const seen = new Set<string>();
  return value.filter((pair): pair is CourseTimeCombination => {
    if (!pair || typeof pair.startTime !== 'string' || typeof pair.endTime !== 'string'
      || !isValidCourseTime(pair.startTime) || !isValidCourseTime(pair.endTime)
      || pair.endTime <= pair.startTime || seen.has(pair.startTime)) return false;
    seen.add(pair.startTime);
    return true;
  }).map(({ startTime, endTime }) => ({ startTime, endTime }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export const DEFAULT_TODO_CONFIRMATIONS: TodoConfirmations = {
  startTimer: true,
  stopTimer: true,
  moveToBacklog: true,
};

export function defaultPreferences(): UserPreferences {
  return {
    sleepStart: '23:00',
    sleepEnd: '07:00',
    hideSleepHours: true,
    defaultDuration: 60,
    hourHeight: 64,
    futureOnly: false,
    courseTimeCombinations: normalizeCourseTimeCombinations(undefined),
    todoConfirmations: { ...DEFAULT_TODO_CONFIRMATIONS },
    homeAlarm: { flashDisabled: false, pausedUntil: 0 },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Validate known fields without filling missing ones so older backups can merge safely. */
export function parsePreferencesPatch(input: unknown): PreferencesPatch | undefined {
  const value = asRecord(input);
  if (!value) return undefined;
  const patch: PreferencesPatch = {};
  for (const key of ['sleepStart', 'sleepEnd'] as const) {
    const time = value[key];
    if (typeof time === 'string' && (time === '' || isValidCourseTime(time))) patch[key] = time;
  }
  for (const key of ['hideSleepHours', 'futureOnly'] as const) {
    const toggle = value[key];
    if (typeof toggle === 'boolean') patch[key] = toggle;
  }
  for (const key of ['defaultDuration', 'hourHeight'] as const) {
    const size = value[key];
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) patch[key] = size;
  }
  if (Array.isArray(value.courseTimeCombinations)) {
    patch.courseTimeCombinations = normalizeCourseTimeCombinations(value.courseTimeCombinations);
  }
  const todo = asRecord(value.todoConfirmations);
  if (todo) {
    const todoPatch: Partial<TodoConfirmations> = {};
    for (const key of ['startTimer', 'stopTimer', 'moveToBacklog'] as const) {
      const toggle = todo[key];
      if (typeof toggle === 'boolean') todoPatch[key] = toggle;
    }
    if (Object.keys(todoPatch).length) patch.todoConfirmations = todoPatch;
  }
  const alarm = asRecord(value.homeAlarm);
  if (alarm) {
    const { flashDisabled, pausedUntil } = alarm;
    const alarmPatch: NonNullable<PreferencesPatch['homeAlarm']> = {};
    if (typeof flashDisabled === 'boolean') alarmPatch.flashDisabled = flashDisabled;
    if (typeof pausedUntil === 'number' && Number.isSafeInteger(pausedUntil) && pausedUntil >= 0 && pausedUntil <= 8.64e15) {
      alarmPatch.pausedUntil = pausedUntil;
    }
    if (Object.keys(alarmPatch).length) patch.homeAlarm = alarmPatch;
  }
  return Object.keys(patch).length ? patch : undefined;
}

export function mergePreferences(base: UserPreferences, { todoConfirmations, homeAlarm, ...patch }: PreferencesPatch): UserPreferences {
  return {
    ...base,
    ...patch,
    todoConfirmations: todoConfirmations ? { ...base.todoConfirmations, ...todoConfirmations } : base.todoConfirmations,
    homeAlarm: homeAlarm ? { ...base.homeAlarm, ...homeAlarm } : base.homeAlarm,
  };
}
