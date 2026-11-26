import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Feather, Pencil, Sprout, X } from 'lucide-react';
import { useGardenEntries } from '../hooks/useGardenEntries';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import GardenConfessionEditor from '../components/GardenConfessionEditor';
import GardenWishes from '../components/GardenWishes';
import GardenSecuritySettings from '../components/GardenSecuritySettings';
import ConfirmDialog from '../components/ConfirmDialog';
import { getTrashItems, restoreFromTrash } from '../db';
import { decryptWish, isGardenUnlocked } from '../services/gardenSecurity';
import type { LongTermGoal } from '../types';
import '../pages/SettingsPage.css';
import './GardenPage.css';

const dateLabel = (timestamp: number) => new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

function GardenSettings({ onRestored }: { onRestored?: () => void }) {
  const navigate = useNavigate();
  const [archived, setArchived] = useState<{ trashId: number; entry: LongTermGoal }[]>([]);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const records = await getTrashItems();
      const result: { trashId: number; entry: LongTermGoal }[] = [];
      for (const item of records) {
        if (item.originalTable !== 'longTermGoals' || item.originalData?.kind !== 'wish') continue;
        try { result.push({ trashId: item.id!, entry: await decryptWish(item.originalData) }); }
        catch { /* A separate imported vault may need its own phrase. */ }
      }
      if (alive && isGardenUnlocked()) setArchived(result);
    })().catch(() => { if (alive) setError('暂时无法读取收起的内容。'); });
    return () => { alive = false; };
  }, []);

  async function restore(id: number) {
    if (restoring !== null) return;
    setRestoring(id); setError('');
    try {
      if (!(await restoreFromTrash(id))) throw new Error('未能恢复，请重试。');
      setArchived(prev => prev.filter(item => item.trashId !== id));
      onRestored?.();
    } catch (e) { setError(e instanceof Error ? e.message : '未能恢复，请重试。'); }
    finally { setRestoring(null); }
  }

  return <main className="garden-page garden-settings settings-page">
    <header className="garden-topbar"><button className="garden-text-button" onClick={() => navigate('/garden', { replace: true })}><ArrowLeft size={17} /> 回到花园</button><span className="garden-small-mark">门内的设置</span></header>
    <div className="garden-settings-intro"><span className="garden-eyebrow">A KEY OF YOUR OWN</span><h1>花园设置</h1><p>照看这扇门，也照看留在这里的话。</p></div>
    <GardenSecuritySettings />
    <section className="garden-archive"><h2>暂时收起的</h2><p>收起的内容保留 30 天，只在这里看见。</p>
      {archived.length === 0 && <small>这里暂时没有收起的内容。</small>}
      {archived.map(({ trashId, entry }) => <div className="garden-archive-row" key={trashId}><div><strong>{entry.title || '没有题目的倾述'}</strong><small>{entry.gardenEntry === 'confession' ? '倾述' : '愿望'} · {dateLabel(entry.createdAt)}</small></div><button className="garden-text-button" disabled={restoring !== null} onClick={() => void restore(trashId)}>{restoring === trashId ? '正在放回…' : '放回花园'}</button></div>)}
      {error && <p className="garden-error" role="alert">{error}</p>}
    </section>
  </main>;
}

export default function GardenPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { entries, loading, error, reload, save, archive } = useGardenEntries();
  const [tab, setTab] = useState<'letters' | 'wishes'>('letters');
  const [editor, setEditor] = useState<{ entry: LongTermGoal | null } | null>(null);
  const [readingId, setReadingId] = useState<number | null>(null);
  const [archiveId, setArchiveId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [notice, setNotice] = useState('');
  const reading = entries.find(entry => entry.id === readingId);
  const settings = location.pathname === '/garden/settings';

  useRegisterBackHandler(() => {
    if (editor) return false; // The editor owns dirty-state confirmation.
    if (archiveId !== null) { setArchiveId(null); return true; }
    if (readingId !== null) { setReadingId(null); return true; }
    if (settings) navigate('/garden', { replace: true });
    else navigate('/', { replace: true });
    return true;
  }, [editor, archiveId, readingId, settings, navigate]);

  if (settings) return <GardenSettings onRestored={() => void reload()} />;
  if (editor) return <main className="garden-page"><GardenConfessionEditor entry={editor.entry} onSave={save} onSaved={id => { setEditor(null); setReadingId(id); setNotice('已经收好。留给以后，慢慢读。'); }} onClose={() => setEditor(null)} /></main>;

  async function confirmArchive() {
    if (archiveId === null || archiving) return;
    setArchiving(true); setActionError('');
    try { await archive(archiveId); setReadingId(null); setArchiveId(null); setNotice('先收起来，想念时仍可以放回。'); }
    catch (e) { setActionError(e instanceof Error ? e.message : '未能收起，请重试。'); setArchiveId(null); }
    finally { setArchiving(false); }
  }

  return <main className="garden-page">
    <header className="garden-topbar">
      <button className="garden-text-button" onClick={() => { if (reading) { setReadingId(null); setNotice(''); } else navigate('/', { replace: true }); }}><ArrowLeft size={17} /> {reading ? '回到花园' : '轻轻离开'}</button>
      <span className="garden-small-mark"><span aria-hidden="true">◌</span> 此处，只有你</span>
    </header>
    {reading ? <article className="garden-letter-reading">
      <header><span className="garden-eyebrow">{dateLabel(reading.createdAt)}</span><h1>{reading.title || '一些没有题目的话'}</h1><span className="garden-letter-rule" aria-hidden="true" /></header>
      <div className="garden-letter-prose">{reading.description}</div>
      <div className="garden-letter-signoff"><span aria-hidden="true">✧</span><p>听见了。就让它在这里，歇一会儿。</p></div>
      <footer className="garden-reading-actions"><button className="garden-text-button" onClick={() => setEditor({ entry: reading })}><Pencil size={15} /> 再写几句</button><button className="garden-text-button" onClick={() => setArchiveId(reading.id!)}>暂时收起</button></footer>
    </article> : <>
      <section className="garden-welcome">
        <div className="garden-botanical" aria-hidden="true"><span /><span /><span /><i /></div>
        <span className="garden-eyebrow">A LITTLE ROOM FOR YOURSELF</span>
        <h1>秘密花园</h1><p>外面的事，先放在门外。<br />这里不需要你成为更好的谁。</p>
        <button className="garden-primary garden-confide-button" onClick={() => { setEditor({ entry: null }); setNotice(''); }}><Feather size={18} /> 倾述 <ArrowUpRight size={16} /></button>
        <small>写一段话，放下一点心事。</small>
      </section>
      <nav className="garden-tabs" aria-label="花园内容"><button aria-pressed={tab === 'letters'} onClick={() => setTab('letters')}><Feather size={15} /> 留下的话</button><button aria-pressed={tab === 'wishes'} onClick={() => setTab('wishes')}><Sprout size={15} /> 心里的愿望</button></nav>
      {tab === 'letters' ? <section className="garden-letters" aria-label="倾述记录">
        {loading ? <p className="garden-loading" role="status">正在翻开这些文字…</p> : error ? <div className="garden-error" role="alert">{error}<button className="garden-text-button" onClick={() => void reload()}>再试一次</button></div> : entries.length === 0 ? <div className="garden-empty"><span aria-hidden="true">✧</span><h2>还没有留下的话</h2><p>可以是一件小事，一个忽然的念头，<br />或是今天没能说出口的一句话。</p></div> : entries.map(entry => <button className="garden-letter-card" key={entry.id} onClick={() => { setReadingId(entry.id!); setNotice(''); }}><time dateTime={new Date(entry.createdAt).toISOString()}>{dateLabel(entry.createdAt)}</time><h2>{entry.title || '一些没有题目的话'}</h2><p>{entry.description}</p><span>展开这段话 <ArrowUpRight size={13} /></span></button>)}
      </section> : <GardenWishes />}
      <p className="garden-ground-note">慢慢来。这里没有截止日期。<button className="garden-ground-link" onClick={() => navigate('/garden/settings')}>花园设置</button></p>
    </>}
    {notice && <div className="garden-notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {actionError && <p className="garden-error" role="alert">{actionError}</p>}
    <ConfirmDialog open={archiveId !== null} message="先把这段话收起来？30 天内可以在花园设置中放回。" confirmText={archiving ? '正在收起…' : '收起来'} onConfirm={() => void confirmArchive()} onCancel={() => { if (!archiving) setArchiveId(null); }} />
  </main>;
}
