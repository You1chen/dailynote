/**
 * DDL 关联项的纯函数测试
 *
 * 关联项是「快照」：课程/分组以后被删掉，DDL 上仍然显示当时关联的名字。
 */

import { describe, it, expect } from 'vitest';
import {
  courseLink,
  groupLink,
  hasLink,
  linkIcon,
  linkKey,
  linkText,
  normalizeLinks,
  toggleLink,
  courseWeeksText,
} from '../../src/utils/ddlLinks';
import type { Course, DdlLink, LinkGroup } from '../../src/types';

const mathCourse = {
  id: 7, name: '高等数学', teacher: '', location: '', dayOfWeek: [1, 3],
  startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 16,
  createdAt: 0, updatedAt: 0,
} as Course;

const labGroup: LinkGroup = {
  id: 3, name: '实验', items: [{ id: 'it1', name: '服务器 A' }], createdAt: 0, updatedAt: 0,
};

describe('生成关联项', () => {
  it('课程：id 转字符串，label 是课程名', () => {
    expect(courseLink(mathCourse)).toEqual({ kind: 'course', id: '7', label: '高等数学' });
  });

  it('课程没有 id 时用名字兜底（不会变成 undefined）', () => {
    const l = courseLink({ ...mathCourse, id: undefined });
    expect(l.id).toBe('高等数学');
  });

  it('分组条目：带组名快照', () => {
    expect(groupLink(labGroup, labGroup.items[0])).toEqual({
      kind: 'group', id: 'it1', label: '服务器 A', groupName: '实验',
    });
  });
});

describe('切换选中', () => {
  const a = courseLink(mathCourse);
  const b = groupLink(labGroup, labGroup.items[0]);

  it('没有就加，有就删', () => {
    expect(toggleLink([], a)).toEqual([a]);
    expect(toggleLink([a], a)).toEqual([]);
    expect(toggleLink([a, b], a)).toEqual([b]);
  });

  it('同一门课即使名字改了也只算一份', () => {
    const renamed: DdlLink = { kind: 'course', id: '7', label: '高等数学（上）' };
    expect(hasLink([a], renamed)).toBe(true);
    expect(toggleLink([a], renamed)).toEqual([]);
  });

  it('课程与同 id 的分组条目互不影响', () => {
    const groupWithSameId: DdlLink = { kind: 'group', id: '7', label: '别的' };
    expect(hasLink([a], groupWithSameId)).toBe(false);
  });

  it('新增的追加在末尾（保持用户选择顺序）', () => {
    expect(toggleLink([a], b)).toEqual([a, b]);
  });
});

describe('展示文案', () => {
  it('课程直接显示名字，分组带组名前缀', () => {
    expect(linkText({ kind: 'course', id: '1', label: '高数' })).toBe('高数');
    expect(linkText({ kind: 'group', id: '2', label: 'A', groupName: '实验' })).toBe('实验 · A');
  });

  it('图标按类型区分', () => {
    expect(linkIcon({ kind: 'course', id: '1', label: '高数' })).toBe('📚');
    expect(linkIcon({ kind: 'group', id: '2', label: 'A' })).toBe('🗂');
  });

  it('课程周期文案', () => {
    expect(courseWeeksText(mathCourse)).toBe('第1-16周');
    expect(courseWeeksText({ ...mathCourse, startWeek: 9, weekCount: 3 })).toBe('第9-11周');
  });
});

describe('落库前整理 normalizeLinks', () => {
  it('去掉空名 / 缺 id / 非法类型', () => {
    const dirty = [
      { kind: 'course', id: '1', label: '  ' },
      { kind: 'course', id: '', label: '没有 id' },
      { kind: 'weird', id: '2', label: '非法' },
      null,
    ] as unknown as DdlLink[];
    expect(normalizeLinks(dirty)).toEqual([]);
  });

  it('去重并保留先出现的顺序', () => {
    const list: DdlLink[] = [
      { kind: 'course', id: '1', label: '高数' },
      { kind: 'group', id: 'x', label: 'A', groupName: '实验' },
      { kind: 'course', id: '1', label: '高数（重复）' },
    ];
    expect(normalizeLinks(list)).toEqual([
      { kind: 'course', id: '1', label: '高数' },
      { kind: 'group', id: 'x', label: 'A', groupName: '实验' },
    ]);
  });

  it('去掉名字两端空格；空组名不保留', () => {
    expect(normalizeLinks([{ kind: 'group', id: 'x', label: ' A ', groupName: '  ' }]))
      .toEqual([{ kind: 'group', id: 'x', label: 'A' }]);
  });

  it('undefined / 非数组 → 空数组', () => {
    expect(normalizeLinks(undefined)).toEqual([]);
    expect(normalizeLinks(null as unknown as DdlLink[])).toEqual([]);
  });
});

describe('linkKey', () => {
  it('类型 + id 唯一确定一项', () => {
    expect(linkKey({ kind: 'course', id: '1', label: 'a' })).toBe('course:1');
    expect(linkKey({ kind: 'group', id: '1', label: 'a' })).toBe('group:1');
  });
});
