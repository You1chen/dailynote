import { genId } from '../types';
import type { KnowledgeMap, KnowledgeNode, KnowledgeNote, KnowledgeNoteBlock, KnowledgeStatus } from '../types/knowledge';

export interface ParsedKnowledgeLine { depth: number; title: string; page?: string; }

function indentWidth(raw: string): number {
  let width = 0;
  for (const ch of raw) width += ch === '\t' ? 4 : 1;
  return width;
}

function parsePage(title: string): { title: string; page?: string } {
  const match = /\s+[pP](\d+)\s*$/.exec(title);
  return { title: title.trimEnd(), page: match ? `p${match[1]}` : undefined };
}

export function parseKnowledgeMarkdown(source: string): { lines: ParsedKnowledgeLine[]; error?: string } {
  const lines: ParsedKnowledgeLine[] = [];
  let previousDepth = -1;
  for (const [index, rawLine] of source.replace(/\r\n?/g, '\n').split('\n').entries()) {
    if (!rawLine.trim()) continue;
    const match = /^(\s*)([-+*])\s+(.+?)\s*$/.exec(rawLine);
    if (!match) return { lines: [], error: `第 ${index + 1} 行不是无序列表` };
    const depth = Math.floor(indentWidth(match[1]) / 2);
    if (indentWidth(match[1]) % 2 !== 0) return { lines: [], error: `第 ${index + 1} 行缩进应使用 2 个空格、4 个空格或 Tab` };
    if (depth > previousDepth + 1) return { lines: [], error: `第 ${index + 1} 行层级跳跃，请补上中间节点` };
    const parsed = parsePage(match[3]);
    lines.push({ depth, ...parsed });
    previousDepth = depth;
  }
  if (!lines.length) return { lines: [], error: '请至少输入一个列表节点' };
  return { lines };
}

function matchOldNode(old: KnowledgeNode[], title: string, parentId: string | undefined, depth: number, used: Set<string>): KnowledgeNode | undefined {
  return old.find(node => !used.has(node.id) && node.title === title && node.parentId === parentId)
    ?? old.find(node => !used.has(node.id) && node.title === title && node.depth === depth);
}

export function buildKnowledgeNodes(source: string, oldNodes: KnowledgeNode[] = []): { nodes: KnowledgeNode[]; error?: string } {
  const parsed = parseKnowledgeMarkdown(source);
  if (parsed.error) return { nodes: [], error: parsed.error };
  const nodes: KnowledgeNode[] = [];
  const stack: KnowledgeNode[] = [];
  const used = new Set<string>();
  for (const item of parsed.lines) {
    while (stack.length > item.depth) stack.pop();
    const parent = stack[item.depth - 1];
    const old = matchOldNode(oldNodes, item.title, parent?.id, item.depth, used);
    const node: KnowledgeNode = {
      id: old?.id ?? genId(), parentId: parent?.id, title: item.title, page: item.page,
      depth: item.depth, status: old?.status ?? 'todo', children: [], note: old?.note,
    };
    used.add(node.id);
    if (parent) parent.children.push(node.id);
    nodes.push(node);
    stack[item.depth] = node;
  }
  return { nodes };
}

export function nodesToMarkdown(nodes: KnowledgeNode[], includeNotes = true): string {
  const byParent = new Map<string | undefined, KnowledgeNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node); byParent.set(node.parentId, list);
  }
  const out: string[] = [];
  const visit = (parent: string | undefined, depth: number) => {
    for (const node of byParent.get(parent) ?? []) {
      out.push(`${'  '.repeat(depth)}- ${node.title}`);
      if (includeNotes && node.note?.blocks.length) for (const block of node.note.blocks) out.push(`${'  '.repeat(depth + 1)}  ${block.checklist ? '[ ] ' : ''}${block.text}`);
      visit(node.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return out.join('\n');
}

export function parseNoteBlocks(text: string, old: KnowledgeNote | undefined): KnowledgeNote {
  const oldByText = new Map((old?.blocks ?? []).map(block => [`${block.checklist}|${block.text}`, block]));
  const blocks: KnowledgeNoteBlock[] = text.replace(/\r\n?/g, '\n').split('\n').filter((line, i, all) => line || i < all.length - 1).map(line => {
    const spaces = /[ ]+$/.exec(line)?.[0] ?? '';
    const checklist = spaces.length >= 3;
    const value = checklist ? line.slice(0, -spaces.length) : line;
    const key = `${checklist}|${value}`;
    const previous = oldByText.get(key);
    return { id: previous?.id ?? genId(), text: value, checklist, checked: checklist ? previous?.checked ?? false : undefined };
  });
  return { blocks, updatedAt: Date.now() };
}

export function noteToText(note?: KnowledgeNote): string {
  return note?.blocks.map(block => block.text).join('\n') ?? '';
}

export const KNOWLEDGE_STATUS_LABEL: Record<KnowledgeStatus, string> = { todo: '待学', debt: '负债', learned: '已学' };

export function createKnowledgeMap(courseId: number, courseName: string, sourceMarkdown: string): KnowledgeMap {
  const now = Date.now();
  const built = buildKnowledgeNodes(sourceMarkdown);
  return { courseId, courseName, sourceMarkdown, nodes: built.nodes, createdAt: now, updatedAt: now };
}
