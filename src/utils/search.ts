/**
 * 全局内容搜索：只搜用户自己填进去的内容，不搜界面文案、不搜日期
 *
 * 返回的每条都带「位置」文案和跳转路由（日维度的带 ?date=），
 * 任务树没有独立页面，用 onOpen='tasks' 让悬浮球面板打开。
 */

import type { StoreShape } from '../types/storage';
import { effectiveNodes } from './goalTree';
import { noteToText } from './knowledgeMap';

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
        b.actualExecution,
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

  // ---- 反思 ----
  for (const r of data.reflections) {
    push(makeHit(
      q,
      `ref:${r.id}`,
      r.problem || '(反思)',
      [r.problem, r.cause, r.solution, r.relatedTaskTitle],
      `反思 · ${shortDate(r.date)}`,
      `/reflection?date=${r.date}`,
    ));
  }

  // ---- 收获 ----
  for (const h of data.harvests) {
    push(makeHit(
      q,
      `harv:${h.id}`,
      h.subject || '(收获)',
      [h.subject, h.content],
      `收获 · ${shortDate(h.date)}`,
      `/harvest?date=${h.date}`,
    ));
  }

  // ---- 大愿望 / 长期目标 ----
  for (const g of data.longTermGoals) {
    if (g.kind === 'wish') continue; // 秘密花园内容不出现在全局搜索
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
      [g.title, g.description, g.vision ?? '', ...nodeTitles],
      `长期目标${g.category ? ` · ${g.category}` : ''}`,
      '/goals',
    ));
  }

  // ---- 遗留问题 ----
  for (const b of data.backlog) {
    push(makeHit(
      q,
      `bl:${b.id}`,
      b.title || '(遗留问题)',
      [b.title, b.blocker, b.detail, b.startText],
      '遗留问题',
      '/backlog',
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

  // ---- 知识地图笔记方框项 ----
  for (const map of data.knowledgeMaps ?? []) {
    const course = data.courses.find(item => item.id === map.courseId);
    for (const node of map.nodes) {
      const checklist = node.note?.blocks.filter(block => block.checklist) ?? [];
      if (!checklist.length) continue;
      push(makeHit(
        q,
        `knowledge-check:${map.courseId}:${node.id}`,
        checklist.find(block => block.text.toLowerCase().includes(q))?.text || node.title,
        checklist.map(block => `${block.checked ? '[已完成] ' : '[待办] '}${block.text}`),
        `知识地图 · ${course?.name ?? map.courseName} · ${node.title}`,
        `/courses?knowledgeCourse=${map.courseId}&knowledgeNode=${node.id}`,
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
