import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useRegisterBackHandler } from '../../contexts/BackButtonContext';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CornerUpLeft,
  ListTree,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useTaskBoard } from '../../hooks/useTaskBoard';
import { genId } from '../../types';
import type { TaskLeaf, TaskNode } from '../../types';
import {
  flattenTaskRows,
  newTaskRow,
  persistableTaskRows,
  removeTaskBranch,
  rowsToTree,
  shiftTaskBranch,
  withTrailingDraftRow,
  type TaskRow,
} from '../../utils/taskRows';
import { useUi } from '../state/ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

let todoLock = 0;
let todoOverflow = '';

export default function TodoSheet({ open, onClose }: Props) {
  const { nodes, leaves, shelved, undone, saveTree, toggle, shelve, clearExpired } = useTaskBoard();
  const ui = useUi();
  const [addText, setAddText] = useState('');
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const [baseNodes, setBaseNodes] = useState<TaskNode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showShelved, setShowShelved] = useState(false);
  const [celebrate, setCelebrate] = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const active = useMemo(() => leaves.filter(leaf => !leaf.done), [leaves]);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setRows([]);
      setDraftId(null);
      setError('');
      return;
    }
    todoLock += 1;
    if (todoLock === 1) {
      todoOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    void clearExpired();
    window.setTimeout(() => addRef.current?.focus({ preventScroll: true }), 180);
    return () => {
      todoLock = Math.max(0, todoLock - 1);
      if (todoLock === 0) document.body.style.overflow = todoOverflow;
    };
    // clearExpired is stable enough for an open-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (celebrate === null) return;
    const timer = window.setTimeout(() => setCelebrate(null), 1700);
    return () => window.clearTimeout(timer);
  }, [celebrate]);

  useEffect(() => {
    if (!editing || !focusRow) return;
    const input = document.querySelector<HTMLInputElement>(`[data-todo-row="${focusRow}"] input`);
    input?.focus({ preventScroll: true });
    setFocusRow(null);
  }, [editing, focusRow, rows]);

  const close = useCallback(async () => {
    if (editing) {
      const ok = await persistRows();
      if (!ok) return;
    }
    onClose();
  }, [editing, onClose]); // persistRows is declared below; safe at call time

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  useRegisterBackHandler(() => {
    if (!open) return false;
    void close();
    return true;
  }, [open, close], 'overlay');

  async function addTask() {
    const title = addText.trim();
    if (!title || busy) return;
    setBusy(true);
    setError('');
    try {
      const node: TaskNode = { id: genId(), title, done: false, children: [] };
      await saveTree([...nodes, node]);
      setAddText('');
      addRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  function beginEdit() {
    setBaseNodes(nodes);
    const { rows: next, draftId: nextDraft } = withTrailingDraftRow(flattenTaskRows(nodes));
    setRows(next);
    setDraftId(nextDraft);
    setEditing(true);
    setError('');
    setFocusRow(nextDraft);
  }

  async function persistRows(): Promise<boolean> {
    if (busy) return false;
    const meaningful = persistableTaskRows(rows);
    setBusy(true);
    setError('');
    try {
      await saveTree(rowsToTree(meaningful), baseNodes);
      setEditing(false);
      setBusy(false);
      ui.toast('清单已更新');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
      setBusy(false);
      return false;
    }
  }

  function updateRow(id: string, text: string) {
    setRows(current => current.map(row => row.id === id ? { ...row, title: text } : row));
  }

  function addRowAfter(index: number, level: number) {
    const row = newTaskRow(level);
    setRows(current => {
      const next = [...current.slice(0, index + 1), row, ...current.slice(index + 1)];
      return next;
    });
    setDraftId(row.id);
    setFocusRow(row.id);
  }

  function removeRow(index: number) {
    let next = removeTaskBranch(rows, index);
    if (draftId && !next.some(row => row.id === draftId)) {
      const fresh = newTaskRow(next.length ? next[next.length - 1].level : 0);
      next = [...next, fresh];
      setDraftId(fresh.id);
    }
    setRows(next);
    setFocusRow(next[Math.min(index, next.length - 1)]?.id ?? null);
  }

  function shiftRow(index: number, delta: number) {
    setRows(current => shiftTaskBranch(current, index, delta));
  }

  function handleToggle(leaf: TaskLeaf) {
    const finishingAll = active.length === 1;
    void toggle(leaf.key);
    if (finishingAll) setCelebrate(active.length);
    ui.toast(`已完成 · ${leaf.label}`, {
      actionLabel: '撤销',
      onAction: () => void toggle(leaf.key),
      duration: 4200,
    });
  }

  if (!open) return null;

  return createPortal(
    <div className="v-todo-wrap" role="dialog" aria-modal="true" aria-label="待办">
      <div className="v-todo">
        <header className="v-todo-head">
          <h1>待办</h1>
          <span className="v-todo-count">{undone} 项未完成</span>
          <button type="button" className="v-iconbtn" aria-label="关闭待办" onClick={() => void close()}>
            <X size={19} />
          </button>
        </header>

        <div className="v-todo-add">
          <Plus size={17} style={{ color: 'var(--v-text-3)', flex: 'none' }} />
          <input
            ref={addRef}
            value={addText}
            onChange={event => setAddText(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void addTask(); }}
            placeholder="添加一项待办，回车保存"
            maxLength={160}
            aria-label="新待办"
          />
          <button type="button" aria-label="添加待办" onClick={() => void addTask()} disabled={!addText.trim() || busy}>
            <Plus size={18} />
          </button>
        </div>

        <div className="v-todo-toolbar">
          <span className="v-grow" />
          {editing ? (
            <>
              <button type="button" className="v-btn v-btn--ghost v-btn--sm" disabled={busy} onClick={() => { setEditing(false); setRows([]); }}>
                取消
              </button>
              <button type="button" className="v-btn v-btn--primary v-btn--sm" disabled={busy} onClick={() => void persistRows()}>
                {busy ? '保存中…' : '完成'}
              </button>
            </>
          ) : (
            <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={beginEdit}>
              <ListTree size={15} /> 整理层级
            </button>
          )}
        </div>

        {error && <p role="alert" style={{ margin: '0 24px 8px', fontSize: 12.5, color: 'var(--v-red)' }}>{error}</p>}

        <div className="v-todo-list">
          {editing ? (
            <div>
              {rows.map((row, index) => (
                <div
                  key={row.id}
                  className="v-todo-edit-row"
                  data-todo-row={row.id}
                  style={{ ['--v-row-level' as string]: row.level } as CSSProperties}
                >
                  <span className="v-todo-edit-indent" />
                  <input
                    value={row.title}
                    placeholder={index === rows.length - 1 ? '继续添加…' : '待办内容'}
                    onChange={event => updateRow(row.id, event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addRowAfter(index, row.level);
                      }
                    }}
                  />
                  <button type="button" className="v-iconbtn" aria-label="降低层级" disabled={row.level <= 0} onClick={() => shiftRow(index, -1)}>
                    <ChevronLeft size={15} />
                  </button>
                  <button type="button" className="v-iconbtn" aria-label="提高层级" disabled={index === 0} onClick={() => shiftRow(index, 1)}>
                    <ChevronRight size={15} />
                  </button>
                  <button type="button" className="v-iconbtn" aria-label="添加子项" onClick={() => addRowAfter(index, row.level + 1)}>
                    <Plus size={15} />
                  </button>
                  <button type="button" className="v-iconbtn" aria-label="删除此项" onClick={() => removeRow(index)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <p className="v-tiny" style={{ marginTop: 12, lineHeight: 1.6 }}>
                ← → 调整层级，＋ 添加同级/子级，完成后保存。空行不会写入清单。
              </p>
            </div>
          ) : active.length ? (
            <div>
              {active.map(leaf => (
                <button key={leaf.key} type="button" className="v-todo-row" onClick={() => handleToggle(leaf)}>
                  <span className="v-checkbox" aria-hidden="true">
                    <Check size={12} />
                  </span>
                  <span className="v-todo-row-main">
                    <span className="v-todo-row-title">{leaf.label}</span>
                    {leaf.chain.length > 1 && <span className="v-todo-row-path">{leaf.chain.slice(0, -1).join(' / ')}</span>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="v-empty v-todo-empty">
              <div className="v-empty-icon"><Check size={24} /></div>
              <strong>清单空了</strong>
              <p>在上面写下一件要做的小事。完成一项，就少一件心事。</p>
            </div>
          )}

          {!!shelved.length && (
            <>
              <button
                type="button"
                className="v-todo-section-label"
                style={{ border: 0, background: 'transparent', width: '100%', padding: 0, marginTop: 22 }}
                onClick={() => setShowShelved(value => !value)}
              >
                遗留 {shelved.length}
                <ChevronLeft size={13} style={{ transform: showShelved ? 'rotate(-90deg)' : 'rotate(180deg)', transition: 'transform 200ms' }} />
              </button>
              {showShelved && shelved.map(leaf => (
                <div key={leaf.key} className="v-todo-row" style={{ cursor: 'default' }}>
                  <span className="v-todo-row-main">
                    <span className="v-todo-row-title" style={{ color: 'var(--v-text-2)' }}>{leaf.label}</span>
                    {leaf.chain.length > 1 && <span className="v-todo-row-path">{leaf.chain.slice(0, -1).join(' / ')}</span>}
                  </span>
                  <button
                    type="button"
                    className="v-btn v-btn--ghost v-btn--sm"
                    onClick={() => void shelve(leaf.key, false)}
                  >
                    <CornerUpLeft size={14} /> 移回
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {celebrate !== null && (
          <div className="v-todo-celebrate">
            <div className="v-todo-celebrate-card">
              <Sparkles size={24} style={{ color: 'var(--v-accent)' }} />
              <strong>全部完成</strong>
              <span>{celebrate} 项待办，一项不剩。</span>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
