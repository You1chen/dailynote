import type { KnowledgeCard, KnowledgeCardContent } from '../../types/knowledge';
import { genId } from '../../types';

export interface CardTypeMeta {
  label: string;
  color: string;
  soft: string;
}

const TYPE_STYLES: Record<string, { color: string; soft: string }> = {
  知识: { color: 'var(--v-accent)', soft: 'var(--v-accent-soft)' },
  顿悟: { color: 'var(--v-orange)', soft: 'var(--v-orange-soft)' },
  鉴赏: { color: 'var(--v-pink)', soft: 'var(--v-pink-soft)' },
  疑问: { color: 'var(--v-purple)', soft: 'var(--v-purple-soft)' },
  计划: { color: 'var(--v-teal)', soft: 'var(--v-teal-soft)' },
  摘录: { color: 'var(--v-indigo)', soft: 'color-mix(in srgb, var(--v-indigo) 12%, transparent)' },
};

const FALLBACK = { color: 'var(--v-teal)', soft: 'var(--v-teal-soft)' };

export function cardType(card: Pick<KnowledgeCard, 'type'>): string {
  const type = card.type?.trim();
  return type || '知识';
}

export function typeMeta(type?: string): CardTypeMeta {
  const label = type?.trim() || '知识';
  const style = TYPE_STYLES[label] ?? FALLBACK;
  return { label, ...style };
}

export function cardTitle(card: Pick<KnowledgeCard, 'title' | 'contents'>): string {
  const title = card.title.trim();
  if (title) return title;
  const text = firstText(card.contents)?.trim();
  if (text) return text.slice(0, 42);
  return '未命名卡片';
}

export function firstText(contents: KnowledgeCardContent[]): string {
  for (const content of contents) {
    if (content.kind === 'text' && content.text.trim()) return content.text;
  }
  return '';
}

export function cardText(card: Pick<KnowledgeCard, 'contents'>): string {
  return card.contents
    .flatMap(content => {
      if (content.kind === 'text') return [content.text];
      if (content.kind === 'audio') return [content.fileName];
      return [];
    })
    .filter(Boolean)
    .join('\n');
}

export function cardSnippet(card: KnowledgeCard, max = 92): string {
  const text = cardText(card).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function cardCover(card: KnowledgeCard): string | undefined {
  for (const content of card.contents) {
    if (content.kind === 'image' && content.data) return content.data;
  }
  return undefined;
}

export function cardImageCount(card: KnowledgeCard): number {
  return card.contents.filter(content => content.kind === 'image').length;
}

export function cardWordCount(card: KnowledgeCard): number {
  return cardText(card).replace(/\s/g, '').length;
}

export function summarizeContents(card: KnowledgeCard): string {
  const texts = card.contents.filter(content => content.kind === 'text').length;
  const images = card.contents.filter(content => content.kind === 'image').length;
  const audios = card.contents.filter(content => content.kind === 'audio').length;
  const parts = [
    texts ? `${texts} 段文字` : '',
    images ? `${images} 张图片` : '',
    audios ? `${audios} 段录音` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '还没有内容';
}

export function createCard(partial: Partial<KnowledgeCard> = {}): KnowledgeCard {
  const now = Date.now();
  return {
    id: `card-${crypto.randomUUID()}`,
    title: '',
    type: '知识',
    contents: [],
    tags: [],
    keywords: [],
    courseIds: [],
    links: [],
    ignoredLinks: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function textContent(text = ''): KnowledgeCardContent {
  const now = Date.now();
  return { id: genId(), kind: 'text', text, createdAt: now, updatedAt: now };
}

export function imageContent(data: string): KnowledgeCardContent {
  const now = Date.now();
  return { id: genId(), kind: 'image', data, createdAt: now, updatedAt: now };
}

export function normalizeCard(card: KnowledgeCard): KnowledgeCard {
  return {
    ...card,
    tags: [...new Set((card.tags ?? []).map(tag => tag.trim()).filter(Boolean))],
    keywords: [...new Set((card.keywords ?? []).map(keyword => keyword.trim()).filter(Boolean))],
    courseIds: [...new Set(card.courseIds ?? [])],
    links: [...new Set(card.links ?? [])].filter(id => id !== card.id),
    ignoredLinks: [...new Set(card.ignoredLinks ?? [])].filter(id => id !== card.id),
  };
}
