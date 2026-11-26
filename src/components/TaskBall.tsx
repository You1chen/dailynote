import { useEffect, useMemo, useRef, useState } from 'react';
import { useTaskBoard } from '../hooks/useTaskBoard';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';
import { CornerUpLeft, Ellipsis } from 'lucide-react';
import { readTodoConfirmations } from '../utils/todoConfirmations';
import { elapsedTaskMs, formatTaskElapsed } from '../utils/taskTiming';
import CelebrationDialog from './CelebrationDialog';
import type { TaskLeaf, TaskNode } from '../types';
import {
  chainText,
  completesAll,
  pruneExpiredTasks,
  TASK_UNDO_MS,
} from '../utils/taskTree';
import { branchEnd, flattenTaskRows, moveTaskBranch, newTaskRow, persistableTaskRows, removeTaskBranch, rowsToTree, shiftTaskBranch, withTrailingDraftRow, type TaskRow } from '../utils/taskRows';
import { commitTaskRow, shouldActivateDraftOnBlur, shouldReuseAppendOnEnter } from '../utils/taskRowEditing';
import { taskDragLayout } from '../utils/taskDragLayout';
import './TaskBall.css';

interface DragGroup { start: number; end: number; top: number; bottom: number }
interface VerticalDrag {
  groups: DragGroup[];
  source: number;
  startY: number;
  scroller: HTMLElement;
  scrollTop: number;
}

function verticalLayout(drag: VerticalDrag, clientY: number) {
  return taskDragLayout(drag.groups, drag.source, clientY - drag.startY + drag.scroller.scrollTop - drag.scrollTop);
}

function measureGroup(rows: ArrayLike<Element>, start: number, end: number): DragGroup {
  return { start, end, top: rows[start].getBoundingClientRect().top, bottom: rows[end - 1].getBoundingClientRect().bottom };
}

function measureBranches(host: HTMLElement, rows: TaskRow[], index: number, draftId: string | null, startY: number): VerticalDrag | null {
  const scroller = host.parentElement;
  const tail = rows[rows.length - 1];
  const items = tail && tail.id === draftId && !tail.title.trim() ? rows.slice(0, -1) : rows;
  if (!scroller || !items[index]) return null;
  const level = items[index].level;
  let first = index;
  for (let i = index - 1; i >= 0 && items[i].level >= level; i--) {
    if (items[i].level === level) first = i;
  }
  const ordered = Array.from(scroller.querySelectorAll<HTMLElement>('[data-editor-index]'))
    .sort((a, b) => Number(a.dataset.editorIndex) - Number(b.dataset.editorIndex));
  const groups: DragGroup[] = [];
  for (let i = first; items[i]?.level === level;) {
    const end = branchEnd(items, i);
    groups.push(measureGroup(ordered, i, end));
    i = end;
  }
  return { groups, source: groups.findIndex(group => group.start === index), startY, scroller, scrollTop: scroller.scrollTop };
}

type Panel = 'list' | 'editor' | 'shelved' | null;
type ListAction = { key: string; kind: 'startTimer' | 'stopTimer' | 'moveToBacklog' };

const LIST_ACTION_LABELS = {
  startTimer: '开始计时',
  stopTimer: '停止计时',
  moveToBacklog: '移入遗留',
} as const;
const TASK_TAP_MS = 300;
const TASK_DRAG_SLOP = 8;

const POS_KEY = 'dailynote_task_ball_pos';

interface Pos { right: number; bottom: number }

/** 长按多久进入拖拽状态（毫秒）。进入后菜单仍不弹出，需抬手且未移动才弹。 */
const LINE_HOLD_MS = 420;
/** 横向移动超过该距离才算一次层级调整。 */
const LINE_LEVEL_PX = 18;

interface LineGesture {
  index: number;
  startX: number;
  startY: number;
  held: boolean;
  scroll: { element: HTMLElement; top: number } | null;
  axis: 'x' | 'y' | null;
  vertical: VerticalDrag | null;
  pointerId: number;
  timer: ReturnType<typeof setTimeout> | null;
}

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
  const { nodes, leaves, shelved, undone, saveTree, toggle, toggleTimer, remove, shelve, reorder, clearExpired } = useTaskBoard();

  const [panel, setPanel] = useState<Panel>(null);
  const [lines, setLines] = useState<TaskRow[]>([]);
  const [draftRowId, setDraftRowId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ index: number; title: string } | null>(null);
  const [lineMenu, setLineMenu] = useState<number | null>(null);
  const [deleteLineIndex, setDeleteLineIndex] = useState<number | null>(null);
  const [lineDrag, setLineDrag] = useState<{ index: number; dx: number; axis: 'x' | 'y'; offsets?: number[] } | null>(null);
  const linePress = useRef<LineGesture | null>(null);
  const lineClickGuard = useRef(0);
  const lineMenuPressed = useRef(false);
  useEffect(() => () => { if (linePress.current?.timer) clearTimeout(linePress.current.timer); }, []);
  const pendingRowClick = useRef<string | null>(null);
  const [chain, setChain] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const editorSaving = useRef(false);
  const editorBaseNodes = useRef<TaskNode[]>([]);
  const [saveError, setSaveError] = useState('');
  const [listDrag, setListDrag] = useState<{ key: string; keys: string[]; offsets: number[]; backlog: boolean } | null>(null);
  const listPress = useRef<(VerticalDrag & {
    pointerId: number; keys: string[]; startX: number; moved: boolean; pressedAt: number;
    scrolling: boolean; cancelled: boolean; clientY: number; maxScroll: number; frame: number | null;
  }) | null>(null);
  const pendingTap = useRef<{ key: string; id: number } | null>(null);
  const [confirmAction, setConfirmAction] = useState<ListAction | null>(null);
  const [now, setNow] = useState(Date.now);
  const actionPending = useRef(false);
  const cleanupRetryAt = useRef(0);
  const [listBusy, setListBusy] = useState(false);
  /** 全部完成时的庆祝弹窗（null = 不显示；数字 = 本次清单总条数） */
  const [celebration, setCelebration] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editorSheet = useSheetDrag(() => { void saveAndExitEditor(null); }, panel === 'editor' && !busy);
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

  function openList() {
    setSaveError('');
    setPanel('list');
  }

  function onBallClick() {
    if (Date.now() - clickGuardRef.current < 400) return;
    openList();
  }

  // ---- 填写窗 ----
  function openEditor() {
    editorBaseNodes.current = nodes;
    const existing = flattenTaskRows(pruneExpiredTasks(nodes));
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
    return commitTaskRow(lines, id, editInputRef.current?.value ?? editing.title);
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
    setLineDrag(null);
  }
  /** 按下即待命；满 LINE_HOLD_MS 才进入拖拽态，此时菜单仍不弹出。 */
  function beginLineAt(event: React.PointerEvent<HTMLElement>, index: number) {
    if (busy || event.button !== 0 || linePress.current) return;
    if ((event.target as HTMLElement).closest('input')) return;
    // Keep the focused input (and its IME) active while another row is held.
    if (editing) event.preventDefault();
    clearLinePress();
    const host = (event.currentTarget as HTMLElement).closest('.tb-line') as HTMLElement | null;
    const gesture: LineGesture = {
      index,
      startX: event.clientX,
      startY: event.clientY,
      held: false,
      scroll: event.pointerType === 'touch' && host?.parentElement ? { element: host.parentElement, top: host.parentElement.scrollTop } : null,
      axis: null,
      vertical: host ? measureBranches(host, committedLines(), index, draftRowId, event.clientY) : null,
      pointerId: event.pointerId,
      timer: null,
    };
    gesture.timer = setTimeout(() => {
      if (linePress.current !== gesture) return;
      gesture.held = true;
      setLineDrag({ index: gesture.index, dx: 0, axis: 'x' });
      try { navigator.vibrate?.(8); } catch { /* 桌面端不支持振动 */ }
    }, LINE_HOLD_MS);
    linePress.current = gesture;
    // 捕获到实际按下的元素，手指移出行外仍能收到移动与抬手。
    try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* 部分 WebView 不支持 */ }
  }

  function moveLineAt(event: React.PointerEvent<HTMLElement>) {
    const gesture = linePress.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.held) {
      if (Math.hypot(dx, dy) > 10 && gesture.timer) {
        clearTimeout(gesture.timer);
        gesture.timer = null;
        lineClickGuard.current = Date.now() + 500;
      }
      if (!gesture.timer && gesture.scroll) gesture.scroll.element.scrollTop = gesture.scroll.top - dy;
      return;
    }
    event.preventDefault();
    if (!gesture.axis) {
      if (Math.hypot(dx, dy) < 6) return;
      gesture.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (gesture.axis === 'x') {
      setLineDrag({ index: gesture.index, dx, axis: 'x' });
      return;
    }
    const vertical = gesture.vertical;
    if (vertical) {
      const { offsets } = verticalLayout(vertical, event.clientY);
      const rows = Array<number>(lines.length).fill(0);
      vertical.groups.forEach(({ start, end }, group) => rows.fill(offsets[group], start, end));
      setLineDrag({ index: gesture.index, dx: dy, axis: 'y', offsets: rows });
    }
  }

  function reorderLineBranch(gesture: LineGesture, clientY: number) {
    const vertical = gesture.vertical;
    if (!vertical) return;
    const { targetIndex } = verticalLayout(vertical, clientY);
    const delta = targetIndex - vertical.source;
    if (!delta) return;
    const source = committedLines();
    const activeId = editing ? source[editing.index]?.id : undefined;
    const tail = source[source.length - 1];
    const blank = tail?.id === draftRowId && !tail.title.trim() ? tail : undefined;
    let rows = blank ? source.slice(0, -1) : source;
    let index = gesture.index;
    if (index >= rows.length) return;
    const direction = delta > 0 ? 1 : -1;
    const steps = Math.abs(delta);
    for (let n = 0; n < steps; n++) {
      const moved = moveTaskBranch(rows, index, direction);
      if (moved.rows === rows) break;
      ({ rows, index } = moved);
    }
    if (index === gesture.index) return;
    const next = blank ? [...rows, blank] : rows;
    if (!blank && next[next.length - 1]?.id !== draftRowId) {
      const draft = newTaskRow(next[next.length - 1]?.level ?? 0);
      next.push(draft);
      setDraftRowId(draft.id);
    }
    setLines(next);
    const editIndex = next.findIndex(row => row.id === activeId);
    if (editIndex >= 0 && editing) setEditing({ ...editing, index: editIndex });
  }

  function endLineAt(event: React.PointerEvent<HTMLElement>) {
    const gesture = linePress.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    clearLinePress();
    if (!gesture.held) {
      if (!gesture.timer) {
        pendingRowClick.current = null;
        lineClickGuard.current = Date.now() + 500;
      }
      return;
    }
    pendingRowClick.current = null;
    lineClickGuard.current = Date.now() + 500;
    const axis = gesture.axis ?? (Math.hypot(dx, dy) >= 6 ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null);
    if (axis === 'y') reorderLineBranch(gesture, event.clientY);
    if (axis === 'x' && Math.abs(dx) >= LINE_LEVEL_PX) adjustLineLevel(gesture.index, dx > 0 ? 1 : -1);
    if (axis === null) openLineMenu(gesture.index);
  }

  function openLineMenu(index: number) {
    lineMenuPressed.current = false;
    setLineMenu(index);
  }

  function cancelLinePress(event?: React.PointerEvent<HTMLElement>) {
    const gesture = linePress.current;
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    pendingRowClick.current = null;
    clearLinePress();
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

  function finishActiveRow() {
    if (!editing) return false;
    const id = lines[editing.index]?.id;
    const value = editInputRef.current?.value ?? editing.title;
    if (id) {
      const { rows, draftId } = withTrailingDraftRow(commitTaskRow(lines, id, value));
      setLines(rows);
      setDraftRowId(draftId);
    }
    pendingRowClick.current = null;
    setEditing(null);
    return true;
  }

  async function saveAndExitEditor(nextPanel: Panel) {
    if (busy || editorSaving.current) return;
    editorSaving.current = true;
    const baseLines = committedLines();
    setLines(baseLines);
    const finalRows = persistableTaskRows(baseLines);
    setSaveError('');
    setBusy(true);
    try {
      await saveTree(finalRows.length ? rowsToTree(finalRows) : [], editorBaseNodes.current);
      setEditing(null);
      setPanel(nextPanel);
    } catch {
      setSaveError('保存失败，当前编辑内容已保留');
    } finally {
      editorSaving.current = false;
      setBusy(false);
    }
  }

  function finish() {
    if (busy || editorSaving.current || finishActiveRow()) return;
    void saveAndExitEditor('list');
  }

  useRegisterBackHandler(() => {
    if (confirmAction) { setConfirmAction(null); return true; }
    if (deleteLineIndex !== null) { setDeleteLineIndex(null); return true; }
    if (lineMenu !== null) { setLineMenu(null); return true; }
    if (chain) { setChain(null); return true; }
    if (panel === 'editor') { void saveAndExitEditor(null); return true; }
    if (panel) { setPanel(null); return true; }
    return false;
  }, [confirmAction, deleteLineIndex, lineMenu, chain, panel, busy, lines, editing, saveTree]);

  async function listAction(action: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setListBusy(true);
    setSaveError('');
    try { await action(); }
    catch { setSaveError('任务未保存，请重试'); }
    finally { actionPending.current = false; setListBusy(false); }
  }

  function clearPendingTap() {
    if (pendingTap.current) window.clearTimeout(pendingTap.current.id);
    pendingTap.current = null;
  }

  function startListDrag(event: React.PointerEvent<HTMLElement>, source: number) {
    if (event.button !== 0 || !event.isPrimary || listPress.current || actionPending.current || confirmAction) return;
    const scroller = event.currentTarget.closest<HTMLElement>('.tb-list');
    if (!scroller) return;
    const keys = visibleLeaves.map(leaf => leaf.key);
    const groups = keys.map((_, i) => measureGroup(scroller.children, i, i + 1));
    listPress.current = {
      source, groups, keys, scroller, startX: event.clientX, startY: event.clientY, clientY: event.clientY,
      scrollTop: scroller.scrollTop, pointerId: event.pointerId, moved: false, pressedAt: performance.now(),
      scrolling: false, cancelled: false, maxScroll: scroller.scrollHeight - scroller.clientHeight, frame: null,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Older WebViews can omit capture. */ }
  }

  function atBacklog(drag: VerticalDrag, clientY: number) {
    const last = drag.groups[drag.groups.length - 1];
    const scrollDelta = drag.scroller.scrollTop - drag.scrollTop;
    return !!last && clientY > drag.startY && clientY + scrollDelta >= last.bottom + (last.bottom - last.top);
  }

  function previewListDrag(drag: NonNullable<typeof listPress.current>) {
    const { offsets } = verticalLayout(drag, drag.clientY);
    setListDrag({ key: drag.keys[drag.source], keys: drag.keys, offsets, backlog: atBacklog(drag, drag.clientY) });
  }

  function scrollListWhileDragging(drag: NonNullable<typeof listPress.current>) {
    if (listPress.current !== drag) return;
    const { top, bottom } = drag.scroller.getBoundingClientRect();
    const border = 28;
    const before = drag.scroller.scrollTop;
    if (drag.clientY < top + border) drag.scroller.scrollTop -= 10;
    if (drag.clientY > bottom - border && before < drag.maxScroll) drag.scroller.scrollTop = Math.min(before + 10, drag.maxScroll);
    if (drag.scroller.scrollTop !== before) previewListDrag(drag);
    drag.frame = requestAnimationFrame(() => scrollListWhileDragging(drag));
  }

  function moveListDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = listPress.current;
    if (!drag || event.pointerId !== drag.pointerId || drag.cancelled) return;
    drag.clientY = event.clientY;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && !drag.scrolling) {
      if (Math.hypot(dx, dy) < TASK_DRAG_SLOP) return;
      clearPendingTap();
      if (Math.abs(dx) > Math.abs(dy)) { drag.cancelled = true; return; }
      if (event.pointerType === 'touch' && drag.scroller.scrollHeight > drag.scroller.clientHeight && performance.now() - drag.pressedAt < LINE_HOLD_MS) {
        drag.scrolling = true;
      }
    }
    if (drag.scrolling) {
      drag.scroller.scrollTop = drag.scrollTop - dy;
      return;
    }
    drag.moved = true;
    previewListDrag(drag);
    if (drag.frame === null) drag.frame = requestAnimationFrame(() => scrollListWhileDragging(drag));
  }

  function stopListDrag(event: React.PointerEvent<HTMLElement>, commit: boolean) {
    const drag = listPress.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    listPress.current = null;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    setListDrag(null);
    if (!commit || drag.cancelled) { clearPendingTap(); return; }
    const key = drag.keys[drag.source];
    if (!drag.moved) {
      if (!drag.scrolling && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < TASK_DRAG_SLOP && performance.now() - drag.pressedAt < LINE_HOLD_MS) queueTaskTap(key);
      return;
    }
    if (atBacklog(drag, event.clientY)) {
      requestListAction({ key, kind: 'moveToBacklog' });
      return;
    }
    const { targetIndex } = verticalLayout(drag, event.clientY);
    if (targetIndex !== drag.source) void listAction(() => reorder(key, drag.keys[targetIndex]));
  }

  // 搜索结果跳转过来时打开面板
  useEffect(() => {
    const onOpen = () => { if (panel !== 'editor') openEditor(); };
    window.addEventListener('dailynote-open-tasks', onOpen);
    return () => window.removeEventListener('dailynote-open-tasks', onOpen);
  }, [nodes, panel]);
  const done = useMemo(() => leaves.filter(l => l.done).length, [leaves]);

  const visibleLeaves = useMemo(
    () => listDrag ? listDrag.keys.flatMap(key => leaves.filter(leaf => leaf.key === key)) : leaves,
    [leaves, listDrag],
  );
  const boardLeaves = useRef({ leaves, shelved });
  boardLeaves.current = { leaves, shelved };
  const hasRunningTimer = (panel === 'shelved' ? shelved : leaves).some(leaf => leaf.taskTiming?.startedAt !== undefined);

  useEffect(() => {
    if ((panel !== 'list' && panel !== 'shelved') || !hasRunningTimer) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [panel, hasRunningTimer]);

  useEffect(() => () => {
    clearPendingTap();
    const drag = listPress.current;
    if (drag?.frame != null) cancelAnimationFrame(drag.frame);
    listPress.current = null;
    setListDrag(null);
  }, [panel]);

  const expiresAt = useMemo(() => [...leaves, ...shelved].reduce(
    (earliest, leaf) => leaf.done ? Math.min(earliest, leaf.doneAt ? leaf.doneAt + TASK_UNDO_MS : 0) : earliest,
    Infinity,
  ), [leaves, shelved]);

  useEffect(() => {
    if (!Number.isFinite(expiresAt) || busy || listBusy || listDrag || panel === 'editor') return;
    const delay = Math.max(expiresAt, cleanupRetryAt.current) - Date.now();
    const id = window.setTimeout(() => {
      void listAction(async () => {
        try {
          await clearExpired();
          cleanupRetryAt.current = 0;
        } catch (error) {
          cleanupRetryAt.current = Date.now() + 10_000;
          throw error;
        }
      });
    }, Math.max(0, Math.min(delay, 2_147_483_647)));
    return () => window.clearTimeout(id);
  }, [expiresAt, busy, listBusy, listDrag, panel, clearExpired]);


  /** 勾掉最后一条未完成的 → 立刻庆祝 */
  function toggleLeaf(leaf: TaskLeaf) {
    const finishedAll = completesAll(leaves, leaf.key);
    void listAction(async () => {
      await toggle(leaf.key);
      if (finishedAll) setCelebration(leaves.length);
    });
  }

  function currentLeaf(key: string) {
    const latest = boardLeaves.current;
    return latest.leaves.find(leaf => leaf.key === key) ?? latest.shelved.find(leaf => leaf.key === key);
  }

  function runListAction(action: ListAction) {
    const leaf = currentLeaf(action.key);
    if (!leaf) return;
    if (action.kind === 'moveToBacklog') {
      if (!leaf.shelved) void listAction(() => shelve(leaf.key, true));
    } else if (!leaf.done && (leaf.taskTiming?.startedAt !== undefined) === (action.kind === 'stopTimer')) {
      void listAction(() => toggleTimer(leaf.key));
    }
  }

  function requestListAction(action: ListAction) {
    if (actionPending.current || confirmAction) return;
    if (readTodoConfirmations()[action.kind]) setConfirmAction(action);
    else runListAction(action);
  }

  function requestTimer(key: string) {
    const leaf = currentLeaf(key);
    if (!leaf || leaf.done) return;
    requestListAction({ key, kind: leaf.taskTiming?.startedAt === undefined ? 'startTimer' : 'stopTimer' });
  }

  function queueTaskTap(key: string) {
    if (actionPending.current || confirmAction) return;
    const doubleTap = pendingTap.current?.key === key;
    clearPendingTap();
    if (doubleTap) {
      const leaf = currentLeaf(key);
      if (leaf) toggleLeaf(leaf);
      return;
    }
    const id = window.setTimeout(() => {
      pendingTap.current = null;
      requestTimer(key);
    }, TASK_TAP_MS);
    pendingTap.current = { key, id };
  }

  function leafText(leaf: TaskLeaf) {
    const started = leaf.taskTiming?.startedAt !== undefined;
    const elapsed = elapsedTaskMs(leaf.taskTiming, now);
    return <>
      <span className="tb-item-text"><span className="tb-item-label">{leaf.label}</span></span>
      {(started || elapsed > 0) && <span className={`tb-item-time${started ? ' tb-item-time--running' : ''}`}>
        {formatTaskElapsed(elapsed)}
      </span>}
    </>;
  }

  function openChain(leaf: TaskLeaf) {
    clearPendingTap();
    setChain(leaf.chain);
  }

  function leafTarget(leaf: TaskLeaf, index?: number) {
    const timer = leaf.taskTiming?.startedAt !== undefined ? '计时中' : '回车控制计时';
    const status = leaf.done ? '已结束' : `待办，${timer}`;
    return <button type="button" className={`tb-list-reorder${index === undefined ? ' tb-list-reorder--backlog' : ''}`}
      aria-label={`${leaf.label}，${status}。空格切换完成状态${index === undefined ? '' : '，方向键排序'}`}
      aria-disabled={listBusy || !!listDrag}
      onPointerDown={index === undefined ? undefined : event => startListDrag(event, index)}
      onPointerMove={moveListDrag}
      onPointerUp={event => {
        if (index !== undefined) stopListDrag(event, true);
      }}
      onPointerCancel={event => stopListDrag(event, false)}
      onLostPointerCapture={event => stopListDrag(event, false)}
      onContextMenu={event => event.preventDefault()}
      onClick={event => {
        // Active rows use pointer-up so suppressed drags never register as taps.
        if (event.detail === 0) requestTimer(leaf.key);
        else if (index === undefined) queueTaskTap(leaf.key);
      }}
      onKeyDown={event => {
        if (event.key === ' ') {
          event.preventDefault();
          clearPendingTap();
          if (!event.repeat && !confirmAction) toggleLeaf(leaf);
          return;
        }
        if (index === undefined || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        clearPendingTap();
        const target = visibleLeaves[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target) void listAction(() => reorder(leaf.key, target.key));
      }}>{leafText(leaf)}</button>;
  }

  const confirmingLeaf = confirmAction && currentLeaf(confirmAction.key);

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
              <span className="tb-title">任务清单</span>
              <span className="tb-head-acts">
                <button className="tb-link" disabled={listBusy || !!listDrag} onClick={openEditor}>编辑任务</button>
              </span>
            </div>

            <div className={`tb-list${listDrag ? ' tb-list--sorting' : ''}`}>
              {visibleLeaves.length === 0 ? (
                <div className="tb-empty">还没有任务</div>
              ) : visibleLeaves.map((leaf, index) => (
                <div key={leaf.key} data-leaf-key={leaf.key}
                  className={`tb-item ${leaf.done ? 'tb-item--done' : ''} ${listDrag?.key === leaf.key ? 'tb-item--drag' : ''}`}
                  style={{ transform: listDrag ? `translateY(${listDrag.offsets[index]}px)` : undefined }}>
                  {leafTarget(leaf, index)}
                  <button type="button" className="tb-ic" title="完整路径" aria-label={`完整路径：${leaf.label}`} onClick={() => openChain(leaf)}><Ellipsis size={19} /></button>
                </div>
              ))}
            </div>

            {saveError && <p className="tb-error" role="alert">{saveError}</p>}
            {listDrag?.backlog && <p className="tb-list-hint tb-list-hint--active">松手移入遗留</p>}
            <div className="tb-foot tb-foot--split">
              <span>待办 {undone} · 已结束 {done}</span>
              <button className="tb-link" onClick={() => setPanel('shelved')}>
                遗留{shelved.length > 0 ? ` ${shelved.length}` : ''}
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
              <span className="tb-title">遗留</span>
              <button className="tb-link" onClick={() => setPanel('list')}>返回任务</button>
            </div>

            <div className="tb-list">
              {shelved.length === 0 ? (
                <div className="tb-empty">没有遗留的任务</div>
              ) : shelved.map(leaf => (
                <div key={leaf.key} className={`tb-item ${leaf.done ? 'tb-item--done' : ''}`}>
                  {leafTarget(leaf)}
                  <button className="tb-ic" title="完整路径" aria-label={`完整路径：${leaf.label}`} onClick={() => openChain(leaf)}><Ellipsis size={19} /></button>
                  <button className="tb-ic" title="移回任务清单" aria-label={`移回任务清单：${leaf.label}`} disabled={listBusy} onClick={() => void listAction(() => shelve(leaf.key, false))}>
                    <CornerUpLeft size={17} />
                  </button>
                  <button className="tb-ic" aria-label={`删除：${leaf.label}`} disabled={listBusy} onClick={() => void listAction(() => remove(leaf.key))}>×</button>
                </div>
              ))}
            </div>

            {saveError && <p className="tb-error" role="alert">{saveError}</p>}
            <div className="tb-foot">遗留 {shelved.length} 条</div>
          </div>
        </div>
      )}
      {panel === 'editor' && (
        <div className="tb-mask" onClick={() => { void saveAndExitEditor(null); }}>
          <div className="tb-sheet tb-sheet--editor" style={editorSheet.style} onClick={e => e.stopPropagation()}>
            <div className="tb-grip" {...editorSheet.handlers} />
            <div className="tb-head">
              <span className="tb-title">任务</span>
              <span className="tb-head-acts">
                <button className="tb-link" disabled={busy} onClick={() => void saveAndExitEditor('list')}>任务清单</button>
                <button className="tb-link" disabled={busy} onClick={() => void saveAndExitEditor('shelved')}>
                  遗留{shelved.length > 0 ? ` ${shelved.length}` : ''}
                </button>
              </span>
            </div>

              <>
                <div className="tb-lines" onClick={() => { if (!lines.length && !editing) newLine(); }}>
                  {lines.length === 0 && <div className="tb-empty">还没有任务</div>}
                  {/* Keep the focused input's DOM position stable; CSS order follows the tree. */}
                  {lines.map((l, i) => ({ l, i })).sort((a, b) => Number(b.i === editing?.index) - Number(a.i === editing?.index)).map(({ l, i }) => {
                    const isEditing = editing?.index === i;
                    const inDraggedBranch = lineDrag !== null && i >= lineDrag.index && i < branchEnd(lines, lineDrag.index);
                    const hasChildren = lines[i + 1]?.level > l.level;
                    return (
                      <div
                        key={l.id}
                        className={`tb-line ${isEditing ? 'tb-line--cur' : ''} ${inDraggedBranch ? 'tb-line--dragging' : ''} ${lineDrag?.axis === 'y' && !inDraggedBranch ? 'tb-line--yielding' : ''}`}
                        data-editor-index={i}
                         style={{ order: i, paddingLeft: 4 + l.level * 18, transform: lineDrag?.axis === 'y' ? `translateY(${lineDrag.offsets?.[i] ?? 0}px)` : inDraggedBranch ? `translateX(${lineDrag?.dx ?? 0}px)` : undefined }}
                        onPointerDown={event => { pendingRowClick.current = l.id; beginLineAt(event, i); }}
                        onPointerMove={moveLineAt}
                        onPointerUp={endLineAt}
                        onPointerCancel={cancelLinePress}
                        onLostPointerCapture={cancelLinePress}
                        onContextMenu={event => {
                          if ((event.target as HTMLElement).closest('input')) return;
                          event.preventDefault();
                          if (event.button === 2 && (event.nativeEvent as PointerEvent).pointerType === 'mouse') openLineMenu(i);
                        }}
                        onClick={() => {
                          if (Date.now() < lineClickGuard.current) return;
                          if (!isEditing) {
                            if (editing) {
                              const activeId = lines[editing.index]?.id;
                              const title = editInputRef.current?.value ?? editing.title;
                              if (activeId) setLines(current => commitTaskRow(current, activeId, title));
                            }
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

            {lineMenu !== null && lines[lineMenu] && <div className="tb-line-menu-mask"
              onPointerDownCapture={() => { lineMenuPressed.current = true; }}
              onClickCapture={event => {
                if (event.detail > 0 && !lineMenuPressed.current) event.stopPropagation();
                lineMenuPressed.current = false;
              }}
              onClick={() => setLineMenu(null)}><section className="tb-line-menu" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="任务行操作"><header><span>{lines[lineMenu].title || '未命名'}</span><button onClick={() => setLineMenu(null)} aria-label="关闭">×</button></header><button onClick={() => { setEditing({ index: lineMenu, title: lines[lineMenu].title }); setLineMenu(null); focusEditInput(); }}>编辑</button><button className="is-danger" onClick={() => { setDeleteLineIndex(lineMenu); setLineMenu(null); }}>删除</button></section></div>}
            <ConfirmDialog open={deleteLineIndex !== null} message="删除这一行及其子任务？" confirmText="删除" onCancel={() => setDeleteLineIndex(null)} onConfirm={() => { if (deleteLineIndex !== null) removeLine(deleteLineIndex); }} />

            {saveError && <p className="tb-error" role="alert">{saveError}</p>}
            <button className="tb-done" onPointerDown={event => { if (editing) event.preventDefault(); }} onClick={() => void finish()} disabled={busy}>
              {busy ? '保存中...' : '完成'}
            </button>
          </div>
        </div>
      )}

      {confirmAction && confirmingLeaf && (
        <ConfirmDialog open message={`「${confirmingLeaf.label}」${LIST_ACTION_LABELS[confirmAction.kind]}？`}
          confirmText={LIST_ACTION_LABELS[confirmAction.kind]}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => { setConfirmAction(null); runListAction(confirmAction); }} />
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

      {/* 全部完成：自动跳出庆祝 */}
      <CelebrationDialog
        open={celebration !== null}
        count={celebration ?? 0}
        onClose={() => setCelebration(null)}
      />
    </>
  );
}
