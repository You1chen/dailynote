import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, Download, Edit3, Minus, Plus, Save, Sparkles, X } from 'lucide-react';
import type { Course } from '../types';
import type { KnowledgeCard, KnowledgeMap, KnowledgeNode, KnowledgeStatus } from '../types/knowledge';
import { getKnowledgeMap, saveKnowledgeMap } from '../db';
import { buildKnowledgeNodes, KNOWLEDGE_STATUS_LABEL, nodesToMarkdown, noteToText, parseNoteBlocks } from '../utils/knowledgeMap';
import { renderKnowledgeNoteText } from '../utils/knowledgeNoteRender';
import { fileToCompressedDataURL } from '../utils/avatarCrop';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import './KnowledgeMapPanel.css';

interface Props { course: Course; onClose: () => void; initialNodeId?: string | null; }
const STATUS_ORDER: KnowledgeStatus[] = ['todo', 'debt', 'learned'];

function childrenOf(nodes: KnowledgeNode[], parentId?: string) { return nodes.filter(node => node.parentId === parentId); }
function notePreview(node: KnowledgeNode) { return noteToText(node.note).replace(/\s+/g, ' ').slice(0, 90); }

export default function KnowledgeMapPanel({ course, onClose, initialNodeId }: Props) {
  const [map, setMap] = useState<KnowledgeMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSource, setEditingSource] = useState(false);
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFlash, setStatusFlash] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [cardDraft, setCardDraft] = useState<KnowledgeCard | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<'tree' | 'mind'>('tree');
  const selected = map?.nodes.find(node => node.id === selectedId);

  useEffect(() => {
    let alive = true;
    getKnowledgeMap(course.id!).then(existing => {
      if (!alive) return;
      setMap(existing ?? null); setSource(existing?.sourceMarkdown ?? '');
      if (existing) {
        const target = initialNodeId ? existing.nodes.find(node => node.id === initialNodeId) : undefined;
        const open = new Set<string>();
        if (target) {
          let parent = target.parentId;
          while (parent) { open.add(parent); parent = existing.nodes.find(node => node.id === parent)?.parentId; }
          setSelectedId(target.id);
        }
        setExpanded(open);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [course.id]);

  useEffect(() => { setNoteText(selected ? noteToText(selected.note) : ''); setNoteDirty(false); setCardIndex(0); setCardDraft(null); }, [selectedId, selected?.note?.updatedAt]);

  useRegisterBackHandler(() => {
    if (selectedId !== null) { if (noteDirty) void saveNote(); else setSelectedId(null); return true; }
    if (editingSource) { setEditingSource(false); return true; }
    onClose(); return true;
  }, [selectedId, noteDirty, editingSource, onClose]);

  const roots = useMemo(() => map ? childrenOf(map.nodes) : [], [map]);
  const visible = useMemo(() => {
    if (!map) return [];
    const out: { node: KnowledgeNode; level: number }[] = [];
    const visit = (parent: string | undefined, level: number) => {
      for (const node of childrenOf(map.nodes, parent)) { out.push({ node, level }); if (expanded.has(node.id)) visit(node.id, level + 1); }
    };
    visit(undefined, 0); return out;
  }, [map, expanded]);

  async function saveSource() {
    const built = buildKnowledgeNodes(source, map?.nodes ?? []);
    if (built.error) { setSourceError(built.error); return; }
    const now = Date.now();
    const next: KnowledgeMap = map ? { ...map, sourceMarkdown: source, nodes: built.nodes, updatedAt: now } : { id: undefined, courseId: course.id!, courseName: course.name, sourceMarkdown: source, nodes: built.nodes, createdAt: now, updatedAt: now };
    const id = await saveKnowledgeMap(next); setMap({ ...next, id }); setEditingSource(false); setSourceError('');
    setExpanded(new Set(built.nodes.filter(node => node.depth === 0).map(node => node.id)));
  }

  async function saveCard(card: KnowledgeCard) {
    if (!map || !selected) return;
    const cards = selected.cards ?? [];
    const next: KnowledgeMap = { ...map, nodes: map.nodes.map(node => node.id === selected.id ? { ...node, cards: cards.some(item => item.id === card.id) ? cards.map(item => item.id === card.id ? card : item) : [...cards, card] } : node), updatedAt: Date.now() };
    await saveKnowledgeMap(next); setMap(next); setCardDraft(null);
  }

  async function deleteCard(cardId: string) {
    if (!map || !selected) return;
    const next: KnowledgeMap = { ...map, nodes: map.nodes.map(node => node.id === selected.id ? { ...node, cards: (node.cards ?? []).filter(card => card.id !== cardId) } : node), updatedAt: Date.now() };
    await saveKnowledgeMap(next); setMap(next); setCardIndex(0);
  }

  async function saveNote() {
    if (!map || !selected) return;
    const nextNodes = map.nodes.map(node => node.id === selected.id ? { ...node, note: parseNoteBlocks(noteText, node.note) } : node);
    const next: KnowledgeMap = { ...map, nodes: nextNodes, updatedAt: Date.now() };
    await saveKnowledgeMap(next); setMap(next); setNoteDirty(false);
  }

  async function toggleBlock(blockId: string) {
    if (!map || !selected?.note) return;
    const next: KnowledgeMap = { ...map, nodes: map.nodes.map(node => node.id === selected.id ? { ...node, note: { ...selected.note!, blocks: selected.note!.blocks.map(item => item.id === blockId ? { ...item, checked: !item.checked } : item), updatedAt: Date.now() } } : node), updatedAt: Date.now() };
    await saveKnowledgeMap(next); setMap(next);
  }

  function playLearnedSound() {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = 660; oscillator.type = 'sine'; gain.gain.setValueAtTime(0.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.24);
    } catch { /* Audio is optional and must never block saving. */ }
  }

  async function changeStatus(node: KnowledgeNode) {
    if (!map) return;
    const index = STATUS_ORDER.indexOf(node.status); const nextStatus = STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
    const next = { ...map, nodes: map.nodes.map(item => item.id === node.id ? { ...item, status: nextStatus } : item), updatedAt: Date.now() };
    await saveKnowledgeMap(next); setMap(next);
    if (nextStatus === 'learned' && node.status !== 'learned') { setStatusFlash(node.id); playLearnedSound(); window.setTimeout(() => setStatusFlash(null), 700); }
  }

  function exportText() {
    if (!map) return;
    const text = nodesToMarkdown(map.nodes, true);
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${course.name}-知识地图.md`; a.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <div className="knowledge-panel"><p>正在打开知识地图…</p></div>;
  if (selected) {
    const cards = selected.cards ?? [];
    const activeCard = cards[cardIndex];
    const draft = cardDraft ?? activeCard;
    const activeImage = draft?.images[imageIndex];
    const setCardField = (changes: Partial<KnowledgeCard>) => setCardDraft(current => ({ ...(current ?? activeCard ?? { id: `card-${Date.now()}`, title: '', images: [], text: '', createdAt: Date.now(), updatedAt: Date.now() }), ...changes, updatedAt: Date.now() }));
    const setTextFullscreen = () => { const next = window.prompt('文字说明', draft?.text ?? ''); if (next !== null) setCardField({ text: next }); };
    const addImages = (files: FileList | null) => { if (!files) return; Promise.all(Array.from(files).map(file => fileToCompressedDataURL(file, 1600, 0.82))).then(images => setCardField({ images: [...(draft?.images ?? []), ...images.filter(Boolean)] })).catch(() => undefined); };
    return <div className="knowledge-panel knowledge-card-page">
      <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={() => setSelectedId(null)} aria-label="返回知识地图"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">{course.name}</span><h2>{selected.title}</h2></div><button className="knowledge-icon-btn" onClick={() => setCardDraft({ id: `card-${Date.now()}`, title: '', images: [], text: '', createdAt: Date.now(), updatedAt: Date.now() })} aria-label="新建卡片"><Plus size={18} /></button></header>
      <div className="knowledge-card-stage">
        {draft ? <>
          <input className="knowledge-card-title-input" value={draft.title} onChange={e => setCardField({ title: e.target.value })} placeholder="卡片名称（必填）" />
          <div className="knowledge-image-frame">
            {draft.images.length ? <><img src={activeImage} alt={`卡片图片 ${imageIndex + 1}`} onClick={() => setLightbox(activeImage)} /><button className="knowledge-image-delete" onClick={() => { setCardField({ images: draft.images.filter((_, index) => index !== imageIndex) }); setImageIndex(Math.max(0, imageIndex - 1)); }} aria-label="删除图片"><X size={16} /></button><button className="knowledge-image-prev" onClick={() => setImageIndex(index => Math.max(0, index - 1))} aria-label="上一张">‹</button><button className="knowledge-image-next" onClick={() => setImageIndex(index => Math.min(draft.images.length - 1, index + 1))} aria-label="下一张">›</button></> : <label className="knowledge-image-add"><Plus size={38} /><span>添加图片</span><input type="file" accept="image/*" multiple onChange={e => addImages(e.target.files)} /></label>}
          </div>
          <div className="knowledge-card-dots">{draft.images.map((_, index) => <button key={index} className={index === imageIndex ? 'is-active' : ''} onClick={() => setImageIndex(index)} aria-label={`第 ${index + 1} 张图片`} />)}{draft.images.length > 0 && <label className="knowledge-image-more"><Plus size={15} /><input type="file" accept="image/*" multiple onChange={e => addImages(e.target.files)} /></label>}</div>
          <div className="knowledge-card-text-wrap"><textarea className="knowledge-card-text" value={draft.text} onChange={e => setCardField({ text: e.target.value })} placeholder="补充一点文字说明（可选）" /><button onClick={setTextFullscreen}>全屏输入</button></div>
          <div className="knowledge-card-actions"><select value={draft.status ?? ''} onChange={e => setCardField({ status: (e.target.value || undefined) as KnowledgeStatus | undefined })} aria-label="卡片状态"><option value="">状态留空</option><option value="todo">待学</option><option value="debt">负债</option><option value="learned">已学</option></select><button className="knowledge-save" disabled={!draft.title.trim()} onClick={() => void saveCard({ ...draft, title: draft.title.trim() })}><Save size={15} /> 保存卡片</button><button className="knowledge-danger" onClick={() => void deleteCard(draft.id)}>删除</button></div>
        </> : <><div className="knowledge-card-empty"><Plus size={56} /><button onClick={() => setCardDraft({ id: `card-${Date.now()}`, title: '', images: [], text: '', createdAt: Date.now(), updatedAt: Date.now() })}>建立第一张卡片</button></div></>}
      </div>
      {cards.length > 1 && !cardDraft && <div className="knowledge-card-pager"><button onClick={() => setCardIndex(index => Math.max(0, index - 1))} disabled={cardIndex === 0} aria-label="上一张卡片">‹</button><span>{cardIndex + 1} / {cards.length}</span><button onClick={() => setCardIndex(index => Math.min(cards.length - 1, index + 1))} disabled={cardIndex === cards.length - 1} aria-label="下一张卡片">›</button></div>}
      {lightbox && <div className="knowledge-lightbox" onClick={() => setLightbox(null)}><img src={lightbox} alt="全屏图片" /></div>}
    </div>;
  }

  return <div className="knowledge-panel">
    <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={onClose} aria-label="返回课程"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">{course.name}</span><h2>知识地图</h2></div><div className="knowledge-head-actions"><button className="knowledge-icon-btn" onClick={() => setPresentation(value => value === 'tree' ? 'mind' : 'tree')} aria-label={presentation === 'tree' ? '查看思维导图' : '查看知识树'}>{presentation === 'tree' ? <Sparkles size={17} /> : <BookOpen size={17} />}</button><button className="knowledge-icon-btn" onClick={exportText} aria-label="导出知识地图"><Download size={18} /></button></div></header>
    {!map || !map.nodes.length ? <section className="knowledge-empty"><Sparkles size={24} /><h3>先搭一张知识树</h3><p>用熟悉的 Markdown 列表写下章节，之后可以逐级展开学习。</p><button className="knowledge-primary" onClick={() => setEditingSource(true)}><Edit3 size={16} /> 输入知识树</button></section> : presentation === 'mind' ? <section className="knowledge-mind" aria-label="思维导图预览">{childrenOf(map.nodes).map(root => <article className={`knowledge-mind-root knowledge-mind-root--${root.status}`} key={root.id}><h3>{root.title}</h3>{notePreview(root) && <p className="knowledge-mind-root-note">{notePreview(root)}</p>}<div className="knowledge-mind-branches">{childrenOf(map.nodes, root.id).map(child => <div className="knowledge-mind-branch" key={child.id}><strong>{child.title}</strong>{child.page && <small>{child.page}</small>}{notePreview(child) && <p>{notePreview(child)}</p>}{childrenOf(map.nodes, child.id).slice(0, 8).map(leaf => <span key={leaf.id} className={`knowledge-mind-leaf knowledge-mind-leaf--${leaf.status}`}>{leaf.title}{notePreview(leaf) && ` · ${notePreview(leaf)}`}</span>)}</div>)}</div></article>)}</section> : <>
      <div className="knowledge-toolbar"><span>{map.nodes.length} 个节点</span><button onClick={() => setEditingSource(true)}><Edit3 size={14} /> 编辑 Markdown</button></div>
      <section className="knowledge-tree" aria-label="知识树">{visible.map(({ node, level }) => <div key={node.id} className={`knowledge-row knowledge-row--${node.status} ${statusFlash === node.id ? 'knowledge-row--flash' : ''}`} style={{ paddingLeft: 12 + level * 20 }}><button className="knowledge-expand" onClick={() => node.children.length ? setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; }) : setSelectedId(node.id)} aria-label={node.children.length ? expanded.has(node.id) ? '收起' : '展开' : '打开笔记'}>{node.children.length ? expanded.has(node.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <BookOpen size={14} />}</button><button className="knowledge-row-main" onClick={() => node.children.length ? setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; }) : setSelectedId(node.id)}><span className="knowledge-dot" /><span className="knowledge-title">{node.title}</span>{node.page && <small>{node.page}</small>}{node.note?.blocks.length ? <span className="knowledge-note-mark">笔记</span> : null}</button><button className="knowledge-status" onClick={() => void changeStatus(node)}>{KNOWLEDGE_STATUS_LABEL[node.status]}</button></div>)}</section>
    </>}
    {editingSource && <div className="knowledge-editor-backdrop"><section className="knowledge-editor"><header><h3>输入知识树</h3><button onClick={() => setEditingSource(false)} aria-label="关闭"><X size={18} /></button></header><textarea value={source} onChange={e => { setSource(e.target.value); setSourceError(''); }} placeholder={'- 绪论 p1\n- 第一章 数制和码制 p4\n  - 1.1 概述 p4'} autoFocus />{sourceError && <p className="knowledge-error">{sourceError}</p>}<footer><button onClick={() => setEditingSource(false)}>取消</button><button className="knowledge-primary" onClick={() => void saveSource()}><Check size={16} /> 生成知识树</button></footer></section></div>}
  </div>;
}
