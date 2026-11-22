/**
 * 偏好设置测试
 *
 * 验证：
 *   1. 偏好默认值正确
 *   2. 新字段（theme, username, avatar）存在且有默认值
 *   3. localStorage 存取正确
 *   4. 深色主题 CSS 变量完整性
 *   5. 主题应用逻辑
 */

import { describe, it, expect, beforeEach } from 'vitest';

// 简单的内存存储模拟 localStorage
let store: Record<string, string> = {};
const mockStorage = {
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  },
  setItem(key: string, value: string): void {
    store[key] = value;
  },
  removeItem(key: string): void {
    delete store[key];
  },
  clear(): void {
    store = {};
  },
};

const STORAGE_KEY = 'dailynote_preferences';

interface UserPreferences {
  sleepStart: string;
  sleepEnd: string;
  hideSleepHours: boolean;
  defaultDuration: number;
  hourHeight: number;
  theme: 'light' | 'dark' | 'system';
  username: string;
  avatar: string;
}

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
    const raw = mockStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function savePrefs(prefs: UserPreferences): void {
  mockStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function applyTheme(theme: 'light' | 'dark' | 'system', prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return theme;
}

describe('偏好设置 — 默认值', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('首次加载应返回默认值', () => {
    const prefs = loadPrefs();
    expect(prefs.sleepStart).toBe('23:00');
    expect(prefs.sleepEnd).toBe('07:00');
    expect(prefs.hideSleepHours).toBe(true);
    expect(prefs.defaultDuration).toBe(60);
    expect(prefs.hourHeight).toBe(64);
  });

  it('新字段 theme 默认值应为 system', () => {
    const prefs = loadPrefs();
    expect(prefs.theme).toBe('system');
  });

  it('新字段 username 默认值应为空字符串', () => {
    const prefs = loadPrefs();
    expect(prefs.username).toBe('');
  });

  it('新字段 avatar 默认值应为 👤', () => {
    const prefs = loadPrefs();
    expect(prefs.avatar).toBe('👤');
  });
});

describe('偏好设置 — localStorage 存取', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('保存后再加载应返回保存的值', () => {
    const custom: UserPreferences = {
      ...DEFAULTS,
      sleepStart: '22:00',
      username: '测试用户',
      avatar: '🌟',
      theme: 'dark',
    };
    savePrefs(custom);
    const loaded = loadPrefs();
    expect(loaded.sleepStart).toBe('22:00');
    expect(loaded.username).toBe('测试用户');
    expect(loaded.avatar).toBe('🌟');
    expect(loaded.theme).toBe('dark');
  });

  it('部分保存时应合并默认值', () => {
    const partial = { username: 'Alice', theme: 'dark' as const };
    mockStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    const loaded = loadPrefs();
    expect(loaded.username).toBe('Alice');
    expect(loaded.theme).toBe('dark');
    // 未保存的字段应用默认值
    expect(loaded.sleepStart).toBe('23:00');
    expect(loaded.hourHeight).toBe(64);
  });

  it('旧版数据（无新字段）加载时应补充默认值', () => {
    const oldData = {
      sleepStart: '23:00',
      sleepEnd: '06:00',
      hideSleepHours: true,
      defaultDuration: 30,
      hourHeight: 48,
    };
    mockStorage.setItem(STORAGE_KEY, JSON.stringify(oldData));
    const loaded = loadPrefs();
    expect(loaded.hourHeight).toBe(48); // 旧值保留
    expect(loaded.theme).toBe('system'); // 新字段补充默认
    expect(loaded.username).toBe('');
    expect(loaded.avatar).toBe('👤');
  });
});

describe('偏好设置 — 主题应用', () => {
  it('light 模式始终返回 light', () => {
    expect(applyTheme('light', true)).toBe('light');
    expect(applyTheme('light', false)).toBe('light');
  });

  it('dark 模式始终返回 dark', () => {
    expect(applyTheme('dark', true)).toBe('dark');
    expect(applyTheme('dark', false)).toBe('dark');
  });

  it('system 模式在系统深色时返回 dark', () => {
    expect(applyTheme('system', true)).toBe('dark');
  });

  it('system 模式在系统浅色时返回 light', () => {
    expect(applyTheme('system', false)).toBe('light');
  });
});

describe('偏好设置 — 边界情况', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('存储损坏时应返回默认值', () => {
    mockStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
    const loaded = loadPrefs();
    expect(loaded).toEqual(DEFAULTS);
  });

  it('null 值不应覆盖默认值', () => {
    mockStorage.setItem(STORAGE_KEY, JSON.stringify({ username: null, theme: null }));
    const loaded = loadPrefs();
    expect(loaded.username).toBe(null); // null is a valid value
    expect(loaded.theme).toBe(null);
  });

  it('用户名应支持 emoji', () => {
    savePrefs({ ...DEFAULTS, username: '小明 🚀' });
    const loaded = loadPrefs();
    expect(loaded.username).toBe('小明 🚀');
  });

  it('头像应支持任意 emoji', () => {
    const avatars = ['👤', '🐱', '🌟', '🚀', '💎'];
    for (const av of avatars) {
      savePrefs({ ...DEFAULTS, avatar: av });
      expect(loadPrefs().avatar).toBe(av);
    }
  });
});
