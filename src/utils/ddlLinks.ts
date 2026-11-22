/**
 * DDL 关联项的纯函数：从课程/分组生成关联项、切换选中、去重、展示文案。
 *
 * 关联项保存的是「快照」（名字 + 组名），课程或分组以后被删掉，
 * 这条 DDL 仍然能显示当时关联了什么，不会变成空白。
 */

import type { Course, DdlLink, LinkGroup, LinkGroupItem } from '../types';

/** 课程 → 关联项（id 用于去重，label 是名字快照） */
export function courseLink(c: Course): DdlLink {
  return { kind: 'course', id: String(c.id ?? c.name), label: c.name };
}

/** 自定义分组条目 → 关联项（带组名快照，界面上显示「组名 · 条目名」） */
export function groupLink(g: LinkGroup, item: LinkGroupItem): DdlLink {
  return { kind: 'group', id: item.id, label: item.name, groupName: g.name };
}

/** 关联项的判定键：同一门课 / 同一个条目 */
export function linkKey(l: DdlLink): string {
  return `${l.kind}:${l.id}`;
}

export function hasLink(links: DdlLink[], target: DdlLink): boolean {
  return links.some(l => linkKey(l) === linkKey(target));
}

/** 点一下切换关联状态；新增的追加到末尾，保持用户选择的顺序 */
export function toggleLink(links: DdlLink[], target: DdlLink): DdlLink[] {
  return hasLink(links, target)
    ? links.filter(l => linkKey(l) !== linkKey(target))
    : [...links, target];
}

/** 界面文案：自定义组带组名前缀 */
export function linkText(l: DdlLink): string {
  return l.groupName ? `${l.groupName} · ${l.label}` : l.label;
}

/** 关联项的图标（课程 / 自定义分组） */
export function linkIcon(l: DdlLink): string {
  return l.kind === 'course' ? '📚' : '🗂';
}

/** 落库前整理：丢掉空名、非法项，并按判定键去重（保留先出现的顺序） */
export function normalizeLinks(links: DdlLink[] | undefined): DdlLink[] {
  if (!Array.isArray(links)) return [];
  const seen = new Set<string>();
  const out: DdlLink[] = [];
  for (const l of links) {
    if (!l || (l.kind !== 'course' && l.kind !== 'group')) continue;
    const label = (l.label ?? '').trim();
    if (!label || !l.id) continue;
    const item: DdlLink = { kind: l.kind, id: l.id, label };
    if (l.groupName?.trim()) item.groupName = l.groupName.trim();
    const key = linkKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 课程周期文案：第 3-18 周 */
export function courseWeeksText(c: Course): string {
  const end = c.startWeek + Math.max(1, c.weekCount) - 1;
  return `第${c.startWeek}-${end}周`;
}
