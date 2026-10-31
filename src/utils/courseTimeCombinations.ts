export interface CourseTimeCombination {
  startTime: string;
  endTime: string;
}

export const PREFERENCES_KEY = 'dailynote_preferences';
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

export function loadCourseTimeCombinations(): CourseTimeCombination[] {
  try {
    return normalizeCourseTimeCombinations(JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}').courseTimeCombinations);
  } catch {
    return normalizeCourseTimeCombinations(undefined);
  }
}

/** Used by backup import without changing unrelated preferences. */
export function saveCourseTimeCombinations(value: unknown): void {
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') || {}; } catch { /* use defaults */ }
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
    ...prefs, courseTimeCombinations: normalizeCourseTimeCombinations(value),
  }));
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(PREFERENCES_CHANGED));
  }
}
