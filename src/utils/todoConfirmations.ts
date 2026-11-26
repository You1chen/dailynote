import { PREFERENCES_KEY } from './courseTimeCombinations';

export interface TodoConfirmations {
  startTimer: boolean;
  stopTimer: boolean;
  moveToBacklog: boolean;
}

export const DEFAULT_TODO_CONFIRMATIONS: TodoConfirmations = {
  startTimer: true,
  stopTimer: true,
  moveToBacklog: true,
};

export function normalizeTodoConfirmations(input: Partial<TodoConfirmations> | null | undefined): TodoConfirmations {
  return {
    startTimer: input?.startTimer !== false,
    stopTimer: input?.stopTimer !== false,
    moveToBacklog: input?.moveToBacklog !== false,
  };
}

export function readTodoConfirmations(): TodoConfirmations {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    return normalizeTodoConfirmations(raw ? JSON.parse(raw)?.todoConfirmations : undefined);
  } catch {
    return DEFAULT_TODO_CONFIRMATIONS;
  }
}
