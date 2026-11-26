export interface CourseTimeCombination {
  startTime: string;
  endTime: string;
}

export interface TodoConfirmations {
  startTimer: boolean;
  stopTimer: boolean;
  moveToBacklog: boolean;
}

export interface HomeAlarmPreference {
  flashDisabled: boolean;
  pausedUntil: number;
}

export interface UserPreferences {
  sleepStart: string;
  sleepEnd: string;
  hideSleepHours: boolean;
  defaultDuration: number;
  hourHeight: number;
  futureOnly: boolean;
  courseTimeCombinations: CourseTimeCombination[];
  todoConfirmations: TodoConfirmations;
  homeAlarm: HomeAlarmPreference;
}

export type PreferencesPatch = Partial<Omit<UserPreferences, 'todoConfirmations' | 'homeAlarm'>> & {
  todoConfirmations?: Partial<TodoConfirmations>;
  homeAlarm?: Partial<HomeAlarmPreference>;
};
