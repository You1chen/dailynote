import { getPreferences } from '../services/store';
export type { TodoConfirmations } from '../types/preferences';
export { DEFAULT_TODO_CONFIRMATIONS } from './preferenceValues';

export function readTodoConfirmations() {
  return getPreferences().todoConfirmations;
}
