import { getPreferences, updatePreferences } from '../services/store';
import { normalizeCourseTimeCombinations } from './preferenceValues';
export type { CourseTimeCombination } from '../types/preferences';
export { DEFAULT_COURSE_TIME_COMBINATIONS, isValidCourseTime, normalizeCourseTimeCombinations } from './preferenceValues';

export function loadCourseTimeCombinations() {
  return getPreferences().courseTimeCombinations;
}

export function saveCourseTimeCombinations(value: unknown): Promise<boolean> {
  return updatePreferences({ courseTimeCombinations: normalizeCourseTimeCombinations(value) });
}
