import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpDown, Plus, Search, Trash2, X } from 'lucide-react';
import type { KnowledgeCard } from '../types/knowledge';
import { getCards, saveCard, deleteCard, getCardAudioExportPath, setCardAudioExportPath } from '../db/knowledgeCards';
import { DEFAULT_AUDIO_EXPORT_PATH, normalizeAudioPath, cardSearchText, cardDateKey, dateGroupLabel } from '../utils/knowledgeCards';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import KnowledgeCardEditor from './KnowledgeCardEditor';
import ConfirmDialog from './ConfirmDialog';
import './KnowledgeCardCollector.css';

export const createCollectedCard = (): KnowledgeCard => ({ id: `card-${crypto.randomUUID()}`, title: '', contents: [], createdAt: Date.now(), updatedAt: Date.now() });
interface Props { onClose: () => void; initialCardId?: string; startWithNewCard?: boolean; quickComposer?: boolean; }
export default function KnowledgeCardCollector({ onClose, initialCardId, startWithNewCard, quickComposer }: Props) {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [draft, setDraft] = useState<KnowledgeCard | null>(() => startWithNewCard ? createCollectedCard() : null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [path, setPath] = useState(DEFAULT_AUDIO_EXPORT_PATH);
  const [loading, setLoading] = useState(true);
  const [ascending, setAscending] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  useEffect(() => {
    let alive = true;
    void Promise.all([getCards(), getCardAudioExportPath()]).then(([all, exportPath]) => {
      if (!alive) return;
      setCards(all);
      setPath(exportPath || DEFAULT_AUDIO_EXPORT_PATH);
      if (initialCardId) {
        const card = all.find(item => item.id === initialCardId);
        if (card) {
          setDraft(card);
          setSelectedDate(cardDateKey(card.createdAt));
        } else {
          setError('未找到这张卡片。');
        }
      }
      setLoading(false);
    }).catch(err => { if (alive) { setError(String(err)); setLoading(false); } });
    return () => { alive = false; };
  }, [initialCardId]);
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
    if (deleteId) { setDeleteId(null); return true; }
    onClose(); return true;
  }, [draft, deleteId, onClose]);
  async function savePath() {
    try {
      const clean = normalizeAudioPath(path);
      await setCardAudioExportPath(clean);
      setPath(clean); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  if (draft) return <KnowledgeCardEditor key={draft.id} card={draft} audioExportPath={path} quickComposer={quickComposer} onSave={async card => {
    await saveCard(card);
    if (!quickComposer) {
      setCards(await getCards());
      setSelectedDate(cardDateKey(card.createdAt));
    }
  }} onClose={quickComposer ? onClose : () => setDraft(null)} />;
  return <div className="knowledge-panel collector-panel">
    <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={onClose} aria-label="关闭收集器"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">记事</span><h2>卡片收集器</h2></div><button className="knowledge-icon-btn" onClick={() => setDraft(createCollectedCard())} aria-label="新建卡片"><Plus size={18} /></button></header>
    <div className="collector-summary"><span>{cards.length} 张卡片</span><button className="collector-sort" onClick={() => setAscending(value => !value)}><ArrowUpDown size={14} /> {ascending ? '最早在前' : '最新在前'}</button><label>录音目录<input aria-label="录音导出目录" value={path} onChange={event => setPath(event.target.value)} onBlur={() => void savePath()} /></label></div>
    <div className="collector-tools"><label className="collector-date-select">日期<select aria-label="选择日期" value={selectedDate} onChange={event => setSelectedDate(event.target.value)}>{dateKeys.map(key => <option key={key} value={key}>{dateGroupLabel(key)} · {cards.filter(card => cardDateKey(card.createdAt) === key).length}</option>)}</select></label><label className="collector-search"><Search size={15} /><input aria-label="搜索卡片" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或内容" />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label></div>
    {error && <p role="alert" className="knowledge-error">{error}</p>}
    {loading ? <p>正在打开收集器…</p> : !cards.length ? (
      <button className="knowledge-card-empty" onClick={() => setDraft(createCollectedCard())}><Plus size={40} /><span>建立第一张卡片</span></button>
    ) : (
      <div className="collector-list">
        <h3 className="collector-date">{dateGroupLabel(selectedDate)}<span>{dayCards.length}</span></h3>
        {visibleCards.length ? visibleCards.map(card => (
          <article key={card.id} className="collector-card">
            <button className="collector-card-main" onClick={() => setDraft(card)}>
              <strong>{card.title}</strong><span>{card.contents.length} 条内容</span><span>{cardSearchText(card).slice(0, 90)}</span>
            </button>
            <button className="collector-card-delete" onClick={() => setDeleteId(card.id)} aria-label={`删除卡片：${card.title}`}><Trash2 size={14} /></button>
          </article>
        )) : <p className="collector-no-result">没有匹配卡片</p>}
      </div>
    )}
    <ConfirmDialog open={!!deleteId} message="删除这张卡片及全部内容？" onCancel={() => setDeleteId(null)} onConfirm={() => {
      if (!deleteId) return;
      void deleteCard(deleteId).then(async () => {
        setCards(await getCards());
        setDeleteId(null);
      }).catch(err => { setError(String(err)); setDeleteId(null); });
    }} />
  </div>;
}
