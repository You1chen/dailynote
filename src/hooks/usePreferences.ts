import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserPreferences {
  // 网格偏好
  sleepStart: string;       // "HH:mm" 睡眠开始
  sleepEnd: string;         // "HH:mm" 睡眠结束
  hideSleepHours: boolean;  // 隐藏睡眠时段
  defaultDuration: number;  // 默认任务时长（分钟）
  hourHeight: number;       // 网格密度（px/小时）
  // 外观
  theme: ThemeMode;         // 浅色 / 深色 / 跟随系统
  // 用户信息
  username: string;
  avatar: string;           // emoji 字符或 data:image 图片（裁剪后约 20-55KB）
}

const STORAGE_KEY = 'dailynote_preferences';

const DEFAULTS: UserPreferences = {
  sleepStart: '23:00',
  sleepEnd: '07:00',
  hideSleepHours: true,
  defaultDuration: 60,
  hourHeight: 64,
  theme: 'system',
  username: '',
  avatar: '👤',
};

function loadPrefs(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
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
          setPrefs({ ...DEFAULTS, ...JSON.parse(e.newValue) });
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
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
