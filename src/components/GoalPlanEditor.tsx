import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeft, Check, ChevronRight, GripVertical, Save, X } from 'lucide-react';
import type { GoalNode, LongTermGoal } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { effectiveNodes, goalLinesToNodes, goalNodesToText, parseGoalText } from '../utils/goalTree';
import { flattenGoalPlanRows, goalPlanBranchEnd, goalPlanRowsToNodes, newGoalPlanRow, shiftedGoalPlanLevel, shiftGoalPlanBranch } from '../utils/goalPlanRows';
import './GoalPlanEditor.css';

export interface GoalPlanEditorProps {
  goal: LongTermGoal | null;
  onSave: (input: { title: string; description: string; nodes: GoalNode[] }) => Promise<boolean>;
  onClose: () => void;
}

function flatten(nodes: GoalNode[]): GoalNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}

const APPEND = Symbol('goal-append');
type RowTarget = string | typeof APPEND;

type RowPointer = {
  target: RowTarget;
  pointerId: number;
  x: number;
  y: number;
  held: boolean;
  dragging: boolean;
  timer: ReturnType<typeof setTimeout>;
};

function ContentEditor({ initial, onDone, onBack }: { initial: GoalNode[]; onDone: (nodes: GoalNode[]) => void; onBack: () => void }) {
  const [rows, setRows] = useState(() => flattenGoalPlanRows(initial));
  const [append, setAppend] = useState('');
  const [appendLevel, setAppendLevel] = useState(() => rows[rows.length - 1]?.level ?? 0);
  const [edit, setEdit] = useState<{ id: string; title: string } | null>(null);
  const [mode, setMode] = useState<'lines' | 'text'>('lines');
  const [text, setText] = useState(() => goalNodesToText(initial));
  const [reference, setReference] = useState(initial);
  const [error, setError] = useState('');
  const [confirmBack, setConfirmBack] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ target: RowTarget; dx: number } | null>(null);
  const appendInput = useRef<HTMLInputElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const focusAppend = useRef(false);
  const menuEdit = useRef<HTMLButtonElement>(null);
  const press = useRef<RowPointer | null>(null);
  const suppressClick = useRef<{ target: RowTarget; until: number } | null>(null);
  const boundedAppendLevel = shiftedGoalPlanLevel(rows, rows.length, appendLevel, 0);
  const menuRow = rows.find(row => row.id === menu);

  useEffect(() => {
    if (edit) editInput.current?.focus();
    else if (focusAppend.current) {
      focusAppend.current = false;
      appendInput.current?.focus();
    }
  }, [edit?.id]);
  useEffect(() => { if (menu) menuEdit.current?.focus(); }, [menu]);
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);

  function committedRows() {
    const title = edit?.title.trim();
    return title ? rows.map(row => row.id === edit?.id ? { ...row, title } : row) : rows;
  }

  function commitEdit() {
    if (!edit) return;
    setRows(committedRows());
    setEdit(null);
  }

  function beginEdit(id: string) {
    if (edit?.id === id) return;
    const next = committedRows();
    const row = next.find(item => item.id === id);
    if (!row) return;
    setRows(next);
    setEdit({ id, title: row.title });
    setError('');
  }

  function nextLine() {
    const next = committedRows();
    const title = append.trim();
    setRows(title ? [...next, newGoalPlanRow(title, boundedAppendLevel)] : next);
    setEdit(null);
    setAppend('');
    setAppendLevel(boundedAppendLevel);
    setError('');
    if (edit) focusAppend.current = true;
    else appendInput.current?.focus();
  }

  function onLineKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); nextLine(); }
    if (event.key === 'Escape' && edit) { event.preventDefault(); focusAppend.current = true; setEdit(null); }
  }

  const lineChanges = !!append.trim() || JSON.stringify(committedRows()) !== JSON.stringify(flattenGoalPlanRows(initial));

  function nodesFromRows() {
    if (!lineChanges) return initial;
    const next = committedRows();
    const title = append.trim();
    return goalPlanRowsToNodes(title ? [...next, newGoalPlanRow(title, boundedAppendLevel)] : next);
  }

  const parsed = mode === 'text' ? parseGoalText(text) : null;
  const hasChanges = mode === 'lines'
    ? lineChanges
    : text !== goalNodesToText(initial) || reference !== initial;

  function back() {
    if (deleteId !== null) setDeleteId(null);
    else if (menu !== null) setMenu(null);
    else if (hasChanges) setConfirmBack(true);
    else onBack();
  }
  useRegisterBackHandler(() => { if (confirmBack) setConfirmBack(false); else back(); return true; }, [confirmBack, deleteId, menu, hasChanges, onBack]);

  function nodesFromText() {
    return text === goalNodesToText(reference) ? reference : goalLinesToNodes(parsed!.lines, reference);
  }

  function switchMode(next: 'lines' | 'text') {
    if (next === mode) return;
    try {
      if (next === 'text') {
        const nodes = nodesFromRows();
        setReference(nodes);
        setText(goalNodesToText(nodes));
      } else {
        if (parsed?.error) { setError(parsed.error); return; }
        const nodes = nodesFromText();
        const nextRows = flattenGoalPlanRows(nodes);
        setRows(nextRows);
        setAppendLevel(nextRows[nextRows.length - 1]?.level ?? 0);
      }
      setEdit(null);
      setAppend('');
      setMode(next);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '计划格式无效。'); }
  }

  function finish() {
    try {
      if (parsed?.error) { setError(parsed.error); return; }
      onDone(parsed ? nodesFromText() : nodesFromRows());
    } catch (cause) { setError(cause instanceof Error ? cause.message : '计划格式无效。'); }
  }

  function onTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    setText(value => value.slice(0, start) + '\t' + value.slice(end));
    requestAnimationFrame(() => { field.selectionStart = field.selectionEnd = start + 1; });
  }

  function clearPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    setDrag(null);
  }

  function openMenu(id: string) {
    commitEdit();
    setMenu(id);
  }

  function beginPress(event: PointerEvent<HTMLDivElement>, target: RowTarget) {
    if (event.button !== 0 || press.current || (event.target as HTMLElement).closest('input, .gp-check')) return;
    suppressClick.current = null;
    const gesture: RowPointer = {
      target, pointerId: event.pointerId, x: event.clientX, y: event.clientY, held: false, dragging: false,
      timer: setTimeout(() => { gesture.held = true; setDrag({ target, dx: 0 }); }, 450),
    };
    press.current = gesture;
    // Capture on the original hit element so a normal tap still reaches its button.
    const hit = event.target as Element;
    try { hit.setPointerCapture?.(event.pointerId); } catch { /* Native touch capture still applies. */ }
  }

  function movePress(event: PointerEvent<HTMLDivElement>) {
    const gesture = press.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.held) {
      if (Math.hypot(dx, dy) > 8) clearPress();
      return;
    }
    if (!gesture.dragging && Math.abs(dx) >= 8) gesture.dragging = true;
    if (gesture.dragging) setDrag({ target: gesture.target, dx });
  }

  function endPress(event: PointerEvent<HTMLDivElement>) {
    const gesture = press.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    clearPress();
    if (!gesture.dragging && !gesture.held) return;
    suppressClick.current = { target: gesture.target, until: Date.now() + 500 };
    if (gesture.held && Math.abs(dx) >= 18) {
      const delta = dx > 0 ? 1 : -1;
      if (gesture.target === APPEND) setAppendLevel(shiftedGoalPlanLevel(rows, rows.length, boundedAppendLevel, delta));
      else {
        const source = committedRows();
        const index = source.findIndex(row => row.id === gesture.target);
        if (index >= 0) setRows(shiftGoalPlanBranch(source, index, delta));
        setEdit(null);
      }
      setError('');
    } else if (!gesture.dragging && gesture.target !== APPEND) {
      openMenu(gesture.target);
    }
  }

  function wasGesture(target: RowTarget, clickDetail: number) {
    const previous = suppressClick.current;
    if (clickDetail === 0 || previous?.target !== target || previous.until < Date.now()) return false;
    suppressClick.current = null;
    return true;
  }

  function removeBranch() {
    const source = committedRows();
    const start = source.findIndex(row => row.id === deleteId);
    if (start >= 0) setRows([...source.slice(0, start), ...source.slice(goalPlanBranchEnd(source, start))]);
    setDeleteId(null);
    setEdit(null);
    setError('');
  }

  const dragStart = drag && drag.target !== APPEND ? rows.findIndex(row => row.id === drag.target) : -1;
  const dragEnd = dragStart >= 0 ? goalPlanBranchEnd(rows, dragStart) : -1;
  function rowStyle(level: number, moving: boolean): CSSProperties {
    return { '--gp-depth': level, transform: moving && drag ? `translateX(${drag.dx}px)` : undefined } as CSSProperties;
  }

  return <div className="gp-content-screen" role="dialog" aria-modal="true" aria-label="编辑目标内容">
    <header className="gp-editor-head"><button className="gp-icon" type="button" title="返回目标" aria-label="返回目标" onClick={back}><ArrowLeft size={21} /></button><strong>目标内容</strong><button className="gp-save" type="button" onClick={finish}><Check size={17} />完成</button></header>
    <div className="gp-mode-switch" role="group" aria-label="计划编辑模式"><button type="button" className={mode === 'lines' ? 'active' : ''} onClick={() => switchMode('lines')}>层级</button><button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => switchMode('text')}>文本</button></div>
    {mode === 'lines' ? <div className="gp-lines">
      {rows.map((row, index) => {
        const isEditing = edit?.id === row.id;
        const moving = index >= dragStart && index < dragEnd;
        const leaf = !(rows[index + 1]?.level > row.level);
        return <div className={`gp-line${isEditing ? ' gp-line--selected' : ''}${moving ? ' gp-line--dragging' : ''}`} key={row.id} style={rowStyle(row.level, moving)}
          onPointerDown={event => beginPress(event, row.id)} onPointerMove={movePress} onPointerUp={endPress} onPointerCancel={clearPress} onLostPointerCapture={clearPress}
          onContextMenu={event => { if ((event.target as HTMLElement).closest('input, .gp-check')) return; event.preventDefault(); if (!press.current && !wasGesture(row.id, 1)) openMenu(row.id); }}>
          <button type="button" className="gp-row-handle" aria-label={`目标行操作：${row.title}`} onClick={event => { if (!wasGesture(row.id, event.detail)) openMenu(row.id); }}><GripVertical size={16} /></button>
          {leaf ? <button type="button" className={`gp-check ${row.completed ? 'gp-check--done' : ''}`} aria-label={`${row.completed ? '取消完成' : '标记完成'}：${row.title}`} onClick={() => setRows(current => current.map(item => item.id === row.id ? { ...item, completed: !item.completed } : item))}><Check size={15} /></button> : <span className="gp-line-dot" />}
          {isEditing
            ? <input ref={editInput} enterKeyHint="next" aria-label={`第 ${index + 1} 行目标`} value={edit.title} onChange={event => setEdit({ id: row.id, title: event.target.value })} onBlur={commitEdit} onKeyDown={onLineKey} />
            : <button className="gp-line-title" type="button" onClick={event => { if (!wasGesture(row.id, event.detail)) beginEdit(row.id); }}>{row.title}</button>}
        </div>;
      })}
      <div className={`gp-line gp-line--append${drag?.target === APPEND ? ' gp-line--dragging' : ''}`} style={rowStyle(boundedAppendLevel, drag?.target === APPEND)}
        onPointerDown={event => beginPress(event, APPEND)} onPointerMove={movePress} onPointerUp={endPress} onPointerCancel={clearPress} onLostPointerCapture={clearPress}
        onContextMenu={event => { if (!(event.target as HTMLElement).closest('input')) event.preventDefault(); }}>
        <span className="gp-row-handle gp-row-handle--append" aria-hidden="true"><GripVertical size={16} /></span>
        <input ref={appendInput} autoFocus enterKeyHint="next" value={append} placeholder="添加下一步" aria-label="添加下一步" onChange={event => { setAppend(event.target.value); setError(''); }} onKeyDown={onLineKey} />
      </div>
    </div> : <div className="gp-text-wrap"><textarea spellCheck={false} aria-label="Markdown 目标内容" placeholder={'- 第一步\n\t- 子步骤'} value={text} onChange={event => { setText(event.target.value); setError(''); }} onKeyDown={onTextKeyDown} /></div>}
    {error && <p className="gp-error" role="alert">{error}</p>}
    {mode === 'text' && parsed?.error && !error && <p className="gp-error" role="alert">{parsed.error}</p>}
    {menuRow && <div className="gp-row-menu-mask" onClick={() => setMenu(null)}><section className="gp-row-menu" role="dialog" aria-modal="true" aria-label="目标行操作" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setMenu(null); }}>
      <header><strong>{menuRow.title}</strong><button className="gp-icon" type="button" aria-label="关闭行操作" onClick={() => setMenu(null)}><X size={19} /></button></header>
      <button ref={menuEdit} type="button" onClick={() => { setMenu(null); beginEdit(menuRow.id); }}>编辑</button>
      <button className="gp-row-menu-delete" type="button" onClick={() => { setDeleteId(menuRow.id); setMenu(null); }}>删除</button>
    </section></div>}
    <ConfirmDialog open={deleteId !== null} message="删除这一行及其子目标？" confirmText="删除" onConfirm={removeBranch} onCancel={() => setDeleteId(null)} />
    <ConfirmDialog open={confirmBack} message="放弃尚未完成的目标内容编辑？" confirmText="放弃修改" onConfirm={() => { setConfirmBack(false); onBack(); }} onCancel={() => setConfirmBack(false)} />
  </div>;
}

export default function GoalPlanEditor({ goal, onSave, onClose }: GoalPlanEditorProps) {
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [nodes, setNodes] = useState<GoalNode[]>(() => goal ? effectiveNodes(goal) : []);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const changed = title !== (goal?.title ?? '') || description !== (goal?.description ?? '') ||
    JSON.stringify(nodes) !== JSON.stringify(goal ? effectiveNodes(goal) : []);
  function close() {
    if (busy) return;
    if (changed) setConfirmClose(true);
    else onClose();
  }
  useRegisterBackHandler(() => { if (editing) return false; if (confirmClose) setConfirmClose(false); else close(); return true; }, [editing, confirmClose, changed, busy, onClose]);
  async function save() {
    if (busy) return;
    if (!title.trim()) { setError('请输入目标名称。'); return; }
    setBusy(true);
    setError('');
    try {
      if (!(await onSave({ title: title.trim(), description, nodes }))) setError('保存失败，请稍后重试。');
    } catch (cause) { setError(cause instanceof Error ? `保存失败：${cause.message}` : '保存失败，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <div className="gp-editor" role="dialog" aria-modal="true" aria-label="目标编辑">
    <header className="gp-editor-head"><button className="gp-icon" type="button" aria-label="关闭编辑" title="关闭编辑" onClick={close}><X size={21} /></button><strong>{goal ? '编辑目标' : '新建目标'}</strong><button className="gp-save" type="button" disabled={busy} onClick={() => void save()}><Save size={17} />{busy ? '保存中' : '保存'}</button></header>
    <main className="gp-editor-body">
      <section className="gp-field"><label htmlFor="gp-goal-title">目标名称</label><input id="gp-goal-title" value={title} maxLength={200} placeholder="想实现什么？" onChange={event => setTitle(event.target.value)} /></section>
      <section className="gp-field"><span className="gp-label">目标内容</span><button type="button" className="gp-open-plan" onClick={() => setEditing(true)}><span>{nodes.length ? `${nodes.length} 个一级目标 · ${flatten(nodes).length} 个节点` : '添加计划'}</span><ChevronRight size={19} /></button></section>
      <section className="gp-field gp-attachment"><label htmlFor="gp-attachment">附件线索</label><textarea id="gp-attachment" value={description} placeholder="记录资源、灵感和可行动的线索" onChange={event => setDescription(event.target.value)} /></section>
      {error && <p className="gp-error" role="alert">{error}</p>}
    </main>
    {editing && <ContentEditor initial={nodes} onBack={() => setEditing(false)} onDone={next => { setNodes(next); setEditing(false); setError(''); }} />}
    <ConfirmDialog open={confirmClose} message="放弃尚未保存的目标修改？" confirmText="放弃修改" onConfirm={() => { setConfirmClose(false); onClose(); }} onCancel={() => setConfirmClose(false)} />
  </div>;
}
