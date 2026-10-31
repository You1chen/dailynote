import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_COURSE_TIME_COMBINATIONS, normalizeCourseTimeCombinations, PREFERENCES_KEY, PREFERENCES_CHANGED, type CourseTimeCombination } from '../utils/courseTimeCombinations';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserPreferences {
  // 网格偏好
  sleepStart: string;       // "HH:mm" 睡眠开始
  sleepEnd: string;         // "HH:mm" 睡眠结束
  hideSleepHours: boolean;  // 隐藏睡眠时段
  defaultDuration: number;  // 默认任务时长（分钟）
  hourHeight: number;       // 网格密度（px/小时）
  futureOnly: boolean;      // 只看未来：折叠当前小时之前的时间段
  courseTimeCombinations: CourseTimeCombination[];
  // 外观
  theme: ThemeMode;         // 浅色 / 深色 / 跟随系统
  // 用户信息
  username: string;
  avatar: string;           // emoji 字符或 data:image 图片（裁剪后约 20-55KB）
}

const STORAGE_KEY = PREFERENCES_KEY;

const DEFAULTS: UserPreferences = {
  sleepStart: '23:00',
  sleepEnd: '07:00',
  hideSleepHours: true,
  defaultDuration: 60,
  hourHeight: 64,
  futureOnly: false,
  courseTimeCombinations: DEFAULT_COURSE_TIME_COMBINATIONS,
  theme: 'system',
  username: '',
  avatar: '👤',
};

function loadPrefs(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed, courseTimeCombinations: normalizeCourseTimeCombinations(parsed?.courseTimeCombinations) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function savePrefs(prefs: UserPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>(loadPrefs);

  // 同步到其他 tab（可选）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setPrefs(loadPrefs());
        } catch { /* ignore */ }
      }
    };
    const onChanged = () => setPrefs(loadPrefs());
    window.addEventListener('storage', onStorage);
    window.addEventListener(PREFERENCES_CHANGED, onChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PREFERENCES_CHANGED, onChanged);
    };
  }, []);

  const updatePrefs = useCallback((partial: Partial<UserPreferences>) => {
    setPrefs(prev => {
      const next = { ...prev, ...partial };
      savePrefs(next);
      return next;
    });
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefs({ ...DEFAULTS });
    savePrefs({ ...DEFAULTS });
  }, []);

  return { prefs, updatePrefs, resetPrefs };
}
