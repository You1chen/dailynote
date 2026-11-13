import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, Download, Edit3, Plus, Save, Sparkles, X } from 'lucide-react';
import type { Course } from '../types';
import type { KnowledgeCard, KnowledgeMap, KnowledgeNode, KnowledgeStatus } from '../types/knowledge';
import { getKnowledgeMap, saveKnowledgeMap } from '../db';
import { buildKnowledgeNodes, KNOWLEDGE_STATUS_LABEL, nodesToMarkdown } from '../utils/knowledgeMap';
import { fileToCompressedDataURL } from '../utils/avatarCrop';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import './KnowledgeMapPanel.css';

interface Props { course: Course; onClose: () => void; initialNodeId?: string | null; }
const STATUS_ORDER: KnowledgeStatus[] = ['todo', 'debt', 'learned'];

function childrenOf(nodes: KnowledgeNode[], parentId?: string) {
  return nodes.filter(node => node.parentId === parentId);
}

function cardPreview(node: KnowledgeNode) {
  return (node.cards ?? [])
    .map(card => `${card.title}${card.text ? `：${card.text}` : ''}`)
    .join(' · ')
    .replace(/\s+/g, ' ')
    .slice(0, 90);
}

function newCard(): KnowledgeCard {
  return {
    id: `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: '', images: [], text: '', createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export default function KnowledgeMapPanel({ course, onClose, initialNodeId }: Props) {
  const [map, setMap] = useState<KnowledgeMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSource, setEditingSource] = useState(false);
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFlash, setStatusFlash] = useState<string | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [imagePos, setImagePos] = useState(0);
  const [cardDraft, setCardDraft] = useState<KnowledgeCard | null>(null);
  const [textFullscreen, setTextFullscreen] = useState(false);
  const [fullText, setFullText] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<'tree' | 'mind'>('tree');
  const swipeStart = useRef<{ x: number; y: number; kind: 'image' | 'card' } | null>(null);
  const suppressClick = useRef(false);
  const selected = map?.nodes.find(node => node.id === selectedId);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    let alive = true;
    getKnowledgeMap(course.id!).then(existing => {
      if (!alive) return;
      setMap(existing ?? null);
      setSource(existing?.sourceMarkdown ?? '');
      if (existing) {
        const target = initialNodeId ? existing.nodes.find(node => node.id === initialNodeId) : undefined;
        const open = new Set<string>();
        if (target) {
          let parent = target.parentId;
          while (parent) {
            open.add(parent);
            parent = existing.nodes.find(node => node.id === parent)?.parentId;
          }
          setSelectedId(target.id);
        }
        setExpanded(open);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [course.id]);

  useEffect(() => {
    setCardIndex(0);
    setImagePos(0);
    setCardDraft(null);
    setTextFullscreen(false);
    setLightbox(null);
  }, [selectedId]);

  useEffect(() => {
    const count = selected?.cards?.length ?? 0;
    if (cardIndex > Math.max(0, count - 1)) setCardIndex(Math.max(0, count - 1));
  }, [selected?.cards?.length, cardIndex]);

  useEffect(() => {
    const card = selected?.cards?.[cardIndex];
    setImagePos(card?.images.length ? 1 : 0);
  }, [cardIndex, selectedId]);

  useRegisterBackHandler(() => {
    if (lightbox) { setLightbox(null); return true; }
    if (textFullscreen) { setTextFullscreen(false); return true; }
    if (selectedId !== null) {
      if (cardDraft?.title.trim()) void saveCard({ ...cardDraft, title: cardDraft.title.trim() });
      setSelectedId(null);
      return true;
    }
    if (editingSource) { setEditingSource(false); return true; }
    onClose();
    return true;
  }, [selectedId, cardDraft, lightbox, textFullscreen, editingSource, onClose]);

  const visible = useMemo(() => {
    if (!map) return [];
    const out: { node: KnowledgeNode; level: number }[] = [];
    const visit = (parent: string | undefined, level: number) => {
      for (const node of childrenOf(map.nodes, parent)) {
        out.push({ node, level });
        if (expanded.has(node.id)) visit(node.id, level + 1);
      }
    };
    visit(undefined, 0);
    return out;
  }, [map, expanded]);

  async function saveSource() {
    const built = buildKnowledgeNodes(source, map?.nodes ?? []);
    if (built.error) { setSourceError(built.error); return; }
    const now = Date.now();
    const next: KnowledgeMap = map
      ? { ...map, sourceMarkdown: source, nodes: built.nodes, updatedAt: now }
      : { courseId: course.id!, courseName: course.name, sourceMarkdown: source, nodes: built.nodes, createdAt: now, updatedAt: now };
    const id = await saveKnowledgeMap(next);
    setMap({ ...next, id });
    setEditingSource(false);
    setSourceError('');
    setExpanded(new Set());
  }

  async function saveCard(card: KnowledgeCard) {
    if (!map || !selected) return;
    const cards = selected.cards ?? [];
    const existingIndex = cards.findIndex(item => item.id === card.id);
    const nextCards = existingIndex >= 0 ? cards.map(item => item.id === card.id ? card : item) : [...cards, card];
    const next: KnowledgeMap = {
      ...map,
      nodes: map.nodes.map(node => node.id === selected.id ? { ...node, cards: nextCards } : node),
      updatedAt: Date.now(),
    };
    await saveKnowledgeMap(next);
    setMap(next);
    setCardDraft(null);
    setCardIndex(existingIndex >= 0 ? existingIndex : cards.length);
    setImagePos(card.images.length ? 1 : 0);
  }

  async function deleteCard(cardId: string) {
    if (!map || !selected) return;
    const remaining = (selected.cards ?? []).filter(card => card.id !== cardId);
    const next: KnowledgeMap = {
      ...map,
      nodes: map.nodes.map(node => node.id === selected.id ? { ...node, cards: remaining } : node),
      updatedAt: Date.now(),
    };
    await saveKnowledgeMap(next);
    setMap(next);
    setCardDraft(null);
    const nextIndex = Math.min(cardIndex, Math.max(0, remaining.length - 1));
    setCardIndex(nextIndex);
    setImagePos(remaining[nextIndex]?.images.length ? 1 : 0);
  }

  async function switchCard(target: number | 'new') {
    if (cardDraft) {
      if (cardDraft.title.trim()) await saveCard({ ...cardDraft, title: cardDraft.title.trim() });
      else setCardDraft(null);
    }
    if (target === 'new') {
      setCardDraft(newCard());
      setImagePos(0);
      return;
    }
    const cards = selected?.cards ?? [];
    const targetCard = cards[target];
    if (!targetCard) return;
    setCardIndex(target);
    setImagePos(targetCard.images.length ? 1 : 0);
    setTextFullscreen(false);
  }

  function playLearnedSound() {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.24);
    } catch { /* Audio is optional and must never block saving. */ }
  }

  async function changeStatus(node: KnowledgeNode) {
    if (!map) return;
    const index = STATUS_ORDER.indexOf(node.status);
    const nextStatus = STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
    const next = {
      ...map,
      nodes: map.nodes.map(item => item.id === node.id ? { ...item, status: nextStatus } : item),
      updatedAt: Date.now(),
    };
    await saveKnowledgeMap(next);
    setMap(next);
    if (nextStatus === 'learned' && node.status !== 'learned') {
      setStatusFlash(node.id);
      playLearnedSound();
      window.setTimeout(() => setStatusFlash(null), 700);
    }
  }

  function exportText() {
    if (!map) return;
    const text = nodesToMarkdown(map.nodes, true);
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${course.name}-知识地图.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function beginSwipe(kind: 'image' | 'card', event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select,button,label')) return;
    swipeStart.current = { x: event.clientX, y: event.clientY, kind };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Non-blocking. */ }
  }

  function endSwipe(event: ReactPointerEvent<HTMLElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (start.kind === 'image') {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 350);
      const count = cardDraft?.images.length ?? selected?.cards?.[cardIndex]?.images.length ?? 0;
      if (count > 0) setImagePos(pos => Math.max(0, Math.min(count + 1, pos + (dx < 0 ? 1 : -1))));
      else void switchCard(cardIndex + (dx < 0 ? 1 : -1));
    } else {
      void switchCard(cardIndex + (dx < 0 ? 1 : -1));
    }
  }

  if (loading) return <div className="knowledge-panel"><p>正在打开知识地图…</p></div>;

  if (selected) {
    const cards = selected.cards ?? [];
    const activeCard = cards[cardIndex];
    const draft = cardDraft ?? activeCard;
    const imageCount = draft?.images.length ?? 0;
    const safeImagePos = Math.max(0, Math.min(imageCount + 1, imagePos));
    const currentImage = imageCount > 0 && safeImagePos >= 1 && safeImagePos <= imageCount
      ? draft!.images[safeImagePos - 1]
      : null;
    const isAddSlide = !!draft && (!imageCount || safeImagePos === 0 || safeImagePos === imageCount + 1);
    const selectValue = cardDraft && !cards.some(card => card.id === cardDraft.id)
      ? '__new'
      : cards.length ? String(cardIndex) : '__new';

    const setCardField = (changes: Partial<KnowledgeCard>) => setCardDraft(current => ({
      ...(current ?? activeCard ?? newCard()),
      ...changes,
      updatedAt: Date.now(),
    }));

    const addImages = async (files: FileList | null, atStart = false) => {
      if (!files?.length) return;
      const added = (await Promise.all(Array.from(files).map(file => fileToCompressedDataURL(file, 1600, 0.82)))).filter(Boolean);
      if (!added.length) return;
      const existing = draft?.images ?? [];
      setCardField({ images: atStart ? [...added, ...existing] : [...existing, ...added] });
      setImagePos(atStart ? 1 : existing.length + 1);
    };

    const addPanel = (atStart: boolean, empty = false) => (
      <div className="knowledge-image-add">
        <label className="knowledge-image-add-control">
          <span className="knowledge-image-add-circle"><Plus size={34} /></span>
          <strong>添加图片</strong>
          <small>{empty ? '点这里选择图片' : atStart ? '放在最前面' : '加在最后'}</small>
          <input
            className="knowledge-image-file"
            type="file"
            accept="image/*"
            multiple
            onChange={event => {
              void addImages(event.currentTarget.files, atStart);
              event.currentTarget.value = '';
            }}
          />
        </label>
        {!empty && <button type="button" className="knowledge-image-back" onClick={() => setImagePos(atStart ? 1 : imageCount)}>返回图片</button>}
      </div>
    );

    return <div className="knowledge-panel knowledge-card-page">
      <header className="knowledge-header">
        <button className="knowledge-icon-btn" onClick={() => setSelectedId(null)} aria-label="返回知识地图"><ArrowLeft size={19} /></button>
        <div><span className="knowledge-kicker">{course.name}</span><h2>{selected.title}</h2></div>
        <button className="knowledge-icon-btn" onClick={() => void switchCard('new')} aria-label="新建卡片"><Plus size={18} /></button>
      </header>

      <div className="knowledge-card-switcher">
        <label htmlFor="knowledge-card-select">卡片</label>
        <select
          id="knowledge-card-select"
          value={selectValue}
          onChange={event => {
            const value = event.target.value;
            void switchCard(value === '__new' ? 'new' : Number(value));
          }}
        >
          {cards.map((card, index) => <option key={card.id} value={index}>{card.title || `未命名卡片 ${index + 1}`}</option>)}
          <option value="__new">＋ 新建卡片</option>
        </select>
        <span className="knowledge-card-count">{cards.length ? `${Math.min(cardIndex + 1, cards.length)} / ${cards.length}` : '0 / 0'}</span>
      </div>

      {cards.length > 1 && <div
        className="knowledge-card-rail"
        onPointerDown={event => beginSwipe('card', event)}
        onPointerUp={endSwipe}
        onPointerCancel={() => { swipeStart.current = null; }}
      >
        <span aria-hidden="true">‹</span>
        <span>左右滑动切换卡片</span>
        <span aria-hidden="true">›</span>
      </div>}

      <div className="knowledge-card-stage">
        {draft ? <>
          <input className="knowledge-card-title-input" value={draft.title} onChange={event => setCardField({ title: event.target.value })} placeholder="卡片名称（必填）" />

          <div
            className="knowledge-image-frame"
            onPointerDown={event => beginSwipe('image', event)}
            onPointerUp={endSwipe}
            onPointerCancel={() => { swipeStart.current = null; }}
          >
            {isAddSlide ? addPanel(safeImagePos === 0, imageCount === 0) : <>
              <img
                src={currentImage!}
                alt={`卡片图片 ${safeImagePos}`}
                draggable={false}
                onClick={() => {
                  if (suppressClick.current) { suppressClick.current = false; return; }
                  setLightbox(currentImage);
                }}
              />
              <span className="knowledge-image-counter">{safeImagePos} / {imageCount}</span>
              <button className="knowledge-image-delete" onClick={() => {
                const remaining = draft.images.filter((_, index) => index !== safeImagePos - 1);
                setCardField({ images: remaining });
                setImagePos(remaining.length ? Math.min(safeImagePos - 1, remaining.length) : 0);
              }} aria-label="删除图片"><X size={16} /></button>
              <button className="knowledge-image-prev" onClick={() => setImagePos(pos => Math.max(0, pos - 1))} aria-label="上一张">‹</button>
              <button className="knowledge-image-next" onClick={() => setImagePos(pos => Math.min(imageCount + 1, pos + 1))} aria-label="下一张">›</button>
            </>}
          </div>

          <div className="knowledge-card-dots">
            {draft.images.map((_, index) => <button
              key={index}
              className={safeImagePos === index + 1 ? 'is-active' : ''}
              onClick={() => setImagePos(index + 1)}
              aria-label={`第 ${index + 1} 张图片`}
            />)}
          </div>
          {imageCount > 0 && <p className="knowledge-swipe-hint">左右滑动切换图片 · 滑到首尾可添加</p>}

          <div className="knowledge-card-text-wrap">
            <textarea className="knowledge-card-text" value={draft.text} onChange={event => setCardField({ text: event.target.value })} placeholder="补充一点文字说明（可选）" />
            <button onClick={() => { setFullText(draft.text); setTextFullscreen(true); }}>全屏输入</button>
          </div>

          <div className="knowledge-card-actions">
            <select value={draft.status ?? ''} onChange={event => setCardField({ status: (event.target.value || undefined) as KnowledgeStatus | undefined })} aria-label="卡片状态">
              <option value="">状态留空</option>
              <option value="todo">待学</option>
              <option value="debt">负债</option>
              <option value="learned">已学</option>
            </select>
            <button className="knowledge-save" disabled={!draft.title.trim()} onClick={() => void saveCard({ ...draft, title: draft.title.trim() })}><Save size={15} /> 保存卡片</button>
            <button className="knowledge-danger" onClick={() => void deleteCard(draft.id)}>删除</button>
          </div>
        </> : <div className="knowledge-card-empty">
          <Plus size={56} />
          <button onClick={() => void switchCard('new')}>建立第一张卡片</button>
        </div>}
      </div>


      {textFullscreen && <div className="knowledge-text-fullscreen">
        <section>
          <header><h3>文字说明</h3><button onClick={() => setTextFullscreen(false)} aria-label="关闭"><X size={18} /></button></header>
          <textarea value={fullText} onChange={event => setFullText(event.target.value)} autoFocus />
          <footer>
            <button onClick={() => setTextFullscreen(false)}>取消</button>
            <button className="knowledge-save" onClick={() => { setCardField({ text: fullText }); setTextFullscreen(false); }}>保存文字</button>
          </footer>
        </section>
      </div>}

      {lightbox && <div className="knowledge-lightbox" onClick={() => setLightbox(null)}><img src={lightbox} alt="全屏图片" /></div>}
    </div>;
  }

  return <div className="knowledge-panel">
    <header className="knowledge-header">
      <button className="knowledge-icon-btn" onClick={onClose} aria-label="返回课程"><ArrowLeft size={19} /></button>
      <div><span className="knowledge-kicker">{course.name}</span><h2>知识地图</h2></div>
      <div className="knowledge-head-actions">
        <button className="knowledge-icon-btn" onClick={() => setPresentation(value => value === 'tree' ? 'mind' : 'tree')} aria-label={presentation === 'tree' ? '查看思维导图' : '查看知识树'}>{presentation === 'tree' ? <Sparkles size={17} /> : <BookOpen size={17} />}</button>
        <button className="knowledge-icon-btn" onClick={exportText} aria-label="导出知识地图"><Download size={18} /></button>
      </div>
    </header>

    {!map || !map.nodes.length
      ? <section className="knowledge-empty"><Sparkles size={24} /><h3>先搭一张知识树</h3><p>用熟悉的 Markdown 列表写下章节，之后可以逐级展开学习。</p><button className="knowledge-primary" onClick={() => setEditingSource(true)}><Edit3 size={16} /> 输入知识树</button></section>
      : presentation === 'mind'
        ? <section className="knowledge-mind" aria-label="思维导图预览">{childrenOf(map.nodes).map(root => <article className={`knowledge-mind-root knowledge-mind-root--${root.status}`} key={root.id}><h3>{root.title}</h3>{cardPreview(root) && <p className="knowledge-mind-root-note">{cardPreview(root)}</p>}<div className="knowledge-mind-branches">{childrenOf(map.nodes, root.id).map(child => <div className="knowledge-mind-branch" key={child.id}><strong>{child.title}</strong>{child.page && <small>{child.page}</small>}{cardPreview(child) && <p>{cardPreview(child)}</p>}{childrenOf(map.nodes, child.id).slice(0, 8).map(leaf => <span key={leaf.id} className={`knowledge-mind-leaf knowledge-mind-leaf--${leaf.status}`}>{leaf.title}{cardPreview(leaf) && ` · ${cardPreview(leaf)}`}</span>)}</div>)}</div></article>)}</section>
        : <>
          <div className="knowledge-toolbar"><span>{map.nodes.length} 个节点</span><button onClick={() => setEditingSource(true)}><Edit3 size={14} /> 编辑 Markdown</button></div>
          <section className="knowledge-tree" aria-label="知识树">{visible.map(({ node, level }) => <div key={node.id} className={`knowledge-row knowledge-row--${node.status} ${statusFlash === node.id ? 'knowledge-row--flash' : ''}`} style={{ paddingLeft: 12 + level * 20 }}><button className="knowledge-expand" onClick={() => node.children.length ? setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; }) : setSelectedId(node.id)} aria-label={node.children.length ? expanded.has(node.id) ? '收起' : '展开' : '打开笔记'}>{node.children.length ? expanded.has(node.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <BookOpen size={14} />}</button><button className="knowledge-row-main" onClick={() => node.children.length ? setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; }) : setSelectedId(node.id)}><span className="knowledge-dot" /><span className="knowledge-title">{node.title}</span>{node.page && <small>{node.page}</small>}{node.cards?.length ? <span className="knowledge-note-mark">卡片</span> : null}</button><button className="knowledge-status" onClick={() => void changeStatus(node)}>{KNOWLEDGE_STATUS_LABEL[node.status]}</button></div>)}</section>
        </>}

    {editingSource && <div className="knowledge-editor-backdrop"><section className="knowledge-editor"><header><h3>输入知识树</h3><button onClick={() => setEditingSource(false)} aria-label="关闭"><X size={18} /></button></header><textarea value={source} onChange={event => { setSource(event.target.value); setSourceError(''); }} placeholder={'- 绪论 p1\n- 第一章 数制和码制 p4\n  - 1.1 概述 p4'} autoFocus />{sourceError && <p className="knowledge-error">{sourceError}</p>}<footer><button onClick={() => setEditingSource(false)}>取消</button><button className="knowledge-primary" onClick={() => void saveSource()}><Check size={16} /> 生成知识树</button></footer></section></div>}
  </div>;
}
