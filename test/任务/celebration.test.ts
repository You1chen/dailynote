/**
 * 「全部完成」庆祝判定测试
 *
 * 被测对象：src/utils/taskTree.ts 的 completesAll（真实源码 import）。
 * TaskBall 在勾选后用它决定是否弹出庆祝弹窗：
 * 只有「这一下正好勾掉最后一条未完成」才庆祝，取消勾选、清单为空都不庆祝。
 */

import { describe, it, expect } from 'vitest';
import { completesAll } from '../../src/utils/taskTree';
import type { TaskLeaf } from '../../src/types';

function leaf(key: string, done: boolean): TaskLeaf {
  return { key, label: key, chain: key.split('/'), done };
}

describe('completesAll — 勾掉最后一条才庆祝', () => {
  it('两条里只剩一条未完成，勾它 → 庆祝', () => {
    const leaves = [leaf('写完周报', true), leaf('背单词', false)];
    expect(completesAll(leaves, '背单词')).toBe(true);
  });

  it('还有别的未完成 → 不庆祝', () => {
    const leaves = [leaf('A', false), leaf('B', false)];
    expect(completesAll(leaves, 'A')).toBe(false);
  });

  it('勾已经完成的（取消勾选）→ 不庆祝', () => {
    const leaves = [leaf('A', true), leaf('B', true)];
    expect(completesAll(leaves, 'A')).toBe(false);
  });

  it('只有一条任务时勾掉它 → 庆祝', () => {
    expect(completesAll([leaf('A', false)], 'A')).toBe(true);
  });

  it('空清单 → 不庆祝', () => {
    expect(completesAll([], 'A')).toBe(false);
  });

  it('key 不存在 → 不庆祝', () => {
    expect(completesAll([leaf('A', false)], 'B')).toBe(false);
  });

  it('层级末级按完整链判定', () => {
    const leaves = [leaf('实验/一/报告', false), leaf('实验/二/报告', true)];
    expect(completesAll(leaves, '实验/一/报告')).toBe(true);
    expect(completesAll(leaves, '实验/二/报告')).toBe(false);
  });
});
