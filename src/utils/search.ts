/**
 * 全局内容搜索：只搜用户自己填进去的内容，不搜界面文案、不搜日期
 *
 * 返回的每条都带「位置」文案和跳转路由（日维度的带 ?date=），
 * 任务树没有独立页面，用 onOpen='tasks' 让悬浮球面板打开。
 */

import type { StoreShape } from '../types/storage';
import { effectiveNodes } from './goalTree';
import { isRetiredPrivateGoal } from './retiredRecords';

export interface SearchHit {
  key: string;
  title: string;
  snippet: string;
  where: string;
  route: string;
  onOpen?: 'tasks';
}

const SNIPPET_LEN = 34;

function norm(s: unknown): string {
  return typeof s === 'string' ? s : '';
}

/** 取命中位置周围的片段 */
function snippetOf(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, SNIPPET_LEN);
  const start = Math.max(0, i - 8);
  const s = text.slice(start, start + SNIPPET_LEN);
  return (start > 0 ? '…' : '') + s.replace(/\s+/g, ' ') + (start + SNIPPET_LEN < text.length ? '…' : '');
}

function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** 在一个记录的若干字段里找命中，找到就产出一条 */
function makeHit(
  q: string,
  key: string,
  title: string,
  fields: string[],
  where: string,
  route: string,
  onOpen?: 'tasks',
): SearchHit | null {
  for (const f of fields) {
    const text = norm(f);
    if (text && text.toLowerCase().includes(q)) {
      return { key, title, snippet: snippetOf(text, q), where, route, onOpen };
    }
  }
  return null;
}

export function searchStore(data: StoreShape, rawQuery: string, limit = 60): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const push = (h: SearchHit | null) => { if (h && hits.length < limit) hits.push(h); };

  // ---- 每日计划：时间块 ----
  for (const plan of data.dailyPlans) {
    for (const b of plan.timeBlocks) {
      const fields = [
        b.taskTitle,
        b.plannedContent,
        b.notes,
        ...(b.checklist ?? []).map(i => i.text),
      ];
      push(makeHit(
        q,
        `plan:${plan.date}:${b.id}`,
        b.taskTitle || '(未命名时间块)',
        fields,
        `时间块 · ${shortDate(plan.date)} ${b.startTime}-${b.endTime}`,
        `/?date=${plan.date}`,
      ));
    }
  }

  // Legacy reflections/harvests remain in storage and backups; their retired pages no longer produce search links.

  // ---- 长期目标 ----
  for (const g of data.longTermGoals) {
    if (isRetiredPrivateGoal(g)) continue;
    const nodeTitles: string[] = [];
    const walkNodes = (nodes: ReturnType<typeof effectiveNodes>) => {
      for (const node of nodes) {
        nodeTitles.push(node.title);
        if (node.children.length > 0) walkNodes(node.children);
      }
    };
    walkNodes(effectiveNodes(g));

    push(makeHit(
      q,
      `goal:${g.id}`,
      g.title || '(目标)',
      [g.title, g.description, ...nodeTitles],
      `长期目标${g.category ? ` · ${g.category}` : ''}`,
      '/goals',
    ));
  }

  // ---- DDL ----
  for (const d of data.ddls) {
    push(makeHit(
      q,
      `ddl:${d.id}`,
      d.name || '(DDL)',
      [d.name, d.notes, d.location],
      `DDL · ${shortDate(d.deadlineDate)} ${d.deadlineTime}`,
      '/ddl',
    ));
  }

  // ---- 重要的事 ----
  for (const d of data.important) {
    push(makeHit(
      q,
      `imp:${d.id}`,
      d.name || '(重要的事)',
      [d.name, d.notes, d.location],
      `重要 · ${shortDate(d.deadlineDate)} ${d.deadlineTime || '23:59'}`,
      '/important',
    ));
  }
  // ---- 课程 ----
  for (const c of data.courses) {
    push(makeHit(
      q,
      `course:${c.id}`,
      c.name || '(课程)',
      [c.name, c.teacher, c.location],
      '课程表',
      '/courses',
    ));
  }

  // ---- 卡片（卡片库归属记事页，节点只引用卡片 ID） ----
  const cardLibrary = data.knowledgeCards?.[0];
  if (cardLibrary) {
    for (const record of cardLibrary.records) {
      const owner = (data.knowledgeMaps ?? []).find(map => map.nodes.some(node => node.cardIds?.includes(record.id)));
      const node = owner?.nodes.find(item => item.cardIds?.includes(record.id));
      const textParts = record.card.contents.flatMap(content =>
        content.kind === 'text' ? [content.text] : content.kind === 'audio' ? [content.fileName] : [],
      );
      push(makeHit(
        q,
        `knowledge-card:${record.id}`,
        record.card.title || '未命名卡片',
        [record.card.title, ...textParts],
        owner && node
          ? `卡片 · ${owner.courseName} · ${node.title}`
          : '卡片 · 记事收集器',
        owner ? `/courses?knowledgeCourse=${owner.courseId}&knowledgeNode=${node?.id ?? ''}` : '/reflection',
      ));
    }
  }

  // ---- 任务树 ----
  const walk = (nodes: typeof data.taskBoard[number]['nodes'], chain: string[]) => {
    for (const n of nodes) {
      const next = [...chain, n.title];
      push(makeHit(
        q,
        `task:${next.join('/')}`,
        n.title,
        [n.title],
        next.length > 1 ? `任务 · ${next.slice(0, -1).join('-')}` : '任务',
        '/',
        'tasks',
      ));
      if (n.children.length) walk(n.children, next);
    }
  };
  for (const board of data.taskBoard) walk(board.nodes, []);

  return hits;
}
