import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, Download, Edit3, Mic, MoreHorizontal, Move, Music, Plus, Search, Square, Sparkles, Trash2, X } from 'lucide-react';
import type { Course } from '../types';
import type { KnowledgeCard, KnowledgeCardContent, KnowledgeMap, KnowledgeNode, KnowledgeStatus } from '../types/knowledge';
import { getKnowledgeCardLibrary, getKnowledgeMap, saveKnowledgeMap } from '../db';
import { getCards, saveCard as saveCollectedCard, deleteCard as deleteCollectedCard, linkCard } from '../db/knowledgeCards';
import { buildKnowledgeNodes, KNOWLEDGE_STATUS_LABEL, nodesToMarkdown } from '../utils/knowledgeMap';
import { deleteKnowledgeNodes, duplicateKnowledgeLeaf, mergeKnowledgeLeaves, moveKnowledgeLeaves, renameKnowledgeNode } from '../utils/knowledgeTreeOps';
import { exportAudioBlob, cardSearchText } from '../utils/knowledgeCards';
import { fileToCompressedDataURL } from '../utils/avatarCrop';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';
import KnowledgeCardEditor from './KnowledgeCardEditor';
import { createCollectedCard } from './KnowledgeCardCollector';
import './KnowledgeMapPanel.css';

interface Props { course: Course; onClose: () => void; initialNodeId?: string | null; }
const STATUS_ORDER: KnowledgeStatus[] = ['todo', 'debt', 'learned'];
const childrenOf = (nodes: KnowledgeNode[], parentId?: string) => nodes.filter(node => node.parentId === parentId);
const now = () => Date.now();
const newCard = (title = ''): KnowledgeCard => ({ id: `card-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title, status: undefined, contents: [], createdAt: now(), updatedAt: now() });
const newText = (): KnowledgeCardContent => ({ id: `text-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, kind: 'text', text: '', createdAt: now(), updatedAt: now() });

function emptyLibrary(cardsPath = 'Music/DailyNote') {
  return { id: 1, records: [], audioExportPath: cardsPath, updatedAt: now() };
}

export default function KnowledgeMapPanel({ course, onClose, initialNodeId }: Props) {
  const [map, setMap] = useState<KnowledgeMap | null>(null);
  const [library, setLibrary] = useState<import('../types/knowledge').KnowledgeCardLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSource, setEditingSource] = useState(false);
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [contextNodeId, setContextNodeId] = useState<string | null>(null);
  const [operation, setOperation] = useState<'rename' | 'duplicate' | 'merge' | null>(null);
  const [operationNodeId, setOperationNodeId] = useState<string | null>(null);
  const [operationTarget, setOperationTarget] = useState('');
  const [operationName, setOperationName] = useState('');
  const [operationError, setOperationError] = useState('');
  const [pendingMoveIds, setPendingMoveIds] = useState<string[] | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [statusFlash, setStatusFlash] = useState<string | null>(null);
  const [cardNodeId, setCardNodeId] = useState<string | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [contentIndex, setContentIndex] = useState(0);
  const [cardDraft, setCardDraft] = useState<KnowledgeCard | null>(null);
  const [textFullscreen, setTextFullscreen] = useState(false);
  const [fullText, setFullText] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [search, setSearch] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const recordChunks = useRef<Blob[]>([]);
  const recordStarted = useRef(0);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const swipeStart = useRef<{ x: number; y: number; kind: 'content' | 'card' } | null>(null);
  const mapNodes = map?.nodes ?? [];
  const cardNode = mapNodes.find(node => node.id === cardNodeId);
  const nodeCards = useMemo(() => (cardNode?.cardIds ?? []).map(id => library?.records.find(record => record.id === id)?.card).filter((card): card is KnowledgeCard => !!card), [cardNode?.cardIds, library]);
  const activeCard = cardDraft ?? nodeCards[cardIndex];
  const contents = activeCard?.contents ?? [];
  const currentContent = contents[Math.min(contentIndex, Math.max(0, contents.length - 1))];

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([getKnowledgeMap(course.id!), getKnowledgeCardLibrary()]).then(([existing, stored]) => {
      if (!alive) return;
      setMap(existing ?? null);
      setSource(existing?.sourceMarkdown ?? '');
      setLibrary(stored ?? emptyLibrary());
      if (existing && initialNodeId) {
        const target = existing.nodes.find(node => node.id === initialNodeId);
        if (target) {
          const open = new Set<string>();
          let parent = target.parentId;
          while (parent) { open.add(parent); parent = existing.nodes.find(node => node.id === parent)?.parentId; }
          setExpanded(open);
          setCardNodeId(target.id);
        }
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [course.id, initialNodeId]);

  useEffect(() => { setCardIndex(0); setContentIndex(0); setCardDraft(null); setTextFullscreen(false); setLightbox(null); }, [cardNodeId]);

  useRegisterBackHandler(() => {
    if (lightbox) { setLightbox(null); return true; }
    if (textFullscreen) { setTextFullscreen(false); return true; }
    if (operation) { setOperation(null); return true; }
    if (pendingMoveIds) { setPendingMoveIds(null); return true; }
    if (pendingDeleteIds) { setPendingDeleteIds(null); return true; }
    if (contextNodeId) { setContextNodeId(null); return true; }
    if (cardNodeId) { void leaveCards(); return true; }
    if (selectedNodes.size) { setSelectedNodes(new Set()); return true; }
    if (editingSource) { setEditingSource(false); return true; }
    onClose(); return true;
  }, [lightbox, textFullscreen, operation, pendingMoveIds, pendingDeleteIds, contextNodeId, cardNodeId, selectedNodes, editingSource, cardDraft, onClose]);

  const visible = useMemo(() => {
    const result: { node: KnowledgeNode; level: number }[] = [];
    const visit = (parentId: string | undefined, level: number) => {
      for (const node of childrenOf(mapNodes, parentId)) {
        result.push({ node, level });
        if (expanded.has(node.id)) visit(node.id, level + 1);
      }
    };
    visit(undefined, 0);
    return result;
  }, [mapNodes, expanded]);

  function cardsForNode(node: KnowledgeNode): KnowledgeCard[] {
    return (node.cardIds ?? []).map(id => library?.records.find(record => record.id === id)?.card).filter((card): card is KnowledgeCard => !!card);
  }

  function matchesSearch(card: KnowledgeCard): boolean {
    const query = search.trim().toLowerCase();
    return !query || cardSearchText(card).toLowerCase().includes(query);
  }

  async function persistCard(card: KnowledgeCard) {
    const firstText = card.contents.find((item): item is Extract<KnowledgeCardContent, { kind: 'text' }> => item.kind === 'text' && !!item.text.trim());
    const clean = { ...card, title: card.title.trim() || firstText?.text.trim().slice(0, 30) || '未命名卡片', updatedAt: now() };
    await saveCollectedCard(clean);
    if (cardNode) await linkCard(clean.id, course.id!, cardNode.id);
    setLibrary(await getKnowledgeCardLibrary() ?? null);
    setCardDraft(null);
  }

  async function leaveCards() {
    if (cardDraft) await persistCard(cardDraft);
    setCardNodeId(null);
  }

  function updateCardField(changes: Partial<KnowledgeCard>) {
    const base = cardDraft ?? activeCard ?? newCard();
    setCardDraft({ ...base, ...changes, updatedAt: now() });
  }

  function updateContent(id: string, changes: Partial<KnowledgeCardContent>) {
    const base = cardDraft ?? activeCard;
    if (!base) return;
    setCardDraft({ ...base, contents: base.contents.map(item => item.id === id ? { ...item, ...changes, updatedAt: now() } as KnowledgeCardContent : item), updatedAt: now() });
  }

  function addText() {
    const base = cardDraft ?? activeCard ?? newCard();
    const next = newText();
    setCardDraft({ ...base, contents: [...base.contents, next], updatedAt: now() });
    setContentIndex(base.contents.length);
  }

  async function addImage(files: FileList | null) {
    if (!files?.length) return;
    const images = (await Promise.all(Array.from(files).map(file => fileToCompressedDataURL(file, 1600, .82)))).filter(Boolean);
    const base = cardDraft ?? activeCard ?? newCard();
    const additions: KnowledgeCardContent[] = images.map(data => ({ id: `image-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, kind: 'image', data, createdAt: now(), updatedAt: now() }));
    setCardDraft({ ...base, contents: [...base.contents, ...additions], updatedAt: now() });
    setContentIndex(base.contents.length);
  }

  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      recorder.current = media;
      recordChunks.current = [];
      recordStarted.current = now();
      media.ondataavailable = event => { if (event.data.size) recordChunks.current.push(event.data); };
      media.onstop = async () => {
        const blob = new Blob(recordChunks.current, { type: media.mimeType || 'audio/webm' });
        const data = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
        const seconds = Math.max(1, Math.round((now() - recordStarted.current) / 1000));
        const base = cardDraft ?? activeCard ?? newCard();
        const item: KnowledgeCardContent = { id: `audio-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, kind: 'audio', data, mimeType: blob.type || 'audio/webm', durationMs: seconds * 1000, fileName: `${cardNode?.title ?? '知识卡片'}-${new Date().toLocaleString('zh-CN')}.webm`, createdAt: now(), updatedAt: now() };
        setCardDraft({ ...base, contents: [...base.contents, item], updatedAt: now() });
        setContentIndex(base.contents.length);
        stream.getTracks().forEach(track => track.stop());
      };
      media.start();
      setRecording(true);
    } catch {
      window.alert('无法访问麦克风，请检查系统录音权限。');
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    setRecording(false);
  }

  async function exportAudio(content: Extract<KnowledgeCardContent, { kind: 'audio' }>) {
    await exportAudioBlob(content.data, library?.audioExportPath ?? 'Music/DailyNote', content.fileName, content.mimeType);
  }

  async function removeContent(id: string) {
    const base = cardDraft ?? activeCard;
    if (!base) return;
    setCardDraft({ ...base, contents: base.contents.filter(item => item.id !== id), updatedAt: now() });
    setContentIndex(index => Math.max(0, Math.min(index, base.contents.length - 2)));
  }

  async function createCard() {
    setCardDraft(newCard(''));
    setContentIndex(-1);
  }

  async function saveTree(nodes: KnowledgeNode[]) {
    if (!map) return;
    const next = { ...map, nodes, updatedAt: now() };
    await saveKnowledgeMap(next);
    setMap(next);
  }

  function toggleNode(node: KnowledgeNode) {
    if (selectedNodes.size) {
      setSelectedNodes(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; });
      return;
    }
    if (node.children.length) setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; });
    else setCardNodeId(node.id);
  }

  function openOperation(kind: 'rename' | 'duplicate' | 'merge', node?: KnowledgeNode) {
    setContextNodeId(null);
    setOperationError('');
    setOperation(kind);
    setOperationNodeId(node?.id ?? null);
    setOperationName(kind === 'rename' ? node?.title ?? '' : kind === 'duplicate' ? `${node?.title ?? ''} 副本` : '');
    setOperationTarget('');
  }

  async function applyOperation() {
    if (!map || !operation) return;
    let result;
    if (operation === 'rename' && operationNodeId) result = renameKnowledgeNode(map.nodes, operationNodeId, operationName);
    else if (operation === 'duplicate' && operationNodeId) result = duplicateKnowledgeLeaf(map.nodes, operationNodeId, operationName);
    else {
      const ids = map.nodes.filter(node => selectedNodes.has(node.id) && !node.children.length).map(node => node.id);
      if (!operationTarget) { setOperationError('请选择合并目标'); return; }
      result = mergeKnowledgeLeaves(map.nodes, ids.filter(id => id !== operationTarget), operationTarget, operationName);
    }
    if (result.error) { setOperationError(result.error); return; }
    await saveTree(result.nodes);
    setOperation(null);
    setSelectedNodes(new Set());
  }

  async function moveNodes(targetId: string) {
    if (!map || !pendingMoveIds) return;
    const result = moveKnowledgeLeaves(map.nodes, pendingMoveIds, targetId);
    if (result.error) { setOperationError(result.error); return; }
    await saveTree(result.nodes);
    setPendingMoveIds(null);
    setOperationError('');
    setExpanded(current => new Set([...current, targetId]));
  }

  async function deleteSelected() {
    if (!map || !pendingDeleteIds) return;
    await saveTree(deleteKnowledgeNodes(map.nodes, pendingDeleteIds).nodes);
    setPendingDeleteIds(null);
    setSelectedNodes(new Set());
  }

  function changeStatus(node: KnowledgeNode) {
    const index = STATUS_ORDER.indexOf(node.status);
    const nextStatus = STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
    setStatusFlash(nextStatus === 'learned' ? node.id : null);
    if (nextStatus === 'learned') window.setTimeout(() => setStatusFlash(null), 600);
    void saveTree(mapNodes.map(item => item.id === node.id ? { ...item, status: nextStatus } : item));
  }

  async function saveSource() {
    const built = buildKnowledgeNodes(source, map?.nodes ?? []);
    if (built.error) { setSourceError(built.error); return; }
    const next: KnowledgeMap = map ? { ...map, sourceMarkdown: source, nodes: built.nodes, updatedAt: now() } : { courseId: course.id!, courseName: course.name, sourceMarkdown: source, nodes: built.nodes, createdAt: now(), updatedAt: now() };
    const id = await saveKnowledgeMap(next);
    setMap({ ...next, id });
    setSourceError('');
    setEditingSource(false);
    setExpanded(new Set());
    setCardNodeId(null);
  }

  function startSwipe(kind: 'content' | 'card', event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('textarea,input,button,select,label')) return;
    swipeStart.current = { x: event.clientX, y: event.clientY, kind };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ }
  }

  function endSwipe(event: React.PointerEvent<HTMLElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (start.kind === 'content') setContentIndex(index => Math.max(0, Math.min(contents.length - 1, index + (dx < 0 ? 1 : -1))));
    else setCardIndex(index => Math.max(0, Math.min(nodeCards.length - 1, index + (dx < 0 ? 1 : -1))));
  }

  if (loading) return <div className="knowledge-panel"><p>正在打开知识地图…</p></div>;

  if (cardNode) {
    const selectedCard = nodeCards[cardIndex] ?? null;
    return <div className="knowledge-panel knowledge-card-page">
      <header className="knowledge-header">
        <button className="knowledge-icon-btn" onClick={() => setCardNodeId(null)} aria-label="返回知识地图"><ArrowLeft size={19} /></button>
        <div><span className="knowledge-kicker">{course.name}</span><h2>{cardNode.title}</h2></div>
        <button className="knowledge-icon-btn" onClick={() => {
          const card = createCollectedCard();
          void saveCollectedCard(card).then(async () => {
            await linkCard(card.id, course.id!, cardNode.id);
            setLibrary(await getKnowledgeCardLibrary() ?? library ?? emptyLibrary());
            setCardIndex(nodeCards.length);
            setCardDraft(card);
          });
        }} aria-label="新建卡片"><Plus size={18} /></button>
      </header>
      {nodeCards.length > 1 && <div className="knowledge-card-switcher"><label htmlFor="knowledge-card-select">关联卡片</label><select id="knowledge-card-select" value={String(cardIndex)} onChange={event => { setCardIndex(Number(event.target.value)); setCardDraft(null); }}>{nodeCards.map((card, index) => <option key={card.id} value={index}>{card.title || `未命名卡片 ${index + 1}`}</option>)}</select><span className="knowledge-card-count">{cardIndex + 1} / {nodeCards.length}</span></div>}
      {selectedCard || cardDraft ? <KnowledgeCardEditor
        key={(cardDraft ?? selectedCard)!.id}
        card={(cardDraft ?? selectedCard)!}
        audioExportPath={library?.audioExportPath}
        onSave={async card => {
          await saveCollectedCard(card);
          await linkCard(card.id, course.id!, cardNode.id);
          setLibrary(await getKnowledgeCardLibrary() ?? null);
          setCardDraft(null);
        }}
        onClose={() => setCardDraft(null)}
      /> : <button className="knowledge-card-empty" onClick={() => setCardDraft(createCollectedCard())}><Plus size={44} /><span>这张卡片还没关联内容</span></button>}
    </div>;
  }

  return <div className="knowledge-panel">
    <header className="knowledge-header"><button className="knowledge-icon-btn" onClick={onClose} aria-label="返回课程"><ArrowLeft size={19} /></button><div><span className="knowledge-kicker">{course.name}</span><h2>知识地图</h2></div><div className="knowledge-head-actions"><button className="knowledge-icon-btn" onClick={() => setEditingSource(true)} aria-label="编辑知识树"><Edit3 size={17} /></button><button className="knowledge-icon-btn" onClick={() => { const text = nodesToMarkdown(mapNodes, false); const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${course.name}-知识地图.md`; anchor.click(); URL.revokeObjectURL(url); }} aria-label="导出知识树"><Download size={18} /></button></div></header>
    {!map || !map.nodes.length ? <section className="knowledge-empty"><Sparkles size={24} /><h3>先搭一张知识树</h3><p>输入列表章节，然后逐级展开学习。</p><button className="knowledge-primary" onClick={() => setEditingSource(true)}><Edit3 size={16} /> 输入知识树</button></section> : <>
      <div className="knowledge-toolbar"><span>{map.nodes.length} 个节点</span><span className="knowledge-toolbar-hint">长按节点打开菜单</span></div>
      <label className="knowledge-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索卡片内容" /></label>
      <section className="knowledge-tree" aria-label="知识树">{visible.map(({ node, level }) => <div key={node.id} className={`knowledge-row ${node.status === 'debt' ? 'is-debt' : node.status === 'learned' ? 'is-learned' : ''} ${selectedNodes.has(node.id) ? 'is-selected' : ''} ${statusFlash === node.id ? 'is-flash' : ''}`} style={{ paddingLeft: 12 + level * 20 }} onTouchStart={() => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = window.setTimeout(() => { suppressClick.current = true; setContextNodeId(node.id); }, 520); }} onTouchEnd={() => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); }} onTouchMove={() => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); }} onContextMenu={event => { event.preventDefault(); setContextNodeId(node.id); }}>
        <button className="knowledge-expand" onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } toggleNode(node); }} aria-label={selectedNodes.has(node.id) ? '取消选择' : node.children.length ? expanded.has(node.id) ? '收起' : '展开' : '打开卡片'}>{selectedNodes.has(node.id) ? <Check size={16} /> : node.children.length ? expanded.has(node.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <BookOpen size={14} />}</button>
        <button className="knowledge-row-main" onClick={() => toggleNode(node)}><span className="knowledge-title">{node.title}</span>{node.page && <small>{node.page}</small>}{cardsForNode(node).filter(matchesSearch).length > 0 && <span className="knowledge-note-mark">{cardsForNode(node).filter(matchesSearch).length} 张卡</span>}</button>
        <button className="knowledge-status" onClick={() => changeStatus(node)}>{KNOWLEDGE_STATUS_LABEL[node.status]}</button>
        <button className="knowledge-node-more" onClick={() => setContextNodeId(node.id)} aria-label={`更多操作：${node.title}`}><MoreHorizontal size={17} /></button>
      </div>)}</section>
      {selectedNodes.size > 0 && <div className="knowledge-selection-bar"><span>已选 {selectedNodes.size} 个节点</span><button disabled={selectedNodes.size < 2} onClick={() => openOperation('merge')}>合并</button><button onClick={() => setPendingMoveIds(map.nodes.filter(node => selectedNodes.has(node.id) && !node.children.length).map(node => node.id))}>移动</button><button className="is-danger" onClick={() => setPendingDeleteIds([...selectedNodes])}>删除</button><button onClick={() => setSelectedNodes(new Set())}>取消</button></div>}
    </>}
    {contextNodeId && <div className="knowledge-editor-backdrop" onClick={() => setContextNodeId(null)}><section className="knowledge-node-menu" onClick={event => event.stopPropagation()}><header><h3>{map?.nodes.find(node => node.id === contextNodeId)?.title}</h3><button onClick={() => setContextNodeId(null)} aria-label="关闭"><X size={18} /></button></header><button onClick={() => { const node = map?.nodes.find(item => item.id === contextNodeId); if (node) { setCardNodeId(node.id); setContextNodeId(null); } }}>打开卡片</button><button onClick={() => { const node = map?.nodes.find(item => item.id === contextNodeId); if (node) openOperation('rename', node); }}>重新命名</button>{!map?.nodes.find(item => item.id === contextNodeId)?.children.length && <button onClick={() => { const node = map?.nodes.find(item => item.id === contextNodeId); if (node) openOperation('duplicate', node); }}>复制末端节点</button>}<button onClick={() => { setSelectedNodes(new Set([contextNodeId])); setContextNodeId(null); }}>多选</button><button className="is-danger" onClick={() => { setPendingDeleteIds([contextNodeId]); setContextNodeId(null); }}>删除</button></section></div>}
    {operation && <div className="knowledge-editor-backdrop"><section className="knowledge-editor"><header><h3>{operation === 'rename' ? '重新命名节点' : operation === 'duplicate' ? '复制末端节点' : '合并末端节点'}</h3><button onClick={() => setOperation(null)} aria-label="关闭"><X size={18} /></button></header>{operation === 'merge' && <select className="knowledge-target-select" value={operationTarget} onChange={event => setOperationTarget(event.target.value)}><option value="">选择合并目标</option>{map?.nodes.filter(node => selectedNodes.has(node.id) && !node.children.length).map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select>}<label className="knowledge-operation-name">新名称<input value={operationName} onChange={event => setOperationName(event.target.value)} /></label>{operationError && <p className="knowledge-error">{operationError}</p>}<footer><button onClick={() => setOperation(null)}>取消</button><button className="knowledge-primary" onClick={() => void applyOperation()}>确认</button></footer></section></div>}
    {pendingMoveIds && <div className="knowledge-editor-backdrop" onClick={() => setPendingMoveIds(null)}><section className="knowledge-editor knowledge-choose-target" onClick={event => event.stopPropagation()}><header><h3>移动末端节点</h3><button onClick={() => setPendingMoveIds(null)} aria-label="关闭"><X size={18} /></button></header><p>选择没有卡片的目标节点。</p><div className="knowledge-target-list">{map?.nodes.filter(node => !pendingMoveIds.includes(node.id) && !(node.cardIds?.length)).map(node => <button key={node.id} style={{ paddingLeft: 12 + node.depth * 16 }} onClick={() => void moveNodes(node.id)}>{node.title}</button>)}</div>{operationError && <p className="knowledge-error">{operationError}</p>}</section></div>}
    {pendingDeleteIds && <ConfirmDialog open message={`删除所选 ${pendingDeleteIds.length} 个节点及其子节点？`} confirmText="删除" onCancel={() => setPendingDeleteIds(null)} onConfirm={() => void deleteSelected()} />}
    {editingSource && <div className="knowledge-editor-backdrop"><section className="knowledge-editor"><header><h3>输入知识树</h3><button onClick={() => setEditingSource(false)} aria-label="关闭"><X size={18} /></button></header><textarea value={source} onChange={event => { setSource(event.target.value); setSourceError(''); }} placeholder={'- 绪论 p1\n- 第一章 数制和码制 p4\n  - 1.1 概述 p4'} autoFocus />{sourceError && <p className="knowledge-error">{sourceError}</p>}<footer><button onClick={() => setEditingSource(false)}>取消</button><button className="knowledge-primary" onClick={() => void saveSource()}><Check size={16} /> 生成知识树</button></footer></section></div>}
  </div>;
}

export { newCard };