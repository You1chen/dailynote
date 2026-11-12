import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, Download, Edit3, Minus, Plus, Save, Sparkles, X } from 'lucide-react';
import type { Course } from '../types';
import type { KnowledgeMap, KnowledgeNode, KnowledgeStatus } from '../types/knowledge';
import { getKnowledgeMap, saveKnowledgeMap } from '../db';
import { buildKnowledgeNodes, KNOWLEDGE_STATUS_LABEL, nodesToMarkdown, noteToText, parseNoteBlocks } from '../utils/knowledgeMap';
import { renderKnowledgeNoteText } from '../utils/knowledgeNoteRender';
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
  const [presentation, setPresentation] = useState<'tree' | 'mind'>('tree');
  const selected = map?.nodes.find(node => node.id === selectedId);

  useEffect(() => {
    let alive = true;
    getKnowledgeMap(course.id!).then(existing => {
      if (!alive) return;
      setMap(existing ?? null); setSource(existing?.sourceMarkdown ?? '');
      if (existing) {
        const target = initialNodeId ? existing.nodes.find(node => node.id === initialNodeId) : undefined;
        const open = new Set(existing.nodes.filter(node => node.depth === 0).map(node => node.id));
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

  useEffect(() => { setNoteText(selected ? noteToText(selected.note) : ''); setNoteDirty(false); }, [selectedId, selected?.note?.updatedAt]);

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
  if (selected) return <div className="knowledge-panel knowledge-note-page">
    <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={() => { if (noteDirty) void saveNote(); else setSelectedId(null); }} aria-label="返回知识地图"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">{course.name}</span><h2>{selected.title}</h2></div><button className="knowledge-icon-btn" onClick={() => setSelectedId(null)} aria-label="关闭"><X size={18} /></button></header>
    <div className="knowledge-note-meta"><BookOpen size={14} /> 末端节点笔记{selected.page && <span>{selected.page}</span>}</div>
    <textarea className="knowledge-note-input" value={noteText} onChange={e => { setNoteText(e.target.value); setNoteDirty(true); }} placeholder="写下你理解的、疑惑的，或者下一步要查的……" autoFocus />
    <div className="knowledge-note-tools"><button onClick={() => { setNoteText(text => `  ${text}`); setNoteDirty(true); }}><Plus size={15} /> 缩进</button><button onClick={() => { setNoteText(text => text.replace(/^  /, '')); setNoteDirty(true); }}><Minus size={15} /> 缩退</button><button className="knowledge-save" onClick={() => void saveNote()} disabled={!noteDirty}><Save size={15} /> 保存</button></div>
    <p className="knowledge-note-hint">句末三个或以上半角空格会变成可勾选方框；公式保留原文，在阅读时渲染。</p>
    <div className="knowledge-note-preview" dangerouslySetInnerHTML={{ __html: renderKnowledgeNoteText(noteText) }} />
    {selected.note?.blocks.map(block => block.checklist && <label key={block.id} className="knowledge-check-row"><input type="checkbox" checked={block.checked ?? false} onChange={() => void toggleBlock(block.id)} /><span>{block.text}</span></label>)}
  </div>;

  return <div className="knowledge-panel">
    <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={onClose} aria-label="返回课程"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">{course.name}</span><h2>知识地图</h2></div><div className="knowledge-head-actions"><button className="knowledge-icon-btn" onClick={() => setPresentation(value => value === 'tree' ? 'mind' : 'tree')} aria-label={presentation === 'tree' ? '查看思维导图' : '查看知识树'}>{presentation === 'tree' ? <Sparkles size={17} /> : <BookOpen size={17} />}</button><button className="knowledge-icon-btn" onClick={exportText} aria-label="导出知识地图"><Download size={18} /></button></div></header>
    {!map || !map.nodes.length ? <section className="knowledge-empty"><Sparkles size={24} /><h3>先搭一张知识树</h3><p>用熟悉的 Markdown 列表写下章节，之后可以逐级展开学习。</p><button className="knowledge-primary" onClick={() => setEditingSource(true)}><Edit3 size={16} /> 输入知识树</button></section> : presentation === 'mind' ? <section className="knowledge-mind" aria-label="思维导图预览">{childrenOf(map.nodes).map(root => <article className={`knowledge-mind-root knowledge-mind-root--${root.status}`} key={root.id}><h3>{root.title}</h3>{notePreview(root) && <p className="knowledge-mind-root-note">{notePreview(root)}</p>}<div className="knowledge-mind-branches">{childrenOf(map.nodes, root.id).map(child => <div className="knowledge-mind-branch" key={child.id}><strong>{child.title}</strong>{child.page && <small>{child.page}</small>}{notePreview(child) && <p>{notePreview(child)}</p>}{childrenOf(map.nodes, child.id).slice(0, 8).map(leaf => <span key={leaf.id} className={`knowledge-mind-leaf knowledge-mind-leaf--${leaf.status}`}>{leaf.title}{notePreview(leaf) && ` · ${notePreview(leaf)}`}</span>)}</div>)}</div></article>)}</section> : <>
      <div className="knowledge-toolbar"><span>{map.nodes.length} 个节点</span><button onClick={() => setEditingSource(true)}><Edit3 size={14} /> 编辑 Markdown</button></div>
      <section className="knowledge-tree" aria-label="知识树">{visible.map(({ node, level }) => <div key={node.id} className={`knowledge-row knowledge-row--${node.status} ${statusFlash === node.id ? 'knowledge-row--flash' : ''}`} style={{ paddingLeft: 12 + level * 20 }}><button className="knowledge-expand" onClick={() => node.children.length ? setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; }) : setSelectedId(node.id)} aria-label={node.children.length ? expanded.has(node.id) ? '收起' : '展开' : '打开笔记'}>{node.children.length ? expanded.has(node.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <BookOpen size={14} />}</button><button className="knowledge-row-main" onClick={() => node.children.length ? setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; }) : setSelectedId(node.id)}><span className="knowledge-dot" /><span className="knowledge-title">{node.title}</span>{node.page && <small>{node.page}</small>}{node.note?.blocks.length ? <span className="knowledge-note-mark">笔记</span> : null}</button><button className="knowledge-status" onClick={() => void changeStatus(node)}>{KNOWLEDGE_STATUS_LABEL[node.status]}</button></div>)}</section>
    </>}
    {editingSource && <div className="knowledge-editor-backdrop"><section className="knowledge-editor"><header><h3>输入知识树</h3><button onClick={() => setEditingSource(false)} aria-label="关闭"><X size={18} /></button></header><textarea value={source} onChange={e => { setSource(e.target.value); setSourceError(''); }} placeholder={'- 绪论 p1\n- 第一章 数制和码制 p4\n  - 1.1 概述 p4'} autoFocus />{sourceError && <p className="knowledge-error">{sourceError}</p>}<footer><button onClick={() => setEditingSource(false)}>取消</button><button className="knowledge-primary" onClick={() => void saveSource()}><Check size={16} /> 生成知识树</button></footer></section></div>}
  </div>;
}
