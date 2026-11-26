import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRouteBack } from '../hooks/useRouteBack';
import { ArrowLeft, History, Filter, Pencil, X } from 'lucide-react';
import { getCards } from '../db/knowledgeCards';
import { getAllIdeas } from '../db';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { collectMemories, deal, matchesDay, type Memory } from '../utils/wanderDeck';
import WalkMotion from './WalkMotion';
import WalkEdit from '../components/WalkEdit';
import './Walk.css';

export default function Walk() {
  const routeBack = useRouteBack();
  const [all, setAll] = useState<Memory[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [range, setRange] = useState(['', '']);
  const [draft, setDraft] = useState(['', '']);
  const [hist, setHist] = useState(false);
  const [version, setVersion] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [detail, setDetail] = useState<Memory | null>(null);
  const [editing, setEditing] = useState<Memory | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let live = true;
    setError(false);
    getCards().then(async cards => {
      const memories = cards.length ? deal(collectMemories(cards, await getAllIdeas())) : [];
      if (live) setAll(memories);
    }).catch(() => {
      if (live) setError(true);
    });
    return () => { live = false; };
  }, [retry]);

  const entries = useMemo(() => all?.filter(item => matchesDay(item.day, range[0], range[1], hist)) ?? [], [all, range, hist]);
  const close = useCallback(() => { setSheet(false); setDetail(null); }, []);
  const dialogOpen = sheet || !!detail;
  const drag = useSheetDrag(close, dialogOpen);
  const beginEdit = useCallback(() => {
    if (!detail) return;
    setEditing(detail);
    setDetail(null);
  }, [detail]);
  const back = useCallback(() => {
    if (editing) setEditing(null);
    else if (dialogOpen) close();
    else routeBack();
    return true;
  }, [editing, dialogOpen, close, routeBack]);
  useRegisterBackHandler(back, [back]);
  useEffect(() => {
    if (dialogOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [dialogOpen]);

  return (
    <main className="walk-room">
      <header className="walk-head">
        <button onClick={back} aria-label="返回"><ArrowLeft /></button>
        <h1>回忆</h1>
        {Boolean(all?.length) && <>
          <button title="历史上的今天" aria-label="历史上的今天" aria-pressed={hist} onClick={() => setHist(!hist)}><History /></button>
          <button title="时间区间筛选" aria-label="时间区间筛选" aria-pressed={!!(range[0] || range[1])} onClick={() => { setDraft([...range]); setSheet(true); }}><Filter /></button>
        </>}
      </header>
      {entries.length > 0 ? (
        <div className="walk-deal" key={`${version}:${range.join(':')}:${hist}`}>
          <WalkMotion items={entries} open={setDetail} paused={dialogOpen || !!editing} reshuffle={() => {
            setAll(prev => prev ? deal(prev) : prev);
            setVersion(v => v + 1);
          }} />
        </div>
      ) : (
        <div className="walk-empty">
          {error ? <><p>未能读取回忆</p><button onClick={() => setRetry(r => r + 1)}>重试</button></>
            : !all ? <p>正在铺开卡片…</p>
            : all.length ? <>
              <p>{hist ? '往年的今天还没有记录' : '这段时间没有记录'}</p>
              <button onClick={() => { setHist(false); setRange(['', '']); }}>查看全部时间</button>
            </> : <>
              <p>回忆会随机翻出你以前创建的卡片。</p>
              <Link className="walk-create-card" to="/reflection?cards=new">创建第一张卡片</Link>
            </>}
        </div>
      )}
      <dialog ref={dialog} className="walk-dialog" aria-label={sheet ? '时间区间筛选' : '阅读原文'} onCancel={e => {
        e.preventDefault();
        close();
      }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
        <section style={drag.style}>
          <div className="sheet-grip" aria-hidden="true" {...drag.handlers} />
          <header>
            <span>{sheet ? '时间区间' : detail?.kind}</span>
            <div className="walk-dialog-actions">
              {detail && <button aria-label="编辑" onClick={beginEdit}><Pencil size={17} /></button>}
              <button aria-label="关闭" onClick={close}><X /></button>
            </div>
          </header>
          {sheet ? (
            <form onSubmit={e => { e.preventDefault(); setRange([...draft]); close(); }}>
              <label>从<input type="date" value={draft[0]} max={draft[1] || undefined} onChange={e => setDraft([e.target.value, draft[1]])} /></label>
              <label>至<input type="date" value={draft[1]} min={draft[0] || undefined} onChange={e => setDraft([draft[0], e.target.value])} /></label>
              <footer><button type="button" onClick={() => { setRange(['', '']); close(); }}>全部时间</button><button>应用</button></footer>
            </form>
          ) : detail && (
            <article className="walk-detail-card" onClick={e => { if (!(e.target as HTMLElement).closest('audio,img,button')) beginEdit(); }}>
              <time>{detail.day} · {new Date(detail.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
              <h2>{detail.title}</h2>
              {detail.kind === '灵感' ? <p>{detail.text}</p> : detail.blocks.map(block => (
                <div key={block.id}>
                  {block.kind === 'text' ? <p>{block.text}</p> : block.kind === 'image' ? <img src={block.data} alt="卡片图片" /> : <audio controls preload="none" src={block.data} />}
                </div>
              ))}
            </article>
          )}
        </section>
      </dialog>
      {editing && <WalkEdit memory={editing} onClose={() => setEditing(null)} onSaved={next => setAll(prev => prev?.map(item => item.id === next.id ? next : item) ?? null)} />}
    </main>
  );
}
