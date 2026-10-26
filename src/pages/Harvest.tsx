import { useEffect, useState } from 'react';
import { Plus, Trash2, Hash, Edit3, Lightbulb, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import DayNavigator from '../components/DayNavigator';
import FullscreenEditor from '../components/FullscreenEditor';
import { useHarvests } from '../hooks/useHarvests';
import { useIdeas } from '../hooks/useIdeas';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { todayStr } from '../types';
import type { Harvest } from '../types';
import './Harvest.css';

function extractTags(text: string): string[] {
  const matches = text.match(/#[一-龥\w]+/g);
  return matches ? [...new Set(matches.map(t => t.slice(1)))] : [];
}

function renderContent(text: string) {
  const parts = text.split(/(#[一-龥\w]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('#')) {
      return <span key={i} className="harvest-tag-inline">{part}</span>;
    }
    return <span key={i}>{part}</span>;
  });
}

/** 从合并文本中拆出标题和正文（首行≤30字视为标题） */
function splitContent(content: string): { title: string; body: string } {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[0].length <= 30) {
    return { title: lines[0], body: lines.slice(1).join('\n') };
  }
  return { title: '', body: content };
}

export default function HarvestPage() {
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(searchParams.get('date') || todayStr());

  useEffect(() => {
    const d = searchParams.get('date');
    if (d) setDate(d);
  }, [searchParams]);
  const { harvests, loading, addOrUpdate, remove } = useHarvests(date);
  const { ideas, addIdea, removeIdea, countByDate } = useIdeas();
  const [editorOpen, setEditorOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // 返回键：关闭全屏编辑器
  useRegisterBackHandler(() => {
    if (editorOpen) {
      setEditorOpen(false);
      return true;
    }
    return false;
  }, [editorOpen]);

  const openEditor = () => {
    setTitle('');
    setBody('');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody && !title.trim()) return;
    const combined = title.trim()
      ? `${title.trim()}\n${trimmedBody}`
      : trimmedBody;
    const tags = extractTags(combined);
    const h: Harvest = {
      date,
      period: 'evening',
      subject: tags.join(', '),
      content: combined,
      createdAt: Date.now(),
    };
    await addOrUpdate(h);
    setEditorOpen(false);
  };

  const todayHarvests = harvests
    .filter(h => h.date === date)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="app-container">
      <DayNavigator date={date} onDateChange={setDate} marks={countByDate()} />

      <div className="harvest-actions">
        <button className="btn btn-primary harvest-add-btn" onClick={openEditor}>
          <Edit3 size={18} /> 记录今天的收获
        </button>
        <button className="btn btn-outline harvest-idea-btn" onClick={() => setIdeaOpen(true)}>
          <Lightbulb size={18} /> 灵感{ideas.length > 0 ? ` ${ideas.length}` : ''}
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>加载中...</p></div>
      ) : todayHarvests.length === 0 ? (
        <div className="empty-state">
          <p>今天还没有收获记录</p>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
            学到了什么？用 #关键字 分类
          </p>
        </div>
      ) : (
        <div className="harvest-list">
          {todayHarvests.map((h, idx) => {
            const { title: hTitle, body: hBody } = splitContent(h.content);
            return (
              <div key={h.id} className="harvest-card animate-in" style={{ animationDelay: `${idx * 40}ms` }}>
                <div className="harvest-card-body">
                  {hTitle && <h4 className="harvest-card-title">{renderContent(hTitle)}</h4>}
                  <p className="harvest-text">{renderContent(hBody)}</p>
                  {h.subject && (
                    <div className="harvest-tags">
                      {h.subject.split(', ').filter(Boolean).map(tag => (
                        <span key={tag} className="harvest-tag-chip">#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-ghost btn-icon btn-sm harvest-delete"
                  onClick={() => h.id && remove(h.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {ideaOpen && (
        <div className="modal-overlay" onClick={() => setIdeaOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="harvest-idea-head">
              <h3 className="modal-title">灵感</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setIdeaOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="harvest-idea-input">
              <input
                className="input"
                value={ideaDraft}
                placeholder="想到什么就写什么"
                onChange={e => setIdeaDraft(e.target.value)}
                onKeyDown={async e => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const text = ideaDraft.trim();
                  if (!text) return;
                  setIdeaDraft('');
                  await addIdea(text, date, 'harvest');
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  const text = ideaDraft.trim();
                  if (!text) return;
                  setIdeaDraft('');
                  await addIdea(text, date, 'harvest');
                }}
              >记下</button>
            </div>

            <div className="harvest-idea-list">
              {ideas.filter(i => i.date === date).length === 0 ? (
                <p className="harvest-idea-empty">{date} 还没有灵感</p>
              ) : ideas.filter(i => i.date === date).map(i => (
                <div key={i.id} className="harvest-idea-item">
                  <span className="harvest-idea-text">{i.text}</span>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => i.id != null && removeIdea(i.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <FullscreenEditor
        visible={editorOpen}
        editorTitle="记录收获"
        titleValue={title}
        bodyValue={body}
        onTitleChange={setTitle}
        onBodyChange={setBody}
        onSave={handleSave}
        onCancel={() => setEditorOpen(false)}
        titlePlaceholder="一句话概括（可选）"
        bodyPlaceholder="写下今天学到了什么..."
        extra={
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Hash size={12} /> #关键字 自动识别为标签
          </p>
        }
      />
    </div>
  );
}
