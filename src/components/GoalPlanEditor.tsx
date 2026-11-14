import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { insertTaskLineAfter, withoutBlankTaskLines } from '../utils/taskTree';
import { ArrowLeft, Check, ChevronRight, CornerDownLeft, Indent, Outdent, Save, Trash2, X } from 'lucide-react';
import type { GoalNode, LongTermGoal } from '../types';
import type { TaskLine } from '../utils/taskTree';
import ConfirmDialog from './ConfirmDialog';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { effectiveNodes, goalLinesToNodes, goalNodesToLines, goalNodesToText, parseGoalText, toggleNode, updateNodeTitle } from '../utils/goalTree';
import './GoalPlanEditor.css';

export interface GoalPlanEditorProps {
  goal: LongTermGoal | null;
  onSave: (input: { title: string; description: string; nodes: GoalNode[] }) => Promise<boolean>;
  onClose: () => void;
}

function flatten(nodes: GoalNode[]): GoalNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}

function ContentEditor({ initial, onDone, onBack }: { initial: GoalNode[]; onDone: (nodes: GoalNode[]) => void; onBack: () => void }) {
  const [reference, setReference] = useState(initial);
  const [lines, setLines] = useState<TaskLine[]>(() => goalNodesToLines(initial));
  const [text, setText] = useState(() => goalNodesToText(initial));
  const [mode, setMode] = useState<'lines' | 'text'>('lines');
  const [pending, setPending] = useState('');
  const [level, setLevel] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [confirmBack, setConfirmBack] = useState(false);
  const rowInputs = useRef(new Map<number, HTMLInputElement>());
  const focusRow = useRef<number | null>(null);
  useEffect(() => {
    if (focusRow.current === null) return;
    rowInputs.current.get(focusRow.current)?.focus();
    focusRow.current = null;
  }, [lines]);
  const referenceForLines = (): GoalNode[] => {
    const original = goalNodesToLines(reference);
    const filled = withoutBlankTaskLines(lines);
    if (original.length !== filled.length || original.some((line, index) => line.level !== filled[index].level)) return reference;
    return flatten(reference).reduce((tree, node, index) => {
      const renamed = filled[index].title.trim();
      return renamed && renamed !== node.title ? updateNodeTitle(tree, node.id, renamed) : tree;
    }, reference);
  };
  const withPending = (): TaskLine[] => withoutBlankTaskLines(pending.trim()
    ? [...lines, { title: pending.trim(), level: Math.max(0, Math.min(level, lines.length ? lines[lines.length - 1].level + 1 : 0)) }]
    : lines);
  const parsed = mode === 'text' ? parseGoalText(text) : null;
  const preview = (() => {
    try { return goalLinesToNodes(withPending(), referenceForLines()); }
    catch { return reference; }
  })();
  const previewFlat = flatten(preview);

  const hasChanges = JSON.stringify(reference) !== JSON.stringify(initial) || JSON.stringify(lines) !== JSON.stringify(goalNodesToLines(initial)) || text !== goalNodesToText(initial) || !!pending.trim();
  function back() { if (hasChanges) setConfirmBack(true); else onBack(); }
  useRegisterBackHandler(() => { if (confirmBack) setConfirmBack(false); else back(); return true; }, [confirmBack, hasChanges, onBack]);

  function commitLine() {
    if (!pending.trim()) return;
    const next = withPending();
    setLines(next);
    setPending('');
    setLevel(next[next.length - 1].level);
    setSelected(null);
    setError('');
  }

  function newLine() {
    if (selected === null) { commitLine(); return; }
    const index = selected + 1;
    focusRow.current = index;
    setLines(current => insertTaskLineAfter(current, selected));
    setSelected(index);
    setError('');
  }

  function adjustLevel(delta: number) {
    if (selected !== null) setLines(current => {
      const start = current[selected].level;
      let end = selected + 1;
      while (end < current.length && current[end].level > start) end += 1;
      const target = Math.max(0, Math.min(start + delta, selected ? current[selected - 1].level + 1 : 0));
      const shift = target - start;
      return current.map((line, index) => index >= selected && index < end ? { ...line, level: line.level + shift } : line);
    });
    else if (lines.length) setLevel(current => Math.max(0, Math.min(current + delta, lines[lines.length - 1].level + 1)));
    setError('');
  }

  function deleteLine() {
    if (selected !== null) {
      setLines(current => {
        const start = current[selected].level;
        let end = selected + 1;
        while (end < current.length && current[end].level > start) end += 1;
        return current.filter((_, index) => index < selected || index >= end);
      });
      setSelected(null);
    } else if (pending) setPending('');
    else setLines(current => current.slice(0, -1));
    setError('');
  }

  function switchMode(next: 'lines' | 'text') {
    if (next === mode) return;
    try {
      if (next === 'text') {
        const nodes = goalLinesToNodes(withPending(), referenceForLines());
        setReference(nodes);
        setLines(goalNodesToLines(nodes));
        setPending('');
        setText(goalNodesToText(nodes));
      } else {
        const result = parseGoalText(text);
        if (result.error) { setError(result.error); return; }
        const nodes = goalLinesToNodes(result.lines, reference);
        setReference(nodes);
        setLines(goalNodesToLines(nodes));
      }
      setSelected(null);
      setMode(next);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '计划格式无效。'); }
  }

  function toggleLeaf(index: number) {
    try {
      const current = goalLinesToNodes(withoutBlankTaskLines(lines), referenceForLines());
      const node = flatten(current)[withoutBlankTaskLines(lines.slice(0, index)).length];
      if (!node || node.children.length) return;
      const next = toggleNode(current, node.id);
      setReference(next);
      setLines(goalNodesToLines(next));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '请先修正计划内容。'); }
  }

  function finish() {
    try {
      if (mode === 'text' && parsed?.error) { setError(parsed.error); return; }
      const result = mode === 'text' ? parsed!.lines : withPending();
      onDone(goalLinesToNodes(result, mode === 'lines' ? referenceForLines() : reference));
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

  return <div className="gp-content-screen" role="dialog" aria-modal="true" aria-label="编辑目标内容">
    <header className="gp-editor-head"><button className="gp-icon" type="button" title="返回目标" aria-label="返回目标" onClick={back}><ArrowLeft size={21} /></button><strong>目标内容</strong><button className="gp-save" type="button" onClick={finish}><Check size={17} />完成</button></header>
    <div className="gp-mode-switch" role="group" aria-label="计划编辑模式"><button type="button" className={mode === 'lines' ? 'active' : ''} onClick={() => switchMode('lines')}>层级</button><button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => switchMode('text')}>文本</button></div>
    {mode === 'lines' ? <>
      <div className="gp-lines">
        {lines.length === 0 && <p className="gp-empty">从第一步开始拆解目标</p>}
        {lines.map((line, index) => {
          const node = line.title.trim() ? previewFlat[withoutBlankTaskLines(lines.slice(0, index)).length] : undefined;
          const leaf = index === lines.length - 1 || lines[index + 1].level <= line.level;
          return <div className={`gp-line ${selected === index ? 'gp-line--selected' : ''}`} key={index} style={{ '--gp-depth': line.level } as React.CSSProperties}>
            {leaf && node ? <button type="button" className={`gp-check ${node.completed ? 'gp-check--done' : ''}`} title={node.completed ? '取消完成' : '标记完成'} aria-label={`${node.completed ? '取消完成' : '标记完成'}：${line.title}`} onClick={() => toggleLeaf(index)}><Check size={15} /></button> : <span className="gp-line-dot" />}
            <input ref={element => { if (element) rowInputs.current.set(index, element); else rowInputs.current.delete(index); }} aria-label={`第 ${index + 1} 行目标`} value={line.title} onFocus={() => setSelected(index)} onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); newLine(); } }} />
          </div>;
        })}
      </div>
      <div className="gp-entry"><span>第 {Math.min(level, lines.length ? lines[lines.length - 1].level + 1 : 0) + 1} 层</span><input value={pending} placeholder="添加下一步" onFocus={() => setSelected(null)} onChange={event => setPending(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitLine(); } }} /></div>
      <div className="gp-tools" role="group" aria-label="层级编辑工具"><button type="button" onClick={newLine}><CornerDownLeft size={17} />换行</button><button type="button" onClick={() => adjustLevel(1)}><Indent size={17} />缩进</button><button type="button" onClick={() => adjustLevel(-1)}><Outdent size={17} />缩退</button><button type="button" onClick={deleteLine}><Trash2 size={17} />删除</button></div>
    </> : <div className="gp-text-wrap"><textarea spellCheck={false} aria-label="Markdown 目标内容" placeholder={'- 第一步\n\t- 子步骤'} value={text} onChange={event => { setText(event.target.value); setError(''); }} onKeyDown={onTextKeyDown} /><small>每行 - 标题；支持 Tab 或每层 2 / 4 个空格缩进</small></div>}
    {error && <p className="gp-error" role="alert">{error}</p>}
    {mode === 'text' && parsed?.error && !error && <p className="gp-error" role="alert">{parsed.error}</p>}
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
