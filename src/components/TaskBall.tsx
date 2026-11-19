import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskBoard } from '../hooks/useTaskBoard';
import MindSheet from './MindSheet';
import { usePreferences } from '../hooks/usePreferences';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';
import { Archive, CornerUpLeft } from 'lucide-react';
import CelebrationDialog from './CelebrationDialog';
import type { TaskLeaf } from '../types';
import {
  chainText,
  completesAll,
} from '../utils/taskTree';
import { branchEnd, flattenTaskRows, newTaskRow, persistableTaskRows, removeTaskBranch, rowsToTree, setBranchShelved, shiftTaskBranch, withTrailingDraftRow, type TaskRow } from '../utils/taskRows';
import { commitTaskRow, shouldActivateDraftOnBlur, shouldReuseAppendOnEnter } from '../utils/taskRowEditing';
import './TaskBall.css';

type Panel = 'list' | 'editor' | 'shelved' | null;

const POS_KEY = 'dailynote_task_ball_pos';

interface Pos { right: number; bottom: number }

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.right === 'number' && typeof p?.bottom === 'number') return p;
    }
  } catch { /* 用默认位置 */ }
  return { right: 20, bottom: 196 };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default function TaskBall() {
  const navigate = useNavigate();
  const { nodes, leaves, shelved, undone, saveTree, toggle, remove, shelve, reorder } = useTaskBoard();
  const { prefs } = usePreferences();

  const [panel, setPanel] = useState<Panel>(null);
  const [mindOpen, setMindOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lines, setLines] = useState<TaskRow[]>([]);
  const [draftRowId, setDraftRowId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ index: number; title: string } | null>(null);
  const [lineMenu, setLineMenu] = useState<number | null>(null);
  const [deleteLineIndex, setDeleteLineIndex] = useState<number | null>(null);
  const [lineDrag, setLineDrag] = useState<{ index: number; dx: number } | null>(null);
  const linePress = useRef<{ index: number; x: number; y: number; pressed: boolean; timer: ReturnType<typeof setTimeout> | null; pointerId: number; target: HTMLElement } | null>(null);
  const suppressLineClick = useRef(false);
  const pendingRowClick = useRef<string | null>(null);
  const [chain, setChain] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  /** 全部完成时的庆祝弹窗（null = 不显示；数字 = 本次清单总条数） */
  const [celebration, setCelebration] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editorSheet = useSheetDrag(() => setPanel(null), panel === 'editor');
  const listSheet = useSheetDrag(() => setPanel(null), panel === 'list');
  const shelvedSheet = useSheetDrag(() => setPanel(null), panel === 'shelved');
  const focusEditInput = () => requestAnimationFrame(() => editInputRef.current?.focus());

  // ---- 悬浮球位置（可拖动） ----
  const [pos, setPos] = useState<Pos>(loadPos);
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragRef = useRef<{ x: number; y: number; r: number; b: number; moved: boolean } | null>(null);
  /** 拖动结束后吞掉紧随其后的 click（否则一拖就误开面板） */
  const clickGuardRef = useRef(0);

  function savePos(p: Pos) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* 忽略 */ }
  }

  function onBallPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    // 部分安卓 WebView 对触摸指针不支持 setPointerCapture，抛错会让后续拖动/点击全部失效
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略，靠 pointermove 兜底 */ }
    dragRef.current = { x: e.clientX, y: e.clientY, r: pos.right, b: pos.bottom, moved: false };
  }

  function onBallPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // 手指按下会抖，未超过 10px 不算拖动，也不移动球
    if (!d.moved && Math.hypot(dx, dy) < 10) return;
    d.moved = true;
    setPos({
      right: clamp(d.r - dx, 6, window.innerWidth - 62),
      bottom: clamp(d.b - dy, 66, window.innerHeight - 110),
    });
  }

  function onBallPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;      // 点击交给 onClick 处理
    savePos(posRef.current);
    clickGuardRef.current = Date.now();
  }

  /** 点击 TODO 永远直接进入树编辑。 */
  function onBallClick() {
    if (Date.now() - clickGuardRef.current < 400) return;
    openEditor();
  }

  // ---- 填写窗 ----
  function openEditor() {
    const existing = flattenTaskRows(nodes);
    const { rows, draftId } = withTrailingDraftRow(existing);
    setLines(rows);
    setDraftRowId(draftId);
    const activeIndex = rows.length - 1;
    setEditing({ index: activeIndex, title: rows[activeIndex].title });
    setSaveError('');
    setPanel('editor');
  }

  /** 当前编辑中的标题先写回稳定 ID 对应的行。 */
  function committedLines(): TaskRow[] {
    if (!editing) return lines;
    const id = lines[editing.index]?.id;
    if (!id) return lines;
    return lines.map(row => row.id === id ? { ...row, title: editing.title } : row);
  }

  /** 提交正在就地编辑的那一行；点击另一行时由那次点击接管焦点。 */
  function commitEdit(event?: React.FocusEvent<HTMLInputElement>) {
    if (!editing) return;
    const id = lines[editing.index]?.id;
    if (!id) return;
    const value = event?.currentTarget.value ?? editing.title;
    setLines(current => commitTaskRow(current, id, value));
    if (!shouldActivateDraftOnBlur(id, draftRowId, pendingRowClick.current)) return;
    const draftIndex = lines.findIndex(row => row.id === draftRowId);
    if (draftIndex < 0) return;
    setEditing({ index: draftIndex, title: lines[draftIndex].title });
    focusEditInput();
  }

  /** 换行：优先复用末尾空追加行；否则在追加行后插入同层空行。 */
  function newLine() {
    const current = committedLines();
    const activeId = editing ? lines[editing.index]?.id ?? null : null;
    const draftIndex = lines.findIndex(row => row.id === draftRowId);
    const draftTitle = draftIndex >= 0 ? current[draftIndex]?.title : '';
    // Empty trailing row: Enter should not manufacture more blank rows.
    if (activeId === draftRowId && !draftTitle.trim()) {
      setLines(current);
      setEditing(draftIndex >= 0 ? { index: draftIndex, title: '' } : null);
      focusEditInput();
      return;
    }
    if (shouldReuseAppendOnEnter(activeId, draftRowId, draftTitle)) {
      setLines(current);
      setEditing({ index: draftIndex, title: current[draftIndex].title });
      focusEditInput();
      return;
    }
    const appendIndex = draftIndex >= 0 ? draftIndex : current.length - 1;
    const row = newTaskRow(appendIndex >= 0 ? current[appendIndex].level : 0);
    const next = [...current.slice(0, appendIndex + 1), row, ...current.slice(appendIndex + 1)];
    setLines(next);
    setDraftRowId(row.id);
    setEditing({ index: appendIndex + 1, title: '' });
    focusEditInput();
  }

  function lineChain(index: number, source = committedLines()): string[] | null {
    if (index < 0 || index >= source.length) return null;
    const chain = [source[index].title];
    let level = source[index].level;
    for (let i = index - 1; i >= 0 && level > 0; i--) {
      if (source[i].level === level - 1) {
        chain.unshift(source[i].title);
        level--;
      }
    }
    return chain;
  }

  function adjustLineLevel(index: number, delta: number) {
    setLines(ls => shiftTaskBranch(ls, index, delta));
  }

  function clearLinePress() {
    if (linePress.current?.timer) clearTimeout(linePress.current.timer);
    linePress.current = null;
  }
  function beginLineAt(x: number, y: number, target: HTMLElement, index: number, force = false) {
    if (busy || (!force && editing?.index === index)) return;
    clearLinePress();
    linePress.current = {
      index, x, y, pressed: false, pointerId: 0, target,
      timer: setTimeout(() => {
        const current = linePress.current;
        if (!current) return;
        current.pressed = true;
        setLineDrag({ index, dx: 0 });
      }, 450),
    };
  }
  function moveLineAt(x: number, y: number, preventDefault?: () => void) {
    const current = linePress.current;
    if (!current) return;
    if (!current.pressed) {
      if (Math.hypot(x - current.x, y - current.y) > 8) clearLinePress();
      return;
    }
    preventDefault?.();
    setLineDrag({ index: current.index, dx: x - current.x });
  }
  function endLineAt(x: number) {
    const current = linePress.current;
    if (!current) return;
    const dx = x - current.x;
    const pressed = current.pressed;
    clearLinePress();
    if (!pressed) return;
    pendingRowClick.current = null;
    setLineDrag(null);
    suppressLineClick.current = true;
    if (Math.abs(dx) >= 18) adjustLineLevel(current.index, dx > 0 ? 1 : -1);
    else window.setTimeout(() => setLineMenu(current.index), 60);
    window.setTimeout(() => { suppressLineClick.current = false; }, 0);
  }
  function beginLinePress(event: React.PointerEvent<HTMLElement>, index: number, force = false) {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    beginLineAt(event.clientX, event.clientY, event.currentTarget, index, force);
  }
  function moveLinePress(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') return;
    moveLineAt(event.clientX, event.clientY, () => event.preventDefault());
  }
  function endLinePress(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') return;
    endLineAt(event.clientX);
  }
  function beginLineTouch(event: React.TouchEvent<HTMLElement>, index: number, force = false) {
    const touch = event.touches[0];
    if (!touch) return;
    beginLineAt(touch.clientX, touch.clientY, event.currentTarget, index, force);
  }
  function moveLineTouch(event: React.TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (touch) moveLineAt(touch.clientX, touch.clientY, () => event.preventDefault());
  }
  function endLineTouch(event: React.TouchEvent<HTMLElement>) {
    const touch = event.changedTouches[0];
    if (touch) endLineAt(touch.clientX);
  }
  function cancelLinePress() {
    clearLinePress();
    setLineDrag(null);
  }

  function removeLine(index: number) {
    let next = removeTaskBranch(committedLines(), index);
    if (draftRowId && !next.some(row => row.id === draftRowId)) {
      const fresh = newTaskRow(next.length ? next[next.length - 1].level : 0);
      next = [...next, fresh];
      setDraftRowId(fresh.id);
    }
    setLines(next);
    const append = next[next.length - 1];
    setEditing(append ? { index: next.length - 1, title: append.title } : null);
    setLineMenu(null);
    setDeleteLineIndex(null);
    focusEditInput();
  }

  async function shelveLine(index: number) {
    const source = committedLines();
    if (!source[index]) return;
    const next = setBranchShelved(source, index, !source[index].shelved);
    setLineMenu(null);
    setLines(next);
    const append = next[next.length - 1];
    setEditing(append ? { index: next.length - 1, title: append.title } : null);
    setSaveError('');
    setBusy(true);
    try {
      const persistable = persistableTaskRows(next);
      await saveTree(persistable.length ? rowsToTree(persistable) : []);
    } catch {
      setSaveError('保存失败，当前编辑内容已保留');
    } finally {
      setBusy(false);
    }
  }

  async function finish(nextPanel: Panel = null) {
    if (busy) return;
    const baseLines = committedLines();
    setLines(baseLines);
    const finalRows = persistableTaskRows(baseLines);
    setSaveError('');
    setBusy(true);
    try {
      await saveTree(finalRows.length ? rowsToTree(finalRows) : []);
      setPanel(nextPanel);
    } catch {
      setSaveError('保存失败，当前编辑内容已保留');
    } finally {
      setBusy(false);
    }
  }

  useRegisterBackHandler(() => {
    if (deleteLineIndex !== null) { setDeleteLineIndex(null); return true; }
    if (lineMenu !== null) { setLineMenu(null); return true; }
    if (mindOpen) return false; // MindSheet handles its own sub-editor before closing.
    if (chain) { setChain(null); return true; }
    if (panel) { if (!busy) setPanel(null); return true; }
    return false;
  }, [deleteLineIndex, lineMenu, chain, panel, mindOpen, busy]);

  // ---- 清单拖动排序 ----
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const row = el?.closest('[data-leaf-key]') as HTMLElement | null;
      const toKey = row?.dataset.leafKey;
      if (toKey && toKey !== dragging) {
        reorder(dragging, toKey);
        setDragging(toKey);
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, reorder]);

  // 搜索结果跳转过来时打开面板
  useEffect(() => {
    const onOpen = () => openEditor();
    window.addEventListener('dailynote-open-tasks', onOpen);
    return () => window.removeEventListener('dailynote-open-tasks', onOpen);
  }, [nodes, leaves.length]);
  const done = useMemo(() => leaves.filter(l => l.done).length, [leaves]);

  /** 完成的条目先褪色显示 30 秒，之后从清单里隐去 */
  const visibleLeaves = useMemo(
    () => leaves.filter(l => !(l.done && l.doneAt && now - l.doneAt >= 30_000)),
    [leaves, now],
  );
  const hasRecentDone = leaves.some(l => l.done && l.doneAt && now - l.doneAt < 30_000);

  useEffect(() => {
    if (!hasRecentDone) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRecentDone]);


  /** 勾掉最后一条未完成的 → 立刻庆祝 */
  async function toggleLeaf(leaf: TaskLeaf) {
    const finishedAll = completesAll(leaves, leaf.key);
    await toggle(leaf.key);
    if (finishedAll) setCelebration(leaves.length);
  }

  return (
    <>
      <button
        className={`task-ball ${undone > 0 ? 'task-ball--num' : 'task-ball--word'}`}
        style={{ right: pos.right, bottom: pos.bottom }}
        onPointerDown={onBallPointerDown}
        onPointerMove={onBallPointerMove}
        onPointerUp={onBallPointerUp}
        onClick={onBallClick}
        title="任务"
      >
        {undone > 0 ? (undone > 99 ? '99+' : undone) : 'TODO'}
      </button>

      {panel === 'list' && (
        <div className="tb-mask" onClick={() => setPanel(null)}>
          <div className="tb-sheet" style={listSheet.style} onClick={e => e.stopPropagation()}>
            <div className="tb-grip" {...listSheet.handlers} />
            <div className="tb-head">
              <span className="tb-title">任务</span>
              <span className="tb-head-acts">
                <button className="tb-link" onClick={() => setMindOpen(true)}>杂念</button>
                <button className="tb-link" onClick={openEditor}>继续编辑</button>
              </span>
            </div>

            <div className="tb-list">
              {visibleLeaves.length === 0 ? (
                <div className="tb-empty">还没有任务</div>
              ) : visibleLeaves.map(leaf => (
                <div
                  key={leaf.key}
                  data-leaf-key={leaf.key}
                  className={`tb-item ${leaf.done ? 'tb-item--done' : ''} ${dragging === leaf.key ? 'tb-item--drag' : ''}`}
                >
                  <span
                    className="tb-grab"
                    onPointerDown={e => {
                      e.preventDefault();
                      setDragging(leaf.key);
                    }}
                  >⋮⋮</span>
                  <span className="tb-item-text">{leaf.label}</span>
                  <button className="tb-ic" onClick={() => setChain(leaf.chain)}>…</button>
                  <button className="tb-ic" title="搁置" onClick={() => void shelve(leaf.key, true)}>
                    <Archive size={13} />
                  </button>
                  <button
                    className={`tb-ic tb-ic--box ${leaf.done ? 'tb-ic--on' : ''}`}
                    onClick={() => toggleLeaf(leaf)}
                  >✓</button>
                  <button className="tb-ic" onClick={() => remove(leaf.key)}>✕</button>
                </div>
              ))}
            </div>

            <div className="tb-foot tb-foot--split">
              <span>待办 {undone} · 已结束 {done}</span>
              <button className="tb-link" onClick={() => setPanel('shelved')}>
                搁置清单{shelved.length > 0 ? ` ${shelved.length}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {panel === 'shelved' && (
        <div className="tb-mask" onClick={() => setPanel(null)}>
          <div className="tb-sheet" style={shelvedSheet.style} onClick={e => e.stopPropagation()}>
            <div className="tb-grip" {...shelvedSheet.handlers} />
            <div className="tb-head">
              <span className="tb-title">搁置清单</span>
              <button className="tb-link" onClick={() => setPanel('list')}>返回任务</button>
            </div>

            <div className="tb-list">
              {shelved.length === 0 ? (
                <div className="tb-empty">没有搁置的任务</div>
              ) : shelved.map(leaf => (
                <div key={leaf.key} className={`tb-item ${leaf.done ? 'tb-item--done' : ''}`}>
                  <span className="tb-item-text">{leaf.label}</span>
                  <button className="tb-ic" onClick={() => setChain(leaf.chain)}>…</button>
                  <button
                    className={`tb-ic tb-ic--box ${leaf.done ? 'tb-ic--on' : ''}`}
                    onClick={() => toggleLeaf(leaf)}
                  >✓</button>
                  <button className="tb-ic" title="并入任务清单" onClick={() => void shelve(leaf.key, false)}>
                    <CornerUpLeft size={13} />
                  </button>
                  <button className="tb-ic" onClick={() => remove(leaf.key)}>✕</button>
                </div>
              ))}
            </div>

            <div className="tb-foot">搁置 {shelved.length} 条 · 并入后回到原位置</div>
          </div>
        </div>
      )}
      {panel === 'editor' && (
        <div className="tb-mask" onClick={() => setPanel(null)}>
          <div className="tb-sheet tb-sheet--editor" style={editorSheet.style} onClick={e => e.stopPropagation()}>
            <div className="tb-grip" {...editorSheet.handlers} />
            <div className="tb-head">
              <span className="tb-title">任务</span>
              <span className="tb-head-acts">
                <button className="tb-link" disabled={busy} onClick={() => void finish('list')}>任务清单</button>
                <button className="tb-link" disabled={busy} onClick={() => void finish('shelved')}>
                  搁置清单{shelved.length > 0 ? ` ${shelved.length}` : ''}
                </button>
              </span>
            </div>

              <>
                <div className="tb-lines" onClick={() => { if (!lines.length && !editing) newLine(); }}>
                  {lines.length === 0 && <div className="tb-empty">点按这里新增第一行</div>}
                  {lines.map((l, i) => {
                    const isEditing = editing?.index === i;
                    const dragging = lineDrag?.index === i;
                    const inDraggedBranch = lineDrag !== null && i >= lineDrag.index && i < branchEnd(lines, lineDrag.index);
                    const hasChildren = lines[i + 1]?.level > l.level;
                    return (
                      <div
                        key={l.id}
                        className={`tb-line ${isEditing ? 'tb-line--cur' : ''} ${inDraggedBranch ? 'tb-line--dragging' : ''}`}
                        style={{ paddingLeft: l.level * 18, transform: inDraggedBranch ? `translateX(${lineDrag!.dx}px)` : undefined, touchAction: 'pan-y' }}
                        onPointerDown={event => { pendingRowClick.current = l.id; beginLinePress(event, i); }}
                        onPointerMove={moveLinePress}
                        onPointerUp={endLinePress}
                        onPointerCancel={() => { pendingRowClick.current = null; cancelLinePress(); }}
                        onTouchStart={event => { if ((event.target as HTMLElement).closest('input')) return; beginLineTouch(event, i); }}
                        onTouchMove={moveLineTouch}
                        onTouchEnd={endLineTouch}
                        onTouchCancel={cancelLinePress}
                        onContextMenu={event => { event.preventDefault(); setLineMenu(i); }}
                        onClick={() => {
                          if (suppressLineClick.current) { suppressLineClick.current = false; return; }
                          if (!isEditing) {
                            const trailingId = draftRowId ?? lines[lines.length - 1]?.id;
                            if (trailingId && trailingId !== l.id && !lines.some(row => row.id === trailingId && row.title.trim() === '')) {
                              const newRow = newTaskRow(l.level);
                              setLines(current => [...current, newRow]);
                              setDraftRowId(newRow.id);
                            }
                            setEditing({ index: i, title: l.title });
                          } else if (lines[i].id !== draftRowId) commitEdit();
                          window.setTimeout(() => {
                            if (pendingRowClick.current === l.id) pendingRowClick.current = null;
                          }, 0);
                        }}
                      >
                        <span className="tb-row-handle" aria-label="长按拖动层级" onPointerDown={event => { event.stopPropagation(); beginLinePress(event, i, true); }} onPointerMove={moveLinePress} onPointerUp={endLinePress} onPointerCancel={cancelLinePress} onTouchStart={event => { event.stopPropagation(); beginLineTouch(event, i, true); }} onTouchMove={moveLineTouch} onTouchEnd={endLineTouch} onTouchCancel={cancelLinePress} onClick={event => event.stopPropagation()}>⋮⋮</span>
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            className="tb-line-input"
                            autoFocus
                            enterKeyHint="next"
                            aria-label={l.id === draftRowId ? '新增任务' : `编辑任务：${l.title}`}
                            placeholder={l.id === draftRowId ? '新增任务' : undefined}
                            value={editing.title}
                            onChange={e => setEditing({ index: i, title: e.currentTarget.value })}
                            onClick={e => e.stopPropagation()}
                            onBlur={commitEdit}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); newLine(); }
                              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                            }}
                          />
                        ) : (
                          <span className="tb-line-text">{l.title || '新增任务'}</span>
                        )}
                        {hasChildren && <span className="tb-line-branch">↳</span>}
                      </div>
                    );
                  })}
                </div>
              </>

            {lineMenu !== null && lines[lineMenu] && <div className="tb-line-menu-mask" onClick={() => setLineMenu(null)}><section className="tb-line-menu" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="任务行操作"><header><span>{lines[lineMenu].title || '未命名'}</span><button onClick={() => setLineMenu(null)} aria-label="关闭">×</button></header><button onClick={() => { setEditing({ index: lineMenu, title: lines[lineMenu].title }); setLineMenu(null); focusEditInput(); }}>编辑</button><button onClick={() => void shelveLine(lineMenu)}>{lines[lineMenu].shelved ? '恢复' : '搁置'}</button><button className="is-danger" onClick={() => { setDeleteLineIndex(lineMenu); setLineMenu(null); }}>删除</button></section></div>}
            <ConfirmDialog open={deleteLineIndex !== null} message="删除这一行及其子任务？" confirmText="删除" onCancel={() => setDeleteLineIndex(null)} onConfirm={() => { if (deleteLineIndex !== null) removeLine(deleteLineIndex); }} />

            {saveError && <p className="tb-error" role="alert">{saveError}</p>}
            <button className="tb-done" onClick={() => void finish()} disabled={busy}>
              {busy ? '保存中...' : '完成'}
            </button>
          </div>
        </div>
      )}

      {chain && (
        <div className="tb-mask tb-mask--modal" onClick={() => setChain(null)}>
          <div className="tb-modal" onClick={e => e.stopPropagation()}>
            <div className="tb-modal-h">完整链</div>
            <div className="tb-modal-body">{chainText(chain)}</div>
            <div className="tb-modal-acts">
              <button onClick={() => setChain(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {mindOpen && (
        <MindSheet
          onClose={() => setMindOpen(false)}
          onBrowseDates={() => { setMindOpen(false); navigate('/reflection'); }}
        />
      )}
      {/* 全部完成：自动跳出庆祝 */}
      <CelebrationDialog
        open={celebration !== null}
        count={celebration ?? 0}
        username={prefs.username}
        onClose={() => setCelebration(null)}
      />
    </>
  );
}
