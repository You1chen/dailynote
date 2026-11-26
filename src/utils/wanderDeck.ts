import type { KnowledgeCard } from '../types/knowledge';
import { differenceInCalendarDays, format, intervalToDuration } from 'date-fns';

export type Memory = {
  id: string;
  title: string;
  day: string;
  time: number;
  kind: '卡片';
  blocks: KnowledgeCard['contents'];
  card: KnowledgeCard;
};

export function collectMemories(cards: KnowledgeCard[]): Memory[] {
  return cards.map(card => ({
    id: `c:${card.id}`,
    title: card.title || '未命名卡片',
    day: format(card.createdAt, 'yyyy-MM-dd'),
    time: card.createdAt,
    kind: '卡片' as const,
    blocks: card.contents,
    card,
  }));
}
export function deal<T>(values: T[], random = Math.random): T[] {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i+1)); [out[i],out[j]] = [out[j],out[i]]; }
  return out;
}
export function matchesDay(day: string, from: string, until: string, history: boolean, now = new Date()) {
  const today = format(now, 'yyyy-MM-dd');
  return (!from || day >= from) && (!until || day <= until) && (!history || (day < today && day.slice(5) === today.slice(5)));
}
export function age(day: string, now = new Date()) {
  const start = new Date(day + 'T00:00:00'), end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = differenceInCalendarDays(end,start);
  if (!days) return '今天';
  if (days < 0) return `${-days}天后`;
  const d = intervalToDuration({ start, end });
  return [[d.years,'年'],[d.months,'月'],[d.days,'天']].filter(([n]) => n).map(([n,u]) => `${n}${u}`).join(' ')+'前';
}
