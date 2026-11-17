import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, History, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { getCards } from '../db/knowledgeCards';
import { useIdeas } from '../hooks/useIdeas';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import type { Idea } from '../types';
import type { KnowledgeCard } from '../types/knowledge';
import './Wander.css';

type Source = 'card' | 'idea';
type RangeKey = 'all' | 'week' | 'month' | 'quarter' | 'year';

interface WanderItem {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  source: Source;
}

const RANGES: { key: RangeKey; label: string; days?: number }[] = [
  { key: 'all', label: '全部时间' },
  { key: 'week', label: '最近一周', days: 7 },
  { key: 'month', label: '最近一个月', days: 30 },
  { key: 'quarter', label: '最近三个月', days: 90 },
  { key: 'year', label: '最近一年', days: 365 },
];

const DAY = 86400000;

function splitIdea(idea: Idea): { title: string; body: string } {
  const raw = idea.text.trim();
  const explicit = idea.title?.trim();
  if (explicit) return { title: explicit, body: raw };
  const lines = raw.split('\n');
  if (lines.length > 1 && lines[0].length <= 30) return { title: lines[0], body: lines.slice(1).join('\n').trim() };
  return { title: '灵感', body: raw };
}

function cardItem(card: KnowledgeCard): WanderItem {
  const text = card.contents
    .filter((item): item is Extract<typeof item, { kind: 'text' }> => item.kind === 'text')
    .map(item => item.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const hasImage = card.contents.some(item => item.kind === 'image');
  const hasAudio = card.contents.some(item => item.kind === 'audio');
  const title = card.title.trim() || text.split('\n')[0]?.slice(0, 28) || '未命名卡片';
  return {
    id: `card:${card.id}`,
    title,
    body: text || (hasImage ? '一张图片' : hasAudio ? '一段录音' : ''),
    createdAt: card.createdAt || card.updatedAt || Date.now(),
    source: 'card',
  };
}

function ideaItem(idea: Idea): WanderItem {
  const { title, body } = splitIdea(idea);
  return {
    id: `idea:${idea.id ?? `${idea.date}:${idea.createdAt}`}`,
    title,
    body,
    createdAt: idea.createdAt || new Date(`${idea.date}T12:00:00`).getTime(),
    source: 'idea',
  };
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function ageLabel(timestamp: number): string {
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / DAY));
  if (days < 1) return '今天';
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  const rest = days % 30;
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const yearMonths = months % 12;
    return `${years}年${yearMonths ? ` ${yearMonths}月` : ''}${rest ? ` ${rest}天` : ''}前`;
  }
  return `${months}月${rest ? ` ${rest}天` : ''}前`;
}

function dateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()} / ${String(date.getMonth() + 1).padStart(2, '0')} / ${String(date.getDate()).padStart(2, '0')}`;
}

export default function WanderPage() {
  const navigate = useNavigate();
  const { ideas, loading: ideasLoading } = useIdeas();
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<RangeKey>('all');
  const [historyToday, setHistoryToday] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [seed, setSeed] = useState(0);
  const [active, setActive] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getCards()
      .then(next => { if (alive) setCards(next); })
      .catch(cause => { if (alive) setError(String(cause)); })
      .finally(() => { if (alive) setCardsLoading(false); });
    return () => { alive = false; };
  }, []);

  const items = useMemo(() => [
    ...cards.map(cardItem),
    ...ideas.filter(idea => (idea.kind ?? 'idea') === 'idea').map(ideaItem),
  ], [cards, ideas]);

  const filtered = useMemo(() => {
    const days = RANGES.find(item => item.key === range)?.days;
    const cutoff = days ? Date.now() - days * DAY : 0;
    const today = new Date();
    return items.filter(item => {
      if (!item.createdAt || item.createdAt < cutoff) return false;
      if (!historyToday) return true;
      const date = new Date(item.createdAt);
      return date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    });
  }, [items, range, historyToday]);

  const ordered = useMemo(() => shuffle(filtered), [filtered, seed]);

  useEffect(() => { setActive(0); }, [ordered]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (filterOpen) return;
      if (event.key === 'ArrowLeft') setActive(value => ordered.length ? (value - 1 + ordered.length) % ordered.length : 0);
      if (event.key === 'ArrowRight') setActive(value => ordered.length ? (value + 1) % ordered.length : 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered.length, filterOpen]);

  useRegisterBackHandler(() => {
    if (filterOpen) { setFilterOpen(false); return true; }
    navigate(-1);
    return true;
  }, [filterOpen, navigate]);

  const go = (delta: number) => {
    if (!ordered.length) return;
    setActive(value => (value + delta + ordered.length) % ordered.length);
  };

  const current = ordered[active] ?? null;
  const stack = useMemo(() => {
    if (!ordered.length) return [] as { item: WanderItem; offset: number; index: number }[];
    const offsets = ordered.length === 1 ? [0] : ordered.length === 2 ? [-1, 0, 1] : [-2, -1, 0, 1, 2];
    const seen = new Set<number>();
    return offsets.flatMap(offset => {
      const index = (active + offset + ordered.length) % ordered.length;
      if (seen.has(index)) return [];
      seen.add(index);
      return [{ item: ordered[index], offset, index }];
    });
  }, [ordered, active]);

  const loading = ideasLoading || cardsLoading;

  return (
    <div className="wander-page">
      <div className="wander-orbs" aria-hidden="true"><i /><i /><i /></div>
      <header className="wander-header">
        <button type="button" className="wander-icon-button" onClick={() => navigate(-1)} aria-label="返回"><ArrowLeft size={21} /></button>
        <div className="wander-title"><Sparkles size={15} />漫步</div>
        <div className="wander-actions">
          <button type="button" className={`wander-icon-button ${historyToday ? 'is-active' : ''}`} onClick={() => { setHistoryToday(value => !value); setFilterOpen(false); }} aria-label="历史上的今天" title="历史上的今天"><History size={19} /></button>
          <button type="button" className={`wander-icon-button ${range !== 'all' ? 'is-active' : ''}`} onClick={() => setFilterOpen(true)} aria-label="时间区间筛选" title="时间区间筛选"><SlidersHorizontal size={19} /></button>
        </div>
      </header>

      <main className="wander-stage" onTouchStart={event => {
        const touch = event.touches[0];
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      }} onTouchEnd={event => {
        const start = touchStart.current;
        touchStart.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1);
      }}>
        {loading ? <div className="wander-status">正在拾起散落的片段…</div> : !current ? <div className="wander-empty">
          <Sparkles size={32} />
          <p>{historyToday ? '历史上的今天还没有内容' : '还没有可以漫步的内容'}</p>
          <button type="button" onClick={() => navigate('/reflection')}>去收集卡片</button>
        </div> : <>
          <div className="wander-age" key={current.id}>{ageLabel(current.createdAt)}</div>
          <div className="wander-stack">
            {stack.map(({ item, offset, index }) => <div key={`${item.id}:${offset}`} className={`wander-card-pos ${offset === 0 ? 'is-center' : offset === -1 ? 'is-left' : offset === 1 ? 'is-right' : offset === -2 ? 'is-far-left' : 'is-far-right'}`} aria-hidden={offset !== 0}>
              <article className={`wander-card ${offset === 0 ? 'is-active' : ''}`} onClick={() => { if (offset !== 0) setActive(index); }}>
                <h2>{item.title}</h2>
                <p className="wander-card-body"><span>{item.body || '这条内容没有文字'}</span></p>
                <time dateTime={new Date(item.createdAt).toISOString()}>{dateLabel(item.createdAt)}</time>
              </article>
            </div>)}
          </div>
          <div className="wander-nav">
            <button type="button" onClick={() => go(-1)} aria-label="上一张">‹</button>
            <span>{active + 1} / {ordered.length}</span>
            <button type="button" onClick={() => go(1)} aria-label="下一张">›</button>
          </div>
        </>}
      </main>

      <footer className="wander-footer">
        <span>随机回顾时光</span>
        <button type="button" onClick={() => setSeed(value => value + 1)} aria-label="换一组">换一组</button>
      </footer>

      {filterOpen && <div className="wander-sheet-backdrop" onClick={() => setFilterOpen(false)}>
        <section className="wander-sheet" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="时间区间筛选">
          <header><h3>时间区间</h3><button type="button" onClick={() => setFilterOpen(false)} aria-label="关闭"><X size={19} /></button></header>
          {RANGES.map(item => <button key={item.key} type="button" className={range === item.key ? 'is-selected' : ''} onClick={() => { setRange(item.key); setFilterOpen(false); }}>
            <span>{item.label}</span><em>{item.key === range ? '✓' : ''}</em>
          </button>)}
        </section>
      </div>}
    </div>
  );
}
