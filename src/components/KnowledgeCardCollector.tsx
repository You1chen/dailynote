import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpDown, Link2, Plus, Search, Trash2, X } from 'lucide-react';
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
  const [selectedDate, setSelectedDate] = useState('');
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
  const dateKeys = useMemo(() => [...new Set(cards.map(card => cardDateKey(card.createdAt)))].sort().reverse(), [cards]);
  useEffect(() => { if (dateKeys.length && !dateKeys.includes(selectedDate)) setSelectedDate(dateKeys[0]); }, [dateKeys, selectedDate]);
  const dayCards = useMemo(() => cards.filter(card => cardDateKey(card.createdAt) === selectedDate), [cards, selectedDate]);
  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...dayCards]
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
      setSelectedDate(cardDateKey(card.createdAt));
    }
  }} onClose={quickComposer ? onClose : () => setDraft(null)} />;
  return <div className="knowledge-panel collector-panel">
    <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={onClose} aria-label="关闭收集器"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">记事</span><h2>卡片收集器</h2></div><button className="knowledge-icon-btn" onClick={() => setDraft(createCollectedCard())} aria-label="新建卡片"><Plus size={18} /></button></header>
    <div className="collector-summary"><span>{cards.length} 张卡片</span><button className="collector-sort" onClick={() => setAscending(value => !value)}><ArrowUpDown size={14} /> {ascending ? '最早在前' : '最新在前'}</button><label>录音目录<input aria-label="录音导出目录" value={path} onChange={event => setPath(event.target.value)} onBlur={() => void savePath()} /></label></div>
    <div className="collector-tools"><label className="collector-date-select">日期<select aria-label="选择日期" value={selectedDate} onChange={event => setSelectedDate(event.target.value)}>{dateKeys.map(key => <option key={key} value={key}>{dateGroupLabel(key)} · {cards.filter(card => cardDateKey(card.createdAt) === key).length}</option>)}</select></label><label className="collector-search"><Search size={15} /><input aria-label="搜索卡片" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或内容" />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label></div>
    {error && <p role="alert" className="knowledge-error">{error}</p>}
    {loading ? <p>正在打开收集器…</p> : !cards.length ? <button className="knowledge-card-empty" onClick={() => setDraft(createCollectedCard())}><Plus size={40} /><span>建立第一张卡片</span></button> : <div className="collector-list"><h3 className="collector-date">{dateGroupLabel(selectedDate)}<span>{dayCards.length}</span></h3>{visibleCards.length ? visibleCards.map(card => <article key={card.id} className="collector-card"><button className="collector-card-main" onClick={() => setDraft(card)}><strong>{card.title}</strong><span>{card.contents.length} 条内容 · {location(card.id)}</span><span>{cardSearchText(card).slice(0, 90)}</span></button><div className="collector-card-actions"><button onClick={() => { setLinkId(card.id); setCourseId(''); setNodeId(''); setError(''); }}><Link2 size={14} /> 关联 / 移动</button><button onClick={() => setDeleteId(card.id)} aria-label={`删除卡片：${card.title}`}><Trash2 size={14} /></button></div></article>) : <p className="collector-no-result">没有匹配卡片</p>}</div>}
    {linkId && <div className="knowledge-editor-backdrop"><section className="knowledge-editor"><header><h3>关联或移动到知识树</h3><button aria-label="关闭" onClick={() => setLinkId(null)}><X size={18} /></button></header><p>移动只改变知识树上的位置，卡片一直留在收集器。</p><select aria-label="关联课程" value={courseId} onChange={event => { setCourseId(event.target.value); setNodeId(''); }}><option value="">选择有知识树的课程</option>{maps.map(map => <option key={map.courseId} value={map.courseId}>{map.courseName}</option>)}</select><select aria-label="关联末端节点" value={nodeId} onChange={event => setNodeId(event.target.value)}><option value="">选择末端节点</option>{maps.find(map => String(map.courseId) === courseId)?.nodes.filter(node => !node.children.length).map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select>{error && <p className="knowledge-error" role="alert">{error}</p>}<footer><button onClick={() => setLinkId(null)}>取消</button><button className="knowledge-primary" disabled={!courseId || !nodeId} onClick={() => void (async () => { try { await linkCard(linkId, Number(courseId), nodeId, { move: true }); await reload(); setLinkId(null); } catch (err) { setError(String(err)); } })()}>确认关联</button></footer></section></div>}
    <ConfirmDialog open={!!deleteId} message="删除这张卡片及全部内容？知识树中的关联也会解除。" onCancel={() => setDeleteId(null)} onConfirm={() => void (async () => { try { await deleteCard(deleteId!); await reload(); setDeleteId(null); } catch (err) { setError(String(err)); } })()} />
  </div>;
}
