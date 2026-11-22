import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, ArrowUpDown, ChevronLeft, ChevronRight, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import { addDays, getDaysInMonth, parseISO } from 'date-fns';
import type { KnowledgeCard, KnowledgeMap } from '../types/knowledge';
import { getAllCourses, getKnowledgeMap } from '../db';
import { getCards, saveCard, deleteCard, linkCard } from '../db/knowledgeCards';
import { getKnowledgeCardLibrary, saveKnowledgeCardLibrary } from '../db';
import { DEFAULT_AUDIO_EXPORT_PATH, normalizeAudioPath, cardSearchText, cardDateKey, dateGroupLabel } from '../utils/knowledgeCards';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import KnowledgeCardEditor from './KnowledgeCardEditor';
import ConfirmDialog from './ConfirmDialog';
import './KnowledgeMapPanel.css';
import './KnowledgeCardCollector.css';

export const createCollectedCard = (): KnowledgeCard => ({ id: `card-${crypto.randomUUID()}`, title: '', contents: [], createdAt: Date.now(), updatedAt: Date.now() });
interface Props { onClose: () => void; initialCardId?: string; startWithNewCard?: boolean; quickComposer?: boolean; }
export default function KnowledgeCardCollector({ onClose, initialCardId, startWithNewCard, quickComposer }: Props) {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [maps, setMaps] = useState<KnowledgeMap[]>([]);
  const [draft, setDraft] = useState<KnowledgeCard | null>(() => startWithNewCard ? createCollectedCard() : null);
  const [linkId, setLinkId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [path, setPath] = useState(DEFAULT_AUDIO_EXPORT_PATH);
  const [loading, setLoading] = useState(true);
  const [ascending, setAscending] = useState(false);
  const [query, setQuery] = useState('');
  const [today] = useState(() => cardDateKey(Date.now()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [openYear, setOpenYear] = useState<string | null>(today.slice(0, 4));
  const [openMonth, setOpenMonth] = useState<string | null>(today.slice(0, 7));
  const swipeStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);

  function selectDate(date: string) {
    setSelectedDate(date);
    setOpenYear(date.slice(0, 4));
    setOpenMonth(date.slice(0, 7));
  }

  function shiftDay(amount: -1 | 1) {
    selectDate(cardDateKey(addDays(parseISO(selectedDate), amount).getTime()));
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    swipeStart.current = null;
    if (!event.isPrimary) return;
    suppressClickUntil.current = 0;
    if (event.pointerType !== 'touch' || linkId || deleteId ||
        (event.target as Element).closest('input, textarea, select, [contenteditable]')) return;
    swipeStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function endSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    if (!start || start.id !== event.pointerId) return;
    swipeStart.current = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Touch pointers can emit a click after pointerup even when the date has changed.
    suppressClickUntil.current = Date.now() + 350;
    shiftDay(dx < 0 ? 1 : -1);
  }
  async function reload() {
    const allCards = await getCards();
    const courses = await getAllCourses();
    const loadedMaps = (await Promise.all(courses.filter(course => course.id).map(course => getKnowledgeMap(course.id!)))).filter((map): map is KnowledgeMap => !!map);
    setCards(allCards); setMaps(loadedMaps);
    return allCards;
  }
  useEffect(() => {
    let alive = true;
    void reload().then(async all => {
      const library = await getKnowledgeCardLibrary();
      if (!alive) return;
      setPath(library?.audioExportPath || DEFAULT_AUDIO_EXPORT_PATH);
      if (initialCardId) setDraft(all.find(card => card.id === initialCardId) ?? null);
      setLoading(false);
    }).catch(err => { if (alive) { setError(String(err)); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  const cardsByDay = useMemo(() => {
    const groups = new Map<string, KnowledgeCard[]>();
    for (const card of cards) {
      const date = cardDateKey(card.createdAt);
      const group = groups.get(date);
      if (group) group.push(card);
      else groups.set(date, [card]);
    }
    return groups;
  }, [cards]);
  const years = useMemo(() => [...new Set([
    today.slice(0, 4),
    selectedDate.slice(0, 4),
    ...Array.from(cardsByDay.keys(), key => key.slice(0, 4)),
  ])].sort().reverse(), [cardsByDay, selectedDate, today]);
  const dayCards = cardsByDay.get(selectedDate);
  const dayCount = dayCards?.length ?? 0;
  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(dayCards ?? [])]
      .filter(card => !needle || cardSearchText(card).toLowerCase().includes(needle))
      .sort((a, b) => ascending ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
  }, [dayCards, query, ascending]);
  useRegisterBackHandler(() => {
    if (draft) return false;
    if (linkId) { setLinkId(null); return true; }
    if (deleteId) { setDeleteId(null); return true; }
    onClose(); return true;
  }, [draft, linkId, deleteId, onClose]);
  const location = (id: string) => maps.flatMap(map => map.nodes.filter(node => node.cardIds.includes(id)).map(node => `${map.courseName} · ${node.title}`)).join(' / ') || '尚未关联知识树';
  async function savePath() {
    try {
      const clean = normalizeAudioPath(path);
      const library = await getKnowledgeCardLibrary();
      await saveKnowledgeCardLibrary({ ...(library ?? { id: 1, records: [], updatedAt: Date.now() }), audioExportPath: clean });
      setPath(clean); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  if (draft) return <KnowledgeCardEditor key={draft.id} card={draft} audioExportPath={path} quickComposer={quickComposer} onSave={async card => {
    await saveCard(card);
    if (!quickComposer) {
      await reload();
      selectDate(cardDateKey(card.createdAt));
    }
  }} onClose={quickComposer ? onClose : () => setDraft(null)} />;
  return <div
    className="knowledge-panel collector-panel"
    data-app-swipe="off"
    onPointerDown={startSwipe}
    onPointerUp={endSwipe}
    onPointerCancel={() => { swipeStart.current = null; }}
    onClickCapture={event => {
      if (!event.detail || Date.now() >= suppressClickUntil.current) return;
      event.preventDefault();
      event.stopPropagation();
    }}
  >
    <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={onClose} aria-label="关闭收集器"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">记事</span><h2>卡片收集器</h2></div><button className="knowledge-icon-btn" onClick={() => setDraft(createCollectedCard())} aria-label="新建卡片"><Plus size={18} /></button></header>
    <div className="collector-summary"><span>{cards.length} 张卡片</span><button className="collector-sort" onClick={() => setAscending(value => !value)}><ArrowUpDown size={14} /> {ascending ? '最早在前' : '最新在前'}</button><label>录音目录<input aria-label="录音导出目录" value={path} onChange={event => setPath(event.target.value)} onBlur={() => void savePath()} /></label></div>
    <div className="collector-tools"><label className="collector-search"><Search size={15} /><input aria-label="搜索卡片" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或内容" />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label></div>
    <nav className="collector-calendar" aria-label="卡片日期导航">
      <div className="collector-day-nav">
        <button type="button" aria-label="上一天" onClick={() => shiftDay(-1)}><ChevronLeft size={18} /></button>
        <time dateTime={selectedDate} aria-live="polite">{selectedDate}</time>
        <button type="button" aria-label="下一天" onClick={() => shiftDay(1)}><ChevronRight size={18} /></button>
      </div>
      {years.map(year => (
        <div key={year}>
          <button type="button" className="collector-year" aria-expanded={openYear === year} onClick={() => {
            setOpenYear(openYear === year ? null : year);
          }}>
            <ChevronRight size={14} /> {year} 年
          </button>
          {openYear === year && <div className="collector-months">
            {Array.from({ length: 12 }, (_, index) => {
              const month = `${year}-${String(index + 1).padStart(2, '0')}`;
              return <button type="button" key={month} aria-expanded={openMonth === month} onClick={() => setOpenMonth(openMonth === month ? null : month)}>
                {index + 1} 月
              </button>;
            })}
            {openMonth?.startsWith(`${year}-`) && <div className="collector-days" aria-label={`${openMonth} 日期`} role="group">
              {Array.from({ length: getDaysInMonth(parseISO(openMonth)) }, (_, index) => {
                const day = index + 1;
                const date = `${openMonth}-${String(day).padStart(2, '0')}`;
                const count = cardsByDay.get(date)?.length ?? 0;
                return <button type="button" key={date} aria-label={`${date} · ${count} 张卡片`} aria-pressed={selectedDate === date} className={count ? 'has-cards' : undefined} onClick={() => selectDate(date)}>
                  {day}
                </button>;
              })}
            </div>}
          </div>}
        </div>
      ))}
    </nav>
    {error && <p role="alert" className="knowledge-error">{error}</p>}
    {loading ? <p>正在打开收集器…</p> : !cards.length ? <button className="knowledge-card-empty" onClick={() => setDraft(createCollectedCard())}><Plus size={40} /><span>建立第一张卡片</span></button> : <div className="collector-list"><h3 className="collector-date">{dateGroupLabel(selectedDate)}<span>{dayCount}</span></h3>{visibleCards.length ? visibleCards.map(card => <article key={card.id} className="collector-card"><button className="collector-card-main" onClick={() => setDraft(card)}><strong>{card.title}</strong><span>{card.contents.length} 条内容 · {location(card.id)}</span><span>{cardSearchText(card).slice(0, 90)}</span></button><div className="collector-card-actions"><button onClick={() => { setLinkId(card.id); setCourseId(''); setNodeId(''); setError(''); }}><Link2 size={14} /> 关联 / 移动</button><button onClick={() => setDeleteId(card.id)} aria-label={`删除卡片：${card.title}`}><Trash2 size={14} /></button></div></article>) : <p className="collector-no-result">没有匹配卡片</p>}</div>}
    {linkId && <div className="knowledge-editor-backdrop"><section className="knowledge-editor"><header><h3>关联或移动到知识树</h3><button aria-label="关闭" onClick={() => setLinkId(null)}><X size={18} /></button></header><p>移动只改变知识树上的位置，卡片一直留在收集器。</p><select aria-label="关联课程" value={courseId} onChange={event => { setCourseId(event.target.value); setNodeId(''); }}><option value="">选择有知识树的课程</option>{maps.map(map => <option key={map.courseId} value={map.courseId}>{map.courseName}</option>)}</select><select aria-label="关联末端节点" value={nodeId} onChange={event => setNodeId(event.target.value)}><option value="">选择末端节点</option>{maps.find(map => String(map.courseId) === courseId)?.nodes.filter(node => !node.children.length).map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select>{error && <p className="knowledge-error" role="alert">{error}</p>}<footer><button onClick={() => setLinkId(null)}>取消</button><button className="knowledge-primary" disabled={!courseId || !nodeId} onClick={() => void (async () => { try { await linkCard(linkId, Number(courseId), nodeId, { move: true }); await reload(); setLinkId(null); } catch (err) { setError(String(err)); } })()}>确认关联</button></footer></section></div>}
    <ConfirmDialog open={!!deleteId} message="删除这张卡片及全部内容？知识树中的关联也会解除。" onCancel={() => setDeleteId(null)} onConfirm={() => void (async () => { try { await deleteCard(deleteId!); await reload(); setDeleteId(null); } catch (err) { setError(String(err)); } })()} />
  </div>;
}
