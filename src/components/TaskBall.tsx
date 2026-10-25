import { useEffect, useMemo, useRef, useState } from 'react';
import { useTaskBoard } from '../hooks/useTaskBoard';
import type { TaskLine } from '../utils/taskTree';
import {
  chainText,
  linesToText,
  linesToTree,
  parseTaskText,
  treeToLines,
  treeToText,
} from '../utils/taskTree';
import './TaskBall.css';

type Panel = 'list' | 'editor' | null;

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
  const { nodes, leaves, undone, saveTree, toggle, remove, reorder } = useTaskBoard();

  const [panel, setPanel] = useState<Panel>(null);
  const [mode, setMode] = useState<'lines' | 'text'>('lines');
  const [lines, setLines] = useState<TaskLine[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState('');
  const [level, setLevel] = useState(0);
  const [editing, setEditing] = useState<{ index: number; title: string } | null>(null);
  const [chain, setChain] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

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
    const ls = treeToLines(nodes);
    setLines(ls);
    setText(treeToText(nodes));
    setMode('lines');
    setPending('');
    setEditing(null);
    setLevel(ls.length ? ls[ls.length - 1].level : 0);
    setPanel('editor');
  }

  const lastLevel = lines.length ? lines[lines.length - 1].level : -1;

  /** 提交底部输入框里的新行 */
  function commitLine() {
    const title = pending.trim();
    if (!title) return;
    const lv = Math.max(0, Math.min(level, lastLevel + 1));
    setLines([...lines, { title, level: lv }]);
    setPending('');
    setLevel(lv);
  }

  /** 提交正在就地编辑的那一行 */
  function commitEdit() {
    if (!editing) return;
    const title = editing.title.trim();
    const idx = editing.index;
    setEditing(null);
    if (!title) return; // 空内容：保持原样，不惊动用户
    setLines(ls => ls.map((l, i) => (i === idx ? { ...l, title } : l)));
  }

  /** 换行：先提交就地编辑，再准备下一行 */
  function newLine() {
    if (editing) commitEdit();
    else commitLine();
  }

  function indent() {
    if (editing) {
      const idx = editing.index;
      setLines(ls => ls.map((l, i) => {
        if (i !== idx) return l;
        const max = i === 0 ? 0 : ls[i - 1].level + 1;
        return { ...l, level: Math.min(l.level + 1, max) };
      }));
      return;
    }
    if (lines.length === 0) return;
    setLevel(v => Math.min(v + 1, lastLevel + 1));
  }

  function outdent() {
    if (editing) {
      const idx = editing.index;
      setLines(ls => ls.map((l, i) => (i === idx ? { ...l, level: Math.max(0, l.level - 1) } : l)));
      return;
    }
    if (lines.length === 0) return; // 没有上一行：不处理，不提示
    setLevel(v => Math.max(0, v - 1));
  }

  function deleteLine() {
    if (editing) {
      const idx = editing.index;
      setEditing(null);
      setLines(ls => ls.filter((_, i) => i !== idx));
      return;
    }
    if (pending) { setPending(''); return; }
    if (lines.length === 0) return;
    const next = lines.slice(0, -1);
    setLines(next);
    setLevel(next.length ? next[next.length - 1].level : 0);
  }

  function switchMode(next: 'lines' | 'text') {
    if (next === mode) return;
    setEditing(null);
    if (next === 'text') setText(linesToText(lines));
    else setLines(parseTaskText(text));
    setMode(next);
  }

  async function finish() {
    commitEdit();
    const finalLines = mode === 'text' ? parseTaskText(text) : lines;
    if (finalLines.length === 0) { setPanel('list'); return; }
    setBusy(true);
    try {
      await saveTree(linesToTree(finalLines, nodes));
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
  const shownLevel = editing ? (lines[editing.index]?.level ?? 0) : level;

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
              <button className="tb-link" onClick={openEditor}>继续编辑</button>
            </div>

            <div className="tb-list">
              {leaves.length === 0 ? (
                <div className="tb-empty">还没有任务</div>
              ) : leaves.map(leaf => (
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
                  <button
                    className={`tb-ic tb-ic--box ${leaf.done ? 'tb-ic--on' : ''}`}
                    onClick={() => toggle(leaf.key)}
                  >✓</button>
                  <button className="tb-ic" onClick={() => remove(leaf.key)}>✕</button>
                </div>
              ))}
            </div>

            <div className="tb-foot">待办 {undone} · 已结束 {done}</div>
          </div>
        </div>
      )}

      {panel === 'editor' && (
        <div className="tb-mask" onClick={() => setPanel(null)}>
          <div className="tb-sheet tb-sheet--editor" onClick={e => e.stopPropagation()}>
            <div className="tb-grip" />
            <div className="tb-head">
              <span className="tb-title">任务</span>
              <span className="tb-modes">
                <button className={mode === 'lines' ? 'tb-mode--on' : ''} onClick={() => switchMode('lines')}>层级</button>
                <button className={mode === 'text' ? 'tb-mode--on' : ''} onClick={() => switchMode('text')}>文本</button>
              </span>
            </div>

            {mode === 'lines' ? (
              <>
                <div className="tb-lines">
                  {lines.length === 0 && !editing && <div className="tb-empty">在下面输入第一行</div>}
                  {lines.map((l, i) => {
                    const isEditing = editing?.index === i;
                    return (
                      <div
                        key={i}
                        className={`tb-line ${isEditing ? 'tb-line--cur' : ''}`}
                        style={{ paddingLeft: l.level * 18 }}
                        onClick={() => { if (!isEditing) setEditing({ index: i, title: l.title }); }}
                      >
                        {isEditing ? (
                          <input
                            className="tb-line-input"
                            autoFocus
                            value={editing.title}
                            onChange={e => setEditing({ index: i, title: e.target.value })}
                            onClick={e => e.stopPropagation()}
                            onBlur={commitEdit}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                            }}
                          />
                        ) : (
                          <span className="tb-line-text">{l.title}</span>
                        )}
                      </div>
                    );
                  })}
                  {!editing && pending && (
                    <div className="tb-line tb-line--cur" style={{ paddingLeft: level * 18 }}>
                      <span className="tb-line-text">{pending}</span>
                    </div>
                  )}
                </div>

                <div className="tb-input-row">
                  <span className="tb-lvl">第 {shownLevel + 1} 层</span>
                  <input
                    className="tb-input"
                    value={pending}
                    placeholder="输入一行"
                    onChange={e => setPending(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitLine(); } }}
                  />
                </div>

                <div className="tb-keys">
                  <button className="tb-key" onClick={newLine}>换行</button>
                  <button className="tb-key" onClick={indent}>缩进</button>
                  <button className="tb-key" onClick={outdent}>缩退</button>
                  <button className="tb-key" onClick={deleteLine}>删除</button>
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
    </>
  );
}
