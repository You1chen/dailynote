import { useState } from 'react';
import { X, Sparkles, Star, ListChecks, Plus, Trash2, Hash, Check } from 'lucide-react';
import { useIdeas } from '../hooks/useIdeas';
import { playChime } from '../utils/sound';
import { todayStr } from '../types';
import type { Idea, MindKind } from '../types';
import './MindSheet.css';

interface Props {
  onClose: () => void;
  /** 默认打开的那一类 */
  initialKind?: MindKind;
  /** 记到哪一天（默认今天） */
  date?: string;
  /** 只开放其中几类（默认三类；只剩一类时隐藏切换） */
  kinds?: MindKind[];
  /** 想看别的日子的灵感：跳到能翻日期的页面 */
  onBrowseDates?: () => void;
}

const KINDS: { key: MindKind; label: string; icon: typeof Sparkles; hint: string }[] = [
  { key: 'wish', label: '小愿望', icon: Star, hint: '想做的事，小小的也算' },
  { key: 'chore', label: '琐事', icon: ListChecks, hint: '记下来就不会忘' },
  { key: 'idea', label: '灵感', icon: Sparkles, hint: '一闪而过的念头' },
];

/** 杂念面板：小愿望（俏皮）/ 琐事（简约）/ 灵感（灵光一闪），三种各自一套界面 */
export default function MindSheet({ onClose, initialKind = 'wish', date, kinds, onBrowseDates }: Props) {
  const { byKind, addMind, updateIdea, removeIdea } = useIdeas();
  const allowed = kinds && kinds.length > 0 ? KINDS.filter(k => kinds.includes(k.key)) : KINDS;
  const [kind, setKind] = useState<MindKind>(
    kinds && kinds.length > 0 ? kinds[0] : initialKind,
  );

  const [line, setLine] = useState('');          // 愿望 / 琐事
  const [title, setTitle] = useState('');        // 灵感
  const [detail, setDetail] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // 就地编辑 / 展开详情 / 实现动画
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [flying, setFlying] = useState(false);

  const day = date || todayStr();
  /** 灵感只看选中日期（默认今天）；愿望与琐事跨天存在，不按日期筛 */
  const todaysIdeas = byKind.idea.filter(i => i.date === day);

  const addLine = async () => {
    const text = line.trim();
    if (!text) return;
    setLine('');
    if (kind === 'wish') playChime();
    await addMind({ kind, text, date: day, source: 'todo' });
  };

  const addIdea = async () => {
    const t = title.trim();
    const d = detail.trim();
    if (!t && !d) return;
    setTitle('');
    setDetail('');
    setTags([]);
    await addMind({ kind: 'idea', title: t || undefined, text: d || t, tags, date: day, source: 'todo' });
  };

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '');
    if (!t || tags.includes(t)) { setTagDraft(''); return; }
    setTags([...tags, t]);
    setTagDraft('');
  };

  /** 点条目 → 就地改内容（灵感改标题，其余改正文） */
  function startEdit(item: Idea) {
    setEditId(item.id ?? null);
    setEditText(item.kind === 'idea' ? (item.title || item.text) : item.text);
  }

  async function commitEdit(item: Idea) {
    const v = editText.trim();
    setEditId(null);
    if (!v || !item.id) return;
    const patch = item.kind === 'idea' ? { title: v, text: item.text || v } : { text: v };
    await updateIdea(item, patch);
  }

  /** 实现一条：闪一下 → 消失（小愿望额外放一声叮 + 划过的星星） */
  async function realize(item: Idea) {
    if (!item.id) return;
    const id = item.id;
    setFlashId(id);
    if (item.kind === 'wish') {
      playChime();
      setFlying(true);
      window.setTimeout(() => setFlying(false), 1200);
    }
    const delay = item.kind === 'wish' ? 420 : 240;
    window.setTimeout(() => {
      void removeIdea(id);
      setFlashId(null);
    }, delay);
  }

  return (
    <div className="mind-mask" onClick={onClose}>
      <div className="mind-sheet" onClick={e => e.stopPropagation()}>
        <div className="mind-head">
          <span className="mind-title">杂念</span>
          <button className="mind-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {allowed.length > 1 && (
          <div className="mind-tabs">
            {allowed.map(k => {
              const Icon = k.icon;
              return (
                <button
                  key={k.key}
                  className={`mind-tab mind-tab--${k.key} ${kind === k.key ? 'is-on' : ''}`}
                  onClick={() => setKind(k.key)}
                >
                  <Icon size={15} />
                  {k.label}
                </button>
              );
            })}
          </div>
        )}

        {/* 小愿望：活泼 */}
        {kind === 'wish' && (
          <div className="mind-body mind-body--wish">
            <div className="wish-hint">{KINDS[0].hint}</div>
            <div className="wish-input-row">
              <input
                className="wish-input"
                value={line}
                placeholder="许一个小愿望…"
                onChange={e => setLine(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addLine(); } }}
              />
              <button className="wish-add" onClick={() => void addLine()} aria-label="加入愿望">
                <Plus size={18} />
              </button>
            </div>

            <div className="wish-list">
              {byKind.wish.length === 0 && <p className="mind-empty">还没有愿望，星星在等你的第一颗</p>}
              {byKind.wish.map(w => (
                <div key={w.id} className={`wish-item ${flashId === w.id ? 'mind-flash' : ''}`}>
                  <button className="wish-star" title="实现它" onClick={() => void realize(w)}>
                    <Star size={14} fill="currentColor" />
                  </button>

                  {editId === w.id ? (
                    <input
                      className="mind-edit"
                      autoFocus
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onBlur={() => void commitEdit(w)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitEdit(w); }
                        if (e.key === 'Escape') setEditId(null);
                      }}
                    />
                  ) : (
                    <span className="wish-text" onClick={() => startEdit(w)}>{w.text}</span>
                  )}

                  <button className="mind-del" onClick={() => w.id != null && void removeIdea(w.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 琐事：简约 */}
        {kind === 'chore' && (
          <div className="mind-body mind-body--chore">
            <div className="chore-input-row">
              <input
                className="chore-input"
                value={line}
                placeholder="记一件杂事"
                onChange={e => setLine(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addLine(); } }}
              />
              <button className="chore-add" onClick={() => void addLine()}>记下</button>
            </div>

            <div className="chore-list">
              {byKind.chore.length === 0 && <p className="mind-empty">暂无琐事</p>}
              {byKind.chore.map(c => (
                <div key={c.id} className={`chore-item ${flashId === c.id ? 'mind-flash' : ''}`}>
                  <button className="chore-done" title="办完了" onClick={() => void realize(c)}>
                    <Check size={13} />
                  </button>

                  {editId === c.id ? (
                    <input
                      className="mind-edit mind-edit--chore"
                      autoFocus
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onBlur={() => void commitEdit(c)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitEdit(c); }
                        if (e.key === 'Escape') setEditId(null);
                      }}
                    />
                  ) : (
                    <span className="chore-text" onClick={() => startEdit(c)}>{c.text}</span>
                  )}

                  <button className="mind-del" onClick={() => c.id != null && void removeIdea(c.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 灵感：灵光一闪 */}
        {kind === 'idea' && (
          <div className="mind-body mind-body--idea">
            <div className="idea-card">
              <div className="idea-glow" />
              <input
                className="idea-title"
                value={title}
                placeholder="给它一个名字"
                onChange={e => setTitle(e.target.value)}
              />
              <textarea
                className="idea-detail"
                rows={3}
                value={detail}
                placeholder="把这个念头写清楚一点…"
                onChange={e => setDetail(e.target.value)}
              />
              <div className="idea-tags">
                {tags.map(t => (
                  <span key={t} className="idea-tag">
                    <Hash size={10} />{t}
                    <button onClick={() => setTags(tags.filter(x => x !== t))}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  className="idea-tag-input"
                  value={tagDraft}
                  placeholder="标签"
                  onChange={e => setTagDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                    if (e.key === 'Backspace' && !tagDraft && tags.length) setTags(tags.slice(0, -1));
                  }}
                />
              </div>
              <button className="idea-save" onClick={() => void addIdea()}>
                <Sparkles size={15} /> 记住这一下
              </button>
            </div>

            <div className="idea-day">
              <span>{day.slice(5)} 的灵感</span>
              {onBrowseDates && (
                <button className="idea-day-link" onClick={onBrowseDates}>看其它日子</button>
              )}
            </div>

            <div className="idea-list">
              {todaysIdeas.length === 0 && <p className="mind-empty">这一天还没有灵感</p>}
              {todaysIdeas.map(i => (
                <div key={i.id} className={`idea-item ${flashId === i.id ? 'mind-flash' : ''}`}>
                  <div className="idea-item-head">
                    {editId === i.id ? (
                      <input
                        className="mind-edit"
                        autoFocus
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onBlur={() => void commitEdit(i)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); void commitEdit(i); }
                          if (e.key === 'Escape') setEditId(null);
                        }}
                      />
                    ) : (
                      <span className="idea-item-title" onClick={() => startEdit(i)}>
                        {i.title || i.text.slice(0, 16)}
                      </span>
                    )}
                    <button
                      className={`idea-more ${expandedId === i.id ? 'is-on' : ''}`}
                      title="详情"
                      onClick={() => setExpandedId(expandedId === i.id ? null : (i.id ?? null))}
                    >…</button>
                    <button className="idea-done" title="已实现" onClick={() => void realize(i)}>
                      <Check size={13} />
                    </button>
                    <button className="mind-del" onClick={() => i.id != null && void removeIdea(i.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {expandedId === i.id && (
                    <div className="idea-item-body">
                      {i.title && <p className="idea-item-text">{i.text}</p>}
                      {(i.tags?.length ?? 0) > 0 && (
                        <div className="idea-item-tags">
                          {i.tags!.map(t => (
                            <span key={t} className="idea-tag idea-tag--mini"><Hash size={9} />{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {flying && <span className="wish-fly" aria-hidden="true">★</span>}
      </div>
    </div>
  );
}
