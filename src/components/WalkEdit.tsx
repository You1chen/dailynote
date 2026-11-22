import { useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type { Memory } from '../utils/wanderDeck';
import { collectMemories } from '../utils/wanderDeck';
import { saveCard } from '../db/knowledgeCards';
import { saveIdea } from '../db';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import KnowledgeCardEditor from './KnowledgeCardEditor';
import './WalkEdit.css';

interface Props {
  memory: Memory;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
}

export default function WalkEdit({ memory, onClose, onSaved }: Props) {
  if (memory.kind === '卡片') {
    return <KnowledgeCardEditor
      card={memory.card}
      onSave={async card => { await saveCard(card); onSaved(collectMemories([card], [])[0]); }}
      onClose={onClose}
    />;
  }
  return <IdeaEdit memory={memory} onClose={onClose} onSaved={onSaved} />;
}

function IdeaEdit({ memory, onClose, onSaved }: Props & { memory: Extract<Memory, { kind: '灵感' }> }) {
  const [title, setTitle] = useState(memory.idea.title ?? '');
  const [text, setText] = useState(memory.idea.text);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useRegisterBackHandler(() => { if (!busy) onClose(); return true; }, [busy, onClose]);

  const save = async () => {
    if (busy) return;
    if (!text.trim()) { setError('内容不能为空'); return; }
    setBusy(true);
    setError('');
    try {
      const next = { ...memory.idea, title: title.trim() || undefined, text: text.trim(), updatedAt: Date.now() };
      await saveIdea(next);
      onSaved(collectMemories([], [next])[0]);
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return <div className="walk-edit" role="dialog" aria-modal="true" aria-label="编辑灵感">
    <header>
      <button onClick={onClose} aria-label="返回回忆页"><ArrowLeft size={21} /></button>
      <span>编辑灵感</span>
      <button onClick={() => void save()} disabled={busy} aria-label="保存灵感"><Check size={20} /></button>
    </header>
    <main>
      <input value={title} onChange={event => setTitle(event.target.value)} placeholder="标题" aria-label="灵感标题" />
      <textarea value={text} onChange={event => setText(event.target.value)} placeholder="内容" aria-label="灵感内容" />
      <small>{memory.day}</small>
      {error && <p role="alert">{error}</p>}
    </main>
  </div>;
}
