import { useRef, useState } from 'react';
import { ArrowLeft, Check, Feather } from 'lucide-react';
import type { LongTermGoal } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  entry: LongTermGoal | null;
  onSave: (input: { id?: number; title: string; text: string }) => Promise<number>;
  onSaved: (id: number) => void;
  onClose: () => void;
}

export default function GardenConfessionEditor({ entry, onSave, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(entry?.title ?? '');
  const [text, setText] = useState(entry?.description ?? '');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const dirty = title !== (entry?.title ?? '') || text !== (entry?.description ?? '');

  function close() {
    if (saving.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  }

  useRegisterBackHandler(() => {
    if (discard) setDiscard(false);
    else close();
    return true;
  }, [dirty, discard, busy]);

  async function save() {
    if (saving.current || !text.trim()) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const id = await onSave({ id: entry?.id, title, text });
      onSaved(id);
    } catch (e) { setError(e instanceof Error ? e.message : '还没有保存成功，请重试。'); }
    finally { saving.current = false; setBusy(false); }
  }

  return <section className="garden-letter-editor" aria-labelledby="garden-editor-title" onKeyDown={e => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
  }}>
    <header className="garden-topbar">
      <button className="garden-text-button" disabled={busy} onClick={close}><ArrowLeft size={17} /> 暂时合上</button>
      <span className="garden-small-mark"><Feather size={13} /> 只写给自己</span>
    </header>
    <div className="garden-writing-intro">
      <span className="garden-eyebrow">{new Date(entry?.createdAt ?? Date.now()).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).replace('星期', ' · 星期')}</span>
      <h1 id="garden-editor-title">倾述</h1>
      <p>不必想好开头，也不必给心事一个答案。</p>
    </div>
    <div className="garden-paper">
      <label className="garden-sr-only" htmlFor="garden-letter-title">给这段话起个名字（可选）</label>
      <input id="garden-letter-title" className="garden-letter-title-input" value={title} onChange={e => setTitle(e.target.value)} disabled={busy} placeholder="给这段话起个名字，也可以不写" autoComplete="off" />
      <label className="garden-sr-only" htmlFor="garden-letter-body">想说的话</label>
      <textarea id="garden-letter-body" className="garden-letter-body-input" value={text} onChange={e => setText(e.target.value)} disabled={busy} placeholder="此刻，有什么想轻轻放下？" autoFocus spellCheck={false} />
      <span className="garden-paper-end" aria-hidden="true">✧</span>
    </div>
    <footer className="garden-writing-footer">
      <p>不必写得很好。真实就够了。</p>
      {error && <p className="garden-error" role="alert">{error}</p>}
      <button className="garden-primary" disabled={busy || !text.trim()} onClick={() => void save()}><Check size={17} /> {busy ? '正在收好…' : '留在这里'}</button>
      <small>保存后才会加密写入 · 未保存的文字只留在当前页面</small>
    </footer>
    <ConfirmDialog open={discard} message="这段话还没有保存。要先留在这里吗？" confirmText="不保存，合上" onConfirm={onClose} onCancel={() => setDiscard(false)} />
  </section>;
}
