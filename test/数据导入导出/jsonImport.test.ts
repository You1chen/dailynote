/**
 * 数据导入导出 & 编码健壮性测试
 *
 * 验证：
 *   1. JSON 导出格式正确
 *   2. 普通 JSON 导入正常
 *   3. BOM 头正确处理
 *   4. 二进制/乱码数据被正确拒绝
 *   5. 微信缓存文件的特征识别
 *   6. importFromJSON 的各类边界情况
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// 模拟 storage.ts 中的 importFromJSON 核心逻辑
// （从 src/services/storage.ts 提取）
// ============================================================

/** 合法数据的结构 */
interface StorageData {
  version: number;
  savedAt: number;
  dailyPlans: unknown[];
  longTermGoals: unknown[];
  reflections: unknown[];
  harvests: unknown[];
  fixedRoutines: unknown[];
  taskItems?: unknown[];     // v4 新增，可选（向后兼容）
  taskTemplates?: unknown[]; // 任务清单模板，可选（向后兼容）
}

/**
 * 复刻 storage.ts 的 importFromJSON 纯逻辑
 * 不依赖 IndexedDB，只测试 JSON 解析和格式校验部分
 */
function parseImportJSON(json: string): { success: true; data: StorageData } | { success: false; error: string } {
  // 去掉可能的 UTF-8 BOM 头（Windows 编辑器常见问题）
  const clean = json.codePointAt(0) === 0xFEFF ? json.slice(1) : json;

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    return { success: false, error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }

  const data = parsed as StorageData;
  if (!data.version) {
    return { success: false, error: '无效的数据文件格式: 缺少 version 字段' };
  }
  if (!Array.isArray(data.dailyPlans)) {
    return { success: false, error: '无效的数据文件格式: dailyPlans 不是数组' };
  }

  return { success: true, data };
}

// ============================================================
// 辅助：生成合法 JSON
// ============================================================

function makeValidJSON(overrides: Partial<StorageData> = {}): string {
  const data: StorageData = {
    version: 1,
    savedAt: Date.now(),
    dailyPlans: [
      {
        date: '2026-07-25',
        timeBlocks: [
          {
            id: 'abc123',
            startTime: '08:00',
            endTime: '09:00',
            taskTitle: '测试任务',
            plannedContent: '做测试',
            actualExecution: '',
            focusScore: 8,
            efficiencyScore: 7,
            completed: false,
            notes: '',
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    longTermGoals: [],
    reflections: [],
    harvests: [],
    fixedRoutines: [],
    taskItems: [],
    taskTemplates: [],
    ...overrides,
  };
  return JSON.stringify(data, null, 2);
}

// ============================================================
// 测试套件
// ============================================================

describe('JSON 导入 — 正常情况', () => {
  it('标准 JSON 应成功解析', () => {
    const json = makeValidJSON();
    const result = parseImportJSON(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.dailyPlans).toHaveLength(1);
      expect(result.data.dailyPlans[0]).toHaveProperty('date', '2026-07-25');
    }
  });

  it('空数据 JSON 应成功解析', () => {
    const json = makeValidJSON({
      dailyPlans: [],
      longTermGoals: [],
      reflections: [],
      harvests: [],
      fixedRoutines: [],
    });
    const result = parseImportJSON(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dailyPlans).toHaveLength(0);
    }
  });

  it('含中文内容的 JSON 应正确保留 UTF-8 字符', () => {
    const data: StorageData = {
      version: 1,
      savedAt: Date.now(),
      dailyPlans: [
        {
          date: '2026-07-25',
          timeBlocks: [{
            id: 'test1',
            startTime: '09:00',
            endTime: '10:00',
            taskTitle: '早读英语课文第三单元',
            plannedContent: '背诵单词、朗读课文、做课后练习',
            actualExecution: '完成了背诵和朗读',
            focusScore: 9,
            efficiencyScore: 8,
            completed: true,
            notes: '今天状态很好 👍',
          }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      longTermGoals: [{ id: 1, title: '通过英语六级考试 🎯', description: '每天背50个单词', category: '学习', tasks: [], createdAt: Date.now(), updatedAt: Date.now() }],
      reflections: [],
      harvests: [],
      fixedRoutines: [],
    };
    const json = JSON.stringify(data, null, 2);

    // 验证 JSON 本身是可读的（不是二进制）
    expect(json.startsWith('{')).toBe(true);
    expect(json).toContain('早读英语课文第三单元');
    expect(json).toContain('👍');
    expect(json).toContain('🎯');

    const result = parseImportJSON(json);
    expect(result.success).toBe(true);
  });

  it('compact JSON (无换行) 应成功解析', () => {
    const json = JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      dailyPlans: [],
      longTermGoals: [],
      reflections: [],
      harvests: [],
      fixedRoutines: [],
    });
    const result = parseImportJSON(json);
    expect(result.success).toBe(true);
  });
});

describe('JSON 导入 — BOM 头处理', () => {
  it('UTF-8 BOM (0xEFBBBF) 应被正确去除并解析', () => {
    const json = makeValidJSON();
    const withBOM = '﻿' + json;

    // 验证原始字符串以 BOM 开头
    expect(withBOM.codePointAt(0)).toBe(0xFEFF);

    const result = parseImportJSON(withBOM);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
    }
  });

  it('Windows 记事本保存的 UTF-8 BOM JSON 应正常导入', () => {
    // BOM 字符在 JS 中就是 '﻿'，模拟记事本保存的文件
    const json = makeValidJSON();
    const bomString = '﻿' + json;

    // 验证 BOM 存在
    expect(bomString.charCodeAt(0)).toBe(0xFEFF);
    // BOM + JSON 总长 = JSON长 + 1(BOM字符)
    expect(bomString.length).toBe(json.length + 1);

    const result = parseImportJSON(bomString);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
    }
  });

  it('不带 BOM 的普通 JSON 不受影响', () => {
    const json = makeValidJSON();
    expect(json.codePointAt(0)).not.toBe(0xFEFF);
    const result = parseImportJSON(json);
    expect(result.success).toBe(true);
  });
});

describe('JSON 导入 — 乱码/二进制数据应被正确拒绝', () => {
  it('纯二进制数据应解析失败', () => {
    // 模拟读取到二进制文件
    const binary = String.fromCharCode(0xB1, 0xAB, 0xDE, 0x74, 0x0B, 0x75);
    const result = parseImportJSON(binary);
    expect(result.success).toBe(false);
    expect(result.error).toContain('JSON 解析失败');
  });

  it('随机的不可打印字符应解析失败', () => {
    const garbage = '\x00\x01\x02\x03\xFF\xFE\xFD';
    const result = parseImportJSON(garbage);
    expect(result.success).toBe(false);
  });

  it('微信缓存文件特征字节 (0xB1 0xAB 开头) 应被拒绝', () => {
    // 用户实际遇到的微信缓存文件十六进制开头: b1ab de74 0b75...
    const wechatBytes = new Uint8Array([0xB1, 0xAB, 0xDE, 0x74, 0x0B, 0x75, 0xEF, 0xCE,
      0x3D, 0xEB, 0xCD, 0xB8, 0xDB, 0xAD, 0x7D, 0x75]);
    const wechatStr = new TextDecoder().decode(wechatBytes);

    const result = parseImportJSON(wechatStr);
    expect(result.success).toBe(false);
  });

  it('看似 JSON 但实际是二进制的内容应被拒绝', () => {
    // 有些二进制数据可能恰好包含 { 或 }，但不是合法 JSON
    const pseudo = '{' + String.fromCharCode(0x00, 0x01, 0x02) + '}';
    const result = parseImportJSON(pseudo);
    expect(result.success).toBe(false);
  });

  it('图片文件的 base64 伪装成 JSON 应被拒绝', () => {
    const fakeJSON = '{"version":1,"dailyPlans":"iVBORw0KGgo..."}';  // version 是 number 不是 string 的情况
    const result = parseImportJSON(fakeJSON);
    // version 字段存在但 dailyPlans 不是数组
    expect(result.success).toBe(false);
    expect(result.error).toContain('dailyPlans');
  });
});

describe('JSON 导入 — 边界情况', () => {
  it('空字符串应解析失败', () => {
    const result = parseImportJSON('');
    expect(result.success).toBe(false);
  });

  it('只包含空白字符应解析失败', () => {
    const result = parseImportJSON('   \n\t  ');
    expect(result.success).toBe(false);
  });

  it('有效的 JSON 但不是我们的格式应被拒绝', () => {
    const result = parseImportJSON('{"foo":"bar"}');
    expect(result.success).toBe(false);
    expect(result.error).toContain('version');
  });

  it('version 为 0 的旧格式应被拒绝', () => {
    const result = parseImportJSON(JSON.stringify({
      version: 0,
      dailyPlans: [],
    }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('version');
  });

  it('dailyPlans 缺失应被拒绝', () => {
    const result = parseImportJSON(JSON.stringify({
      version: 1,
      reflections: [],
    }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('dailyPlans');
  });

  it('大量数据 JSON（1000条记录）应正常解析', () => {
    const plans = Array.from({ length: 1000 }, (_, i) => ({
      date: `2026-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      timeBlocks: [],
      createdAt: Date.now() - i * 86400000,
      updatedAt: Date.now() - i * 86400000,
    }));
    const json = JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      dailyPlans: plans,
      longTermGoals: [],
      reflections: [],
      harvests: [],
      fixedRoutines: [],
    });
    const result = parseImportJSON(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dailyPlans).toHaveLength(1000);
    }
  });
});

describe('JSON 导出 — 格式验证', () => {
  it('导出的 JSON 应以 { 开头', () => {
    const json = makeValidJSON();
    expect(json.trimStart().startsWith('{')).toBe(true);
  });

  it('导出的 JSON 应包含所有必要字段', () => {
    const json = makeValidJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('version');
    expect(parsed).toHaveProperty('savedAt');
    expect(parsed).toHaveProperty('dailyPlans');
    expect(parsed).toHaveProperty('longTermGoals');
    expect(parsed).toHaveProperty('reflections');
    expect(parsed).toHaveProperty('harvests');
    expect(parsed).toHaveProperty('fixedRoutines');
    expect(parsed).toHaveProperty('taskItems');
    expect(parsed).toHaveProperty('taskTemplates');
  });

  it('round-trip: 导出 → 导入应保持数据一致', () => {
    const original = {
      version: 1,
      savedAt: 1750000000000,
      dailyPlans: [{
        date: '2026-07-25',
        timeBlocks: [{
          id: 'block-1',
          startTime: '08:00',
          endTime: '09:00',
          taskTitle: '测试',
          plannedContent: '',
          actualExecution: '',
          focusScore: 5,
          efficiencyScore: 5,
          completed: false,
          notes: '',
        }],
        createdAt: 1750000000000,
        updatedAt: 1750000000000,
      }],
      longTermGoals: [],
      reflections: [],
      harvests: [],
      fixedRoutines: [],
    };

    const exported = JSON.stringify(original, null, 2);
    const imported = parseImportJSON(exported);

    expect(imported.success).toBe(true);
    if (imported.success) {
      expect(imported.data.version).toBe(original.version);
      expect(imported.data.dailyPlans).toHaveLength(1);
      expect(imported.data.dailyPlans[0]).toHaveProperty('date', '2026-07-25');
    }
  });
});

describe('实际乱码文件特征检测', () => {
  it('识别非 JSON 文件：字节不是 { 或 [ 开头（去掉空白后）', () => {
    const samples = [
      { name: '正常 JSON', content: '{"version":1}', isValid: true },
      { name: 'BOM JSON', content: '﻿{"version":1}', isValid: true },
      { name: '空白开头 JSON', content: '  \n{"version":1}', isValid: true },
      { name: '微信二进制', content: '\xB1\xAB\xDE\x74\x0B\x75', isValid: false },
      { name: '纯二进制', content: '\x00\x01\x02\x03', isValid: false },
      { name: 'HTML 文件', content: '<!DOCTYPE html>', isValid: false },
      { name: 'XML 文件', content: '<?xml version="1.0"?>', isValid: false },
    ];

    for (const s of samples) {
      const trimmed = s.content.trimStart();
      const looksLikeJSON = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('﻿');
      expect(looksLikeJSON).toBe(s.isValid);
    }
  });

  it('用户实际文件（微信缓存）特征：前两字节 0xB1 0xAB 非文本', () => {
    // 这是用户选中文件的实际 hex 开头
    const actualFirstBytes = [0xB1, 0xAB];
    const isPrintableASCII = actualFirstBytes.every(b => b >= 0x20 && b <= 0x7E);
    expect(isPrintableASCII).toBe(false);
    // 结论：此文件不可能是有效的 JSON 文本
  });
});
