import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskBoard } from '../hooks/useTaskBoard';
import MindSheet from './MindSheet';
import { usePreferences } from '../hooks/usePreferences';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { Archive, CornerUpLeft } from 'lucide-react';
import CelebrationDialog from './CelebrationDialog';
import type { TaskLeaf } from '../types';
import type { TaskLine } from '../utils/taskTree';
import {
  chainText,
  completesAll,
  linesToText,
  linesToTree,
  parseTaskText,
  insertTaskLineAfter,
  leafKey,
  withoutBlankTaskLines,
  treeToLines,
  pruneDoneLeaves,
  treeToText,
} from '../utils/taskTree';
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
  const [mode, setMode] = useState<'lines' | 'text'>('lines');
  const [lines, setLines] = useState<TaskLine[]>([]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ index: number; title: string } | null>(null);
  const [lineMenu, setLineMenu] = useState<number | null>(null);
  const [lineDrag, setLineDrag] = useState<{ index: number; dx: number } | null>(null);
  const linePress = useRef<{ index: number; x: number; y: number; pressed: boolean; timer: ReturnType<typeof setTimeout> | null; pointerId: number; target: HTMLElement } | null>(null);
  const suppressLineClick = useRef(false);
  const [chain, setChain] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  /** 全部完成时的庆祝弹窗（null = 不显示；数字 = 本次清单总条数） */
  const [celebration, setCelebration] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editorSheet = useSheetDrag(() => setPanel(null), panel === 'editor');
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

  /** 点击：没内容进填写窗，有内容进清单 */
  function onBallClick() {
    if (Date.now() - clickGuardRef.current < 400) return;
    if (leaves.length === 0) openEditor();
    else setPanel('list');
  }

  // ---- 填写窗 ----
  function openEditor() {
    // 进编辑前先清掉已完成的条目：全做完就整份清空，否则只留下没做的
    const hasDone = leaves.some(l => l.done);
    const cleanNodes = hasDone ? pruneDoneLeaves(nodes) : nodes;
    if (hasDone) void saveTree(cleanNodes);

    const ls = treeToLines(cleanNodes);
    const initial = ls.length ? ls : [{ title: '', level: 0 }];
    setLines(initial);
    setText(treeToText(cleanNodes));
    setMode('lines');
    setEditing({ index: initial.length - 1, title: initial[initial.length - 1].title });
    setPanel('editor');
  }

  /** 当前编辑中的标题先写回行数组。 */
  function committedLines(): TaskLine[] {
    if (!editing) return lines;
    return lines.map((line, index) => index === editing.index ? { ...line, title: editing.title } : line);
  }

  /** 提交正在就地编辑的那一行。 */
  function commitEdit() {
    if (!editing) return;
    const title = editing.title.trim();
    const idx = editing.index;
    setLines(ls => ls.map((l, i) => (i === idx ? { ...l, title } : l)));
  }

  /** 换行：在编辑行后插入同层空行。 */
  function newLine() {
    const current = committedLines();
    const index = editing?.index ?? current.length - 1;
    if (index < 0) {
      setLines([{ title: '', level: 0 }]);
      setEditing({ index: 0, title: '' });
    } else {
      setLines(insertTaskLineAfter(current, index));
      setEditing({ index: index + 1, title: '' });
    }
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
    setLines(ls => ls.map((line, i) => {
      if (i !== index) return line;
      const max = i === 0 ? 0 : ls[i - 1].level + 1;
      return { ...line, level: delta > 0 ? Math.min(line.level + 1, max) : Math.max(0, line.level - 1) };
    }));
  }

  function clearLinePress() {
    if (linePress.current?.timer) clearTimeout(linePress.current.timer);
    linePress.current = null;
  }
  function beginLinePress(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (event.button !== 0 || editing?.index === index || busy) return;
    const target = event.currentTarget;
    clearLinePress();
    linePress.current = {
      index, x: event.clientX, y: event.clientY, pressed: false, pointerId: event.pointerId, target,
      timer: setTimeout(() => {
        const current = linePress.current;
        if (!current) return;
        current.pressed = true;
        setLineDrag({ index, dx: 0 });
        try { target.setPointerCapture(event.pointerId); } catch { /* WebView may not support capture */ }
      }, 450),
    };
  }
  function moveLinePress(event: React.PointerEvent<HTMLDivElement>) {
    const current = linePress.current;
    if (!current) return;
    if (!current.pressed) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) clearLinePress();
      return;
    }
    event.preventDefault();
    setLineDrag({ index: current.index, dx: event.clientX - current.x });
  }
  function endLinePress(event: React.PointerEvent<HTMLDivElement>) {
    const current = linePress.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const pressed = current.pressed;
    clearLinePress();
    if (!pressed) return;
    setLineDrag(null);
    suppressLineClick.current = true;
    if (Math.abs(dx) >= 18) adjustLineLevel(current.index, dx > 0 ? 1 : -1);
    else setLineMenu(current.index);
    window.setTimeout(() => { suppressLineClick.current = false; }, 0);
  }
  function cancelLinePress() {
    clearLinePress();
    setLineDrag(null);
  }

  function removeLine(index: number) {
    const source = committedLines();
    let end = index + 1;
    while (end < source.length && source[end].level > source[index].level) end++;
    setLines(source.filter((_, i) => i < index || i >= end));
    setEditing(null);
    setLineMenu(null);
  }

  async function shelveLine(index: number) {
    const source = committedLines();
    const chain = lineChain(index, source);
    if (!chain) return;
    const key = leafKey(chain);
    if (source[index + 1]?.level > source[index].level) return;
    setLineMenu(null);
    setBusy(true);
    try {
      await saveTree(linesToTree(source, nodes));
      await shelve(key, true);
      setLines(source.filter((_, i) => i !== index));
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: 'lines' | 'text') {
    if (next === mode) return;
    setEditing(null);
    if (next === 'text') setText(linesToText(withoutBlankTaskLines(editing
      ? lines.map((line, index) => index === editing.index ? { ...line, title: editing.title.trim() } : line)
      : lines)));
    else setLines(parseTaskText(text));
    setMode(next);
  }

  async function finish() {
    const baseLines = committedLines();
    setEditing(null);
    const finalLines = mode === 'text' ? parseTaskText(text) : withoutBlankTaskLines(baseLines);
    if (finalLines.length === 0) { setPanel('list'); return; }
    setBusy(true);
    try {
      await saveTree(pruneDoneLeaves(linesToTree(finalLines, nodes)));
      setPanel('list');
    } finally {
      setBusy(false);
    }
  }

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
    const onOpen = () => {
      if (leaves.length === 0) openEditor();
      else setPanel('list');
    };
    window.addEventListener('dailynote-open-tasks', onOpen);
    return () => window.removeEventListener('dailynote-open-tasks', onOpen);
  }, [leaves.length]);
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
          <div className="tb-sheet" onClick={e => e.stopPropagation()}>
            <div className="tb-grip" />
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
          <div className="tb-sheet" onClick={e => e.stopPropagation()}>
            <div className="tb-grip" />
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
                <button className="tb-link" onClick={() => setPanel('shelved')}>
                  搁置清单{shelved.length > 0 ? ` ${shelved.length}` : ''}
                </button>
                <span className="tb-modes">
                  <button className={mode === 'lines' ? 'tb-mode--on' : ''} onClick={() => switchMode('lines')}>层级</button>
                  <button className={mode === 'text' ? 'tb-mode--on' : ''} onClick={() => switchMode('text')}>文本</button>
                </span>
              </span>
            </div>

            {mode === 'lines' ? (
              <>
                <div className="tb-lines">
                  {lines.length === 0 && <div className="tb-empty">输入第一行</div>}
                  {lines.map((l, i) => {
                    const isEditing = editing?.index === i;
                    const dragging = lineDrag?.index === i;
                    const hasChildren = lines[i + 1]?.level > l.level;
                    return (
                      <div
                        key={i}
                        className={`tb-line ${isEditing ? 'tb-line--cur' : ''} ${dragging ? 'tb-line--dragging' : ''}`}
                        style={{ paddingLeft: l.level * 18 + (dragging ? lineDrag!.dx : 0), touchAction: 'pan-y' }}
                        onPointerDown={event => beginLinePress(event, i)}
                        onPointerMove={moveLinePress}
                        onPointerUp={endLinePress}
                        onPointerCancel={cancelLinePress}
                        onContextMenu={event => { event.preventDefault(); setLineMenu(i); }}
                        onClick={() => {
                          if (suppressLineClick.current) { suppressLineClick.current = false; return; }
                          if (!isEditing) setEditing({ index: i, title: l.title });
                        }}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            className="tb-line-input"
                            autoFocus
                            value={editing.title}
                            onChange={e => setEditing({ index: i, title: e.target.value })}
                            onClick={e => e.stopPropagation()}
                            onBlur={commitEdit}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); newLine(); }
                              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                            }}
                          />
                        ) : (
                          <span className="tb-line-text">{l.title || '未命名'}</span>
                        )}
                        {hasChildren && <span className="tb-line-branch">↳</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="tb-text-wrap">
                <textarea
                  className="tb-text"
                  spellCheck={false}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={'- 一级\n\t- 二级'}
                />
                <div className="tb-text-meta">
                  <span>{parseTaskText(text).length} 行</span>
                  <span>Tab 缩进</span>
                </div>
              </div>
            )}

            {lineMenu !== null && lines[lineMenu] && <div className="tb-line-menu-mask" onClick={() => setLineMenu(null)}><section className="tb-line-menu" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="任务行操作"><header><span>{lines[lineMenu].title || '未命名'}</span><button onClick={() => setLineMenu(null)} aria-label="关闭">×</button></header><button onClick={() => { setEditing({ index: lineMenu, title: lines[lineMenu].title }); setLineMenu(null); focusEditInput(); }}>编辑</button><button disabled={lines[lineMenu + 1]?.level > lines[lineMenu].level} onClick={() => void shelveLine(lineMenu)}>搁置</button><button className="is-danger" onClick={() => removeLine(lineMenu)}>删除</button></section></div>}

            <button className="tb-done" onClick={finish} disabled={busy}>
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
