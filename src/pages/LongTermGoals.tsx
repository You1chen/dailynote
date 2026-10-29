import { useMemo, useRef, useState } from 'react';
import {
  Plus, Target, ChevronDown, ChevronUp, Trash2, CheckCircle2, Circle,
  Star, CalendarDays, Sparkles, Heart, Feather, Pencil, MoreHorizontal, X, Scale,
} from 'lucide-react';
import { useGoals } from '../hooks/useGoals';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from '../components/ConfirmDialog';
import type { GoalNode, GoalTask, LongTermGoal, WishStatus } from '../types';
import { genId } from '../types';
import {
  addNode, canIndent, canOutdent, effectiveNodes, findNode, indentNode, nodeProgress,
  normalizeWeight, outdentNode, percentLabel, removeNode, setNodeWeight, toggleNode,
  treeProgress, treeStats, updateNodeTitle,
} from '../utils/goalTree';
import './LongTermGoals.css';

const CATEGORIES = ['学业', '技能', '健康', '习惯', '其他'];

const STATUS_LABEL: Record<WishStatus, string> = {
  active: '进行中',
  done: '已实现',
  paused: '暂缓',
};

/** 展开后才显示的轻声提示，跟状态走，不落库 */
const MEMORY_LINE: Record<WishStatus, string> = {
  active: '写给未来的自己',
  done: '这份愿望，已经成为你的故事',
  paused: '先把它放在心里，等准备好再出发',
};

function daysLeft(targetDate?: string): number | null {
  if (!targetDate) return null;
  const target = new Date(targetDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** 2027-06-30 → 2027.06.30，让日期更像一个被记住的日子而不是表单值 */
function formatTarget(targetDate: string): string {
  const [y, m, d] = targetDate.split('-');
  if (!y || !m || !d) return targetDate;
  return `${y}.${m}.${d}`;
}

interface WishDraft {
  id?: number;
  title: string;
  vision: string;
  why: string;
  targetDate: string;
  status: WishStatus;
  tasks: GoalTask[];
  dirty: boolean;
}

interface GoalDraft {
  id?: number;
  title: string;
  category: string;
  description: string;
  firstStep: string;
  dirty: boolean;
}

interface ConfirmState {
  message: string;
  confirmText?: string;
  /** 只提示，没有确认动作 */
  info?: boolean;
  onConfirm?: () => void;
}

const EMPTY_WISH: WishDraft = {
  title: '', vision: '', why: '', targetDate: '', status: 'active', tasks: [], dirty: false,
};

const EMPTY_GOAL: GoalDraft = {
  title: '', category: '学业', description: '', firstStep: '', dirty: false,
};

export default function LongTermGoalsPage() {
  const {
    goals, loading, addGoal, addWish, setWishStatus, updateGoal, removeGoal,
    addTask, toggleTask, removeTask,
  } = useGoals();

  // ---- 大愿望编辑器 ----
  const [wishDraft, setWishDraft] = useState<WishDraft | null>(null);
  const [wishMilestone, setWishMilestone] = useState('');

  // ---- 长期目标编辑器 ----
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ---- 展开状态：默认全部收起，点开才看路径 ----
  const [expandedWishId, setExpandedWishId] = useState<number | null>(null);
  const [expandedGoalId, setExpandedGoalId] = useState<number | null>(null);

  // ---- 树编辑状态 ----
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set());
  const [nodeMenuId, setNodeMenuId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeDraft, setNodeDraft] = useState('');
  const [adding, setAdding] = useState<{ goalId: number; parentId: string | null } | null>(null);
  const [newNodeTitle, setNewNodeTitle] = useState('');
  const [weightNodeId, setWeightNodeId] = useState<string | null>(null);
  const [weightDraft, setWeightDraft] = useState('');
  const [weightError, setWeightError] = useState('');

  /** 按 Esc 取消改名时，阻止随后可能触发的 blur 把内容提交 */
  const cancelNodeEditRef = useRef(false);

  // ---- 卡片里的里程碑快捷输入 ----
  const [milestoneDraft, setMilestoneDraft] = useState('');

  const wishes = useMemo(() => goals.filter(g => g.kind === 'wish'), [goals]);
  const plainGoals = useMemo(() => goals.filter(g => g.kind !== 'wish'), [goals]);

  // ============ 打开/关闭编辑器 ============

  function openWishCreate() {
    setSaveError('');
    setWishMilestone('');
    setWishDraft({ ...EMPTY_WISH, tasks: [] });
  }

  function openWishEdit(wish: LongTermGoal) {
    setSaveError('');
    setWishMilestone('');
    setWishDraft({
      id: wish.id,
      title: wish.title,
      vision: wish.vision ?? '',
      why: wish.description ?? '',
      targetDate: wish.targetDate ?? '',
      status: wish.status ?? 'active',
      tasks: (wish.tasks ?? []).map(t => ({ ...t })),
      dirty: false,
    });
  }

  function requestCloseWish() {
    if (!wishDraft) return;
    if (wishDraft.dirty || wishMilestone.trim()) {
      setConfirm({
        message: '放弃未保存的修改？',
        confirmText: '放弃',
        onConfirm: () => setWishDraft(null),
      });
      return;
    }
    setWishDraft(null);
  }

  function openGoalCreate() {
    setSaveError('');
    setGoalDraft({ ...EMPTY_GOAL });
  }

  function openGoalEdit(goal: LongTermGoal) {
    setSaveError('');
    setGoalDraft({
      id: goal.id,
      title: goal.title,
      category: goal.category || '其他',
      description: goal.description ?? '',
      firstStep: '',
      dirty: false,
    });
  }

  function requestCloseGoal() {
    if (!goalDraft) return;
    if (goalDraft.dirty) {
      setConfirm({
        message: '放弃未保存的修改？',
        confirmText: '放弃',
        onConfirm: () => setGoalDraft(null),
      });
      return;
    }
    setGoalDraft(null);
  }

  // ---- 草稿更新（统一标记 dirty） ----

  function patchWish(changes: Partial<WishDraft>) {
    setWishDraft(d => (d ? { ...d, ...changes, dirty: true } : d));
  }

  function patchGoal(changes: Partial<GoalDraft>) {
    setGoalDraft(d => (d ? { ...d, ...changes, dirty: true } : d));
  }

  function addWishMilestone() {
    const text = wishMilestone.trim();
    if (!text || !wishDraft) return;
    patchWish({
      tasks: [...wishDraft.tasks, { id: genId(), title: text, completed: false, createdAt: Date.now() }],
    });
    setWishMilestone('');
  }

  function toggleWishMilestone(taskId: string) {
    if (!wishDraft) return;
    patchWish({
      tasks: wishDraft.tasks.map(t => (t.id === taskId ? { ...t, completed: !t.completed } : t)),
    });
  }

  function removeWishMilestone(taskId: string) {
    if (!wishDraft) return;
    patchWish({ tasks: wishDraft.tasks.filter(t => t.id !== taskId) });
  }

  // ============ 保存 ============

  async function saveWish() {
    if (!wishDraft || saving) return;
    const title = wishDraft.title.trim();
    const vision = wishDraft.vision.trim();
    if (!title || !vision) return;

    const tasks = wishDraft.tasks
      .map(t => ({ ...t, title: t.title.trim() }))
      .filter(t => t.title);

    setSaving(true);
    setSaveError('');
    try {
      let ok = false;
      if (wishDraft.id != null) {
        ok = await updateGoal(wishDraft.id, {
          title,
          vision,
          description: wishDraft.why.trim(),
          targetDate: wishDraft.targetDate || undefined,
          status: wishDraft.status,
          tasks,
        });
      } else {
        const id = await addWish({
          title,
          vision,
          description: wishDraft.why,
          targetDate: wishDraft.targetDate,
          tasks,
        });
        ok = id !== null;
      }
      if (ok) setWishDraft(null);
      else setSaveError('保存失败，内容没有写进存储。请检查存储目录后重试。');
    } finally {
      setSaving(false);
    }
  }

  async function saveGoalDraft() {
    if (!goalDraft || saving) return;
    const title = goalDraft.title.trim();
    if (!title) return;

    const firstStep = goalDraft.firstStep.trim();
    setSaving(true);
    setSaveError('');
    try {
      let ok = false;
      if (goalDraft.id != null) {
        ok = await updateGoal(goalDraft.id, {
          title,
          category: goalDraft.category,
          description: goalDraft.description.trim(),
        });
      } else {
        const id = await addGoal(title, goalDraft.description.trim(), goalDraft.category, firstStep
          ? { nodes: addNode([], null, firstStep) }
          : undefined);
        ok = id !== null;
      }
      if (ok) setGoalDraft(null);
      else setSaveError('保存失败，内容没有写进存储。请检查存储目录后重试。');
    } finally {
      setSaving(false);
    }
  }

  // ============ 树的落盘 ============

  async function saveGoalNodes(goal: LongTermGoal, nodes: GoalNode[]): Promise<boolean> {
    if (goal.id == null) return false;
    const ok = await updateGoal(goal.id, { nodes });
    if (!ok) setConfirm({ message: '保存失败，这次改动没有落盘。请检查存储后重试。', info: true });
    return ok;
  }

  async function handleToggleNode(goal: LongTermGoal, id: string) {
    await saveGoalNodes(goal, toggleNode(effectiveNodes(goal), id));
  }

  async function handleIndent(goal: LongTermGoal, id: string) {
    const nodes = effectiveNodes(goal);
    if (!canIndent(nodes, id)) return;
    setNodeMenuId(null);
    await saveGoalNodes(goal, indentNode(nodes, id));
  }

  async function handleOutdent(goal: LongTermGoal, id: string) {
    const nodes = effectiveNodes(goal);
    if (!canOutdent(nodes, id)) return;
    setNodeMenuId(null);
    await saveGoalNodes(goal, outdentNode(nodes, id));
  }

  function startEditNode(node: GoalNode) {
    cancelNodeEditRef.current = false;
    setEditingNodeId(node.id);
    setNodeDraft(node.title);
    setNodeMenuId(null);
  }

  async function commitNodeTitle(goal: LongTermGoal) {
    if (cancelNodeEditRef.current) {
      cancelNodeEditRef.current = false;
      setEditingNodeId(null);
      return;
    }
    const id = editingNodeId;
    const text = nodeDraft.trim();
    setEditingNodeId(null);
    if (!id || !text) return;
    const nodes = effectiveNodes(goal);
    const node = findNode(nodes, id);
    if (!node || node.title === text) return;
    await saveGoalNodes(goal, updateNodeTitle(nodes, id, text));
  }

  function startAdd(goal: LongTermGoal, parentId: string | null) {
    setAdding({ goalId: goal.id!, parentId });
    setNewNodeTitle('');
    setNodeMenuId(null);
    if (parentId) {
      setCollapsedNodes(prev => {
        if (!prev.has(parentId)) return prev;
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  }

  async function submitAddNode(goal: LongTermGoal, parentId: string | null) {
    const text = newNodeTitle.trim();
    if (!text) return;
    const ok = await saveGoalNodes(goal, addNode(effectiveNodes(goal), parentId, text));
    if (ok) setNewNodeTitle('');
  }

  function askRemoveNode(goal: LongTermGoal, node: GoalNode) {
    setNodeMenuId(null);
    setConfirm({
      message: node.children.length > 0
        ? `删除「${node.title}」以及它下面的全部子项？`
        : `删除「${node.title}」？`,
      confirmText: '删除',
      onConfirm: () => {
        setCollapsedNodes(prev => {
          if (!prev.has(node.id)) return prev;
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
        void saveGoalNodes(goal, removeNode(effectiveNodes(goal), node.id));
      },
    });
  }

  function startWeightEdit(node: GoalNode) {
    setWeightNodeId(node.id);
    setWeightDraft(String(normalizeWeight(node.weight)));
    setWeightError('');
  }

  async function commitWeight(goal: LongTermGoal, node: GoalNode) {
    const raw = weightDraft.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0) {
      setWeightError('请输入大于 0 的数字');
      return;
    }
    const ok = await saveGoalNodes(
      goal,
      setNodeWeight(effectiveNodes(goal), node.id, value === 1 ? undefined : value),
    );
    if (ok) {
      setWeightNodeId(null);
      setWeightError('');
    }
  }

  async function resetWeight(goal: LongTermGoal, node: GoalNode) {
    const ok = await saveGoalNodes(goal, setNodeWeight(effectiveNodes(goal), node.id, undefined));
    if (ok) {
      setWeightNodeId(null);
      setWeightError('');
    }
  }

  function toggleCollapsed(id: string) {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ============ 删除 / 状态 ============

  function askRemoveGoal(goal: LongTermGoal, isWish: boolean) {
    setConfirm({
      message: `删除${isWish ? '大愿望' : '长期目标'}「${goal.title}」？可以在回收站恢复。`,
      confirmText: '删除',
      onConfirm: async () => {
        const ok = await removeGoal(goal.id!);
        if (!ok) setConfirm({ message: '删除失败，目标还在。请检查存储后重试。', info: true });
      },
    });
  }

  async function changeWishStatus(id: number, status: WishStatus) {
    const ok = await setWishStatus(id, status);
    if (!ok) setConfirm({ message: '状态没有保存成功，请检查存储后重试。', info: true });
  }

  async function quickAddMilestone(goalId: number) {
    const text = milestoneDraft.trim();
    if (!text) return;
    const ok = await addTask(goalId, text);
    if (ok) setMilestoneDraft('');
    else setConfirm({ message: '里程碑没有保存成功，请检查存储后重试。', info: true });
  }

  async function quickToggleMilestone(goalId: number, taskId: string) {
    const ok = await toggleTask(goalId, taskId);
    if (!ok) setConfirm({ message: '里程碑状态没有保存成功，请检查存储后重试。', info: true });
  }

  function askRemoveMilestone(wish: LongTermGoal, task: GoalTask) {
    setConfirm({
      message: `删除里程碑「${task.title}」？`,
      confirmText: '删除',
      onConfirm: async () => {
        const ok = await removeTask(wish.id!, task.id);
        if (!ok) setConfirm({ message: '里程碑没有删除成功，请检查存储后重试。', info: true });
      },
    });
  }

  // ============ 返回键 ============

  useRegisterBackHandler(() => {
    if (confirm) { setConfirm(null); return true; }
    if (wishDraft) { requestCloseWish(); return true; }
    if (goalDraft) { requestCloseGoal(); return true; }
    if (editingNodeId) { setEditingNodeId(null); return true; }
    if (weightNodeId) { setWeightNodeId(null); return true; }
    if (nodeMenuId) { setNodeMenuId(null); return true; }
    if (adding) { setAdding(null); return true; }
    return false;
  }, [confirm, wishDraft, goalDraft, editingNodeId, weightNodeId, nodeMenuId, adding]);

  // ============ 渲染：树 ============

  function renderTree(goal: LongTermGoal, nodes: GoalNode[], depth: number) {
    return nodes.map(node => {
      const hasChildren = node.children.length > 0;
      const collapsed = collapsedNodes.has(node.id);
      const menuOpen = nodeMenuId === node.id;
      const percent = percentLabel(nodeProgress(node));
      const addHere = adding !== null && adding.goalId === goal.id && adding.parentId === node.id;

      return (
        <div key={node.id} className="gt-node">
          <div className="gt-row" style={{ paddingLeft: 2 + depth * 16 }}>
            {hasChildren ? (
              <button
                className="gt-caret"
                onClick={() => toggleCollapsed(node.id)}
                aria-label={collapsed ? '展开' : '收起'}
              >
                {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
            ) : (
              <span className="gt-caret gt-caret--empty" aria-hidden="true" />
            )}

            {hasChildren ? (
              <span className="gt-pct">{percent}%</span>
            ) : (
              <button
                className={`gt-check ${node.completed ? 'is-on' : ''}`}
                onClick={() => void handleToggleNode(goal, node.id)}
                aria-label={node.completed ? '取消完成' : '标记完成'}
              >
                {node.completed ? <CheckCircle2 size={17} /> : <Circle size={17} />}
              </button>
            )}

            {editingNodeId === node.id ? (
              <input
                className="gt-title-input"
                autoFocus
                value={nodeDraft}
                onChange={e => setNodeDraft(e.target.value)}
                onBlur={() => void commitNodeTitle(goal)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelNodeEditRef.current = true;
                    setEditingNodeId(null);
                  }
                }}
              />
            ) : (
              <button
                className={`gt-title ${node.completed && !hasChildren ? 'is-done' : ''}`}
                onClick={() => startEditNode(node)}
              >
                {node.title}
              </button>
            )}

            <button
              className={`gt-more ${menuOpen ? 'is-on' : ''}`}
              onClick={() => setNodeMenuId(menuOpen ? null : node.id)}
              aria-label="更多"
            >
              <MoreHorizontal size={15} />
            </button>
          </div>

          {menuOpen && (
            <div className="gt-acts" style={{ marginLeft: 2 + depth * 16 }}>
              <button onClick={() => startAdd(goal, node.id)}><Plus size={12} /> 子项</button>
              <button onClick={() => void handleIndent(goal, node.id)} disabled={!canIndent(nodes, node.id)}>缩进</button>
              <button onClick={() => void handleOutdent(goal, node.id)} disabled={!canOutdent(nodes, node.id)}>缩退</button>
              <button onClick={() => startWeightEdit(node)}><Scale size={12} /> 权重 {normalizeWeight(node.weight)}</button>
              <button className="gt-act--danger" onClick={() => askRemoveNode(goal, node)}><Trash2 size={12} /> 删除</button>
            </div>
          )}

          {weightNodeId === node.id && (
            <div className="gt-weight" style={{ marginLeft: 2 + depth * 16 }}>
              <input
                className="input input-sm"
                type="number"
                min="0.1"
                step="0.1"
                value={weightDraft}
                autoFocus
                onChange={e => { setWeightDraft(e.target.value); setWeightError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); void commitWeight(goal, node); }
                  if (e.key === 'Escape') { e.preventDefault(); setWeightNodeId(null); }
                }}
              />
              <button className="btn btn-primary btn-sm" onClick={() => void commitWeight(goal, node)}>确定</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void resetWeight(goal, node)}>默认</button>
              {weightError && <span className="gt-err">{weightError}</span>}
            </div>
          )}

          {addHere && (
            <div className="gt-add" style={{ marginLeft: 2 + (depth + 1) * 16 }}>
              <input
                className="input input-sm"
                autoFocus
                value={newNodeTitle}
                onChange={e => setNewNodeTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); void submitAddNode(goal, node.id); }
                  if (e.key === 'Escape') { e.preventDefault(); setAdding(null); }
                }}
                placeholder="子项名称"
              />
              <button className="btn btn-primary btn-sm" onClick={() => void submitAddNode(goal, node.id)}>添加</button>
            </div>
          )}

          {hasChildren && !collapsed && renderTree(goal, node.children, depth + 1)}
        </div>
      );
    });
  }

  // ============ 渲染：页面 ============

  if (loading) {
    return (
      <div className="app-container">
        <div className="page-header"><h1 className="page-title">目标与愿望</h1></div>
        <div className="empty-state"><p>加载中...</p></div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="page-header">
        <h1 className="page-title">目标与愿望</h1>
        <span className="goal-head-acts">
          <button className="btn btn-outline btn-sm" onClick={openWishCreate}>
            <Star size={15} /> 大愿望
          </button>
          <button className="btn btn-primary btn-sm" onClick={openGoalCreate}>
            <Plus size={16} /> 目标
          </button>
        </span>
      </div>

      {/* ============ 大愿望 ============ */}
      <section className="wish-section">
        <div className="section-title">
          <Star size={14} /> 大愿望
          <span className="section-count">{wishes.length}</span>
        </div>

        {wishes.length === 0 ? (
          <div className="wish-empty-card">
            <span className="wish-empty-glow" aria-hidden="true" />
            <Sparkles size={18} className="wish-empty-spark" />
            <p className="wish-empty-title">还没有写下一件真正想做到的事</p>
            <p className="wish-empty-sub">先把它好好记住，不必急着完成。</p>
            <button className="wish-empty-btn" onClick={openWishCreate}>
              <Star size={13} /> 写下第一个大愿望
            </button>
          </div>
        ) : wishes.map(wish => {
          const gid = wish.id!;
          const isExpanded = expandedWishId === gid;
          const done = wish.tasks.filter(t => t.completed).length;
          const total = wish.tasks.length;
          const progress = total > 0 ? done / total : 0;
          const left = daysLeft(wish.targetDate);
          const status = wish.status ?? 'active';

          return (
            <div key={gid} className={`wish-card wish-card--${status} ${isExpanded ? 'is-open' : 'is-collapsed'}`}>
              <span className="wish-card-glow" aria-hidden="true" />

              <div className="wish-top" onClick={() => setExpandedWishId(isExpanded ? null : gid)}>
                <div className="wish-title-row">
                  <span className="wish-mark" aria-hidden="true">
                    {status === 'done' ? <CheckCircle2 size={16} /> : <Sparkles size={15} />}
                  </span>
                  <span className="wish-title">{wish.title}</span>
                  <span className={`wish-status wish-status--${status}`}>{STATUS_LABEL[status]}</span>
                  <button
                    className="wish-icon-btn"
                    onClick={e => { e.stopPropagation(); openWishEdit(wish); }}
                    aria-label="编辑大愿望"
                  >
                    <Pencil size={14} />
                  </button>
                  <span className="wish-caret" aria-hidden="true">
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </span>
                </div>

                <div className="wish-meta">
                  <span className="wish-progress-text">
                    {total > 0 ? `${done}/${total} 个里程碑` : '尚未拆解'}
                  </span>
                  {wish.targetDate && (
                    <span className="wish-target">
                      <CalendarDays size={11} /> {formatTarget(wish.targetDate)}
                      {left !== null && status === 'active' && (
                        <>
                          <i className="wish-dot" aria-hidden="true" />
                          <b className={left < 0 ? 'is-over' : left <= 30 ? 'is-near' : ''}>
                            {left < 0 ? `已过 ${-left} 天` : `还有 ${left} 天`}
                          </b>
                        </>
                      )}
                    </span>
                  )}
                </div>

                {isExpanded && (
                  <div className="wish-detail" onClick={e => e.stopPropagation()}>
                    {wish.vision && (
                      <p className="wish-vision">
                        <span className="wish-quote" aria-hidden="true">“</span>
                        {wish.vision}
                        <span className="wish-quote wish-quote--close" aria-hidden="true">”</span>
                      </p>
                    )}

                    {wish.description && (
                      <p className="wish-why"><span>为什么想要</span>{wish.description}</p>
                    )}

                    <div className="wish-memory">
                      {status === 'done' ? <Heart size={11} fill="currentColor" /> : <Feather size={11} />}
                      <span>{MEMORY_LINE[status]}</span>
                    </div>

                    {total > 0 && (
                      <div className="wish-journey">
                        <span className="wish-journey-from" aria-hidden="true" />
                        <div className="goal-progress-bar wish-progress">
                          <div className="goal-progress-fill" style={{ width: `${progress * 100}%` }} />
                        </div>
                        <span className={`wish-journey-to ${progress >= 1 ? 'is-reached' : ''}`} aria-hidden="true" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="wish-detail wish-detail--body">
                  <div className="task-list">
                    {wish.tasks.length === 0 && <p className="wish-empty">还没有拆解。先写一个能走到的里程碑。</p>}
                    {wish.tasks.map(task => (
                      <div key={task.id} className={`task-item ${task.completed ? 'task-item--done' : ''}`}>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => void quickToggleMilestone(gid, task.id)}
                          aria-label={task.completed ? '取消完成' : '标记完成'}
                        >
                          {task.completed ? <CheckCircle2 size={18} color="var(--color-success)" /> : <Circle size={18} />}
                        </button>
                        <span className="task-title">{task.title}</span>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => askRemoveMilestone(wish, task)}
                          aria-label="删除里程碑"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="add-task-row">
                    <input
                      className="input input-sm"
                      value={milestoneDraft}
                      onChange={e => setMilestoneDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void quickAddMilestone(gid); }
                      }}
                      placeholder="添加里程碑..."
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void quickAddMilestone(gid)}
                      aria-label="添加里程碑"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <div className="wish-acts">
                    {status !== 'done' && (
                      <button className="wish-act" onClick={() => void changeWishStatus(gid, 'done')}>已实现</button>
                    )}
                    {status === 'active' && (
                      <button className="wish-act" onClick={() => void changeWishStatus(gid, 'paused')}>暂缓</button>
                    )}
                    {status !== 'active' && (
                      <button className="wish-act" onClick={() => void changeWishStatus(gid, 'active')}>继续</button>
                    )}
                    <button className="wish-act wish-act--danger" onClick={() => askRemoveGoal(wish, true)}>
                      <Trash2 size={13} /> 删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ============ 长期目标 ============ */}
      <section className="goal-section">
        <div className="section-title">
          <Target size={14} /> 长期目标
          <span className="section-count">{plainGoals.length}</span>
        </div>

        {plainGoals.length === 0 ? (
          <p className="wish-empty-hint">把想做到的事拆成能推进的目标。</p>
        ) : plainGoals.map(goal => {
          const gid = goal.id!;
          const isExpanded = expandedGoalId === gid;
          const nodes = effectiveNodes(goal);
          const progress = treeProgress(nodes);
          const percent = percentLabel(progress);
          const stats = treeStats(nodes);
          const addRoot = adding !== null && adding.goalId === gid && adding.parentId === null;

          return (
            <div key={gid} className={`card goal-card ${isExpanded ? 'is-open' : ''}`}>
              <div className="goal-head" onClick={() => setExpandedGoalId(isExpanded ? null : gid)}>
                <div className="goal-info">
                  <div className="goal-title-row">
                    <span className="goal-category-tag">{goal.category}</span>
                    <span className="goal-title">{goal.title}</span>
                  </div>
                  <div className="goal-sub">
                    {percent === null ? '尚未拆解' : `${stats.done}/${stats.total} 项 · ${percent}%`}
                  </div>
                  {percent !== null && (
                    <div className="goal-progress-row">
                      <div className="goal-progress-bar">
                        <div className="goal-progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="goal-expand">
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={e => { e.stopPropagation(); openGoalEdit(goal); }}
                    aria-label="编辑长期目标"
                  >
                    <Pencil size={15} />
                  </button>
                  <span className="goal-caret" aria-hidden="true">
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </span>
                </div>
              </div>

              {isExpanded && (
                <div className="goal-tree">
                  {goal.description && <p className="goal-desc">{goal.description}</p>}

                  {nodes.length === 0 ? (
                    <p className="wish-empty">还没有拆解。先写第一步，之后可以继续加子项。</p>
                  ) : (
                    <div className="gt-list">{renderTree(goal, nodes, 0)}</div>
                  )}

                  {addRoot ? (
                    <div className="gt-add gt-add--root">
                      <input
                        className="input input-sm"
                        autoFocus
                        value={newNodeTitle}
                        onChange={e => setNewNodeTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); void submitAddNode(goal, null); }
                          if (e.key === 'Escape') { e.preventDefault(); setAdding(null); }
                        }}
                        placeholder="第一步，或下一个节点"
                      />
                      <button className="btn btn-primary btn-sm" onClick={() => void submitAddNode(goal, null)}>添加</button>
                    </div>
                  ) : (
                    <button className="gt-root-add" onClick={() => startAdd(goal, null)}>
                      <Plus size={14} /> 添加一步
                    </button>
                  )}

                  <div className="goal-acts">
                    <button className="wish-act wish-act--danger" onClick={() => askRemoveGoal(goal, false)}>
                      <Trash2 size={13} /> 删除目标
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ============ 大愿望编辑器 ============ */}
      {wishDraft && (
        <div className="modal-overlay" onClick={requestCloseWish}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3 className="modal-title">{wishDraft.id != null ? '编辑大愿望' : '新增大愿望'}</h3>
              <button className="modal-x" onClick={requestCloseWish} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            <div className="form-group">
              <label className="label">名称</label>
              <input
                className="input"
                value={wishDraft.title}
                onChange={e => patchWish({ title: e.target.value })}
                placeholder="想做到的事"
              />
            </div>

            <div className="form-group">
              <label className="label">愿景</label>
              <textarea
                className="input textarea"
                value={wishDraft.vision}
                onChange={e => patchWish({ vision: e.target.value })}
                placeholder="做到的那天，是什么样子？"
                rows={2}
              />
            </div>

            <div className="form-group">
              <label className="label">为什么想要（可选）</label>
              <textarea
                className="input textarea"
                value={wishDraft.why}
                onChange={e => patchWish({ why: e.target.value })}
                placeholder="这件事对你意味着什么"
                rows={2}
              />
            </div>

            <div className="form-group">
              <label className="label">期望完成（可选）</label>
              <input
                className="input"
                type="date"
                value={wishDraft.targetDate}
                onChange={e => patchWish({ targetDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="label">里程碑</label>
              <div className="wd-milestones">
                {wishDraft.tasks.length === 0 && (
                  <p className="wd-hint">写愿望的时候就能顺手拆几步，不用等保存后再回来加。</p>
                )}
                {wishDraft.tasks.map(task => (
                  <div className="wd-ms" key={task.id}>
                    <button
                      className={`gt-check ${task.completed ? 'is-on' : ''}`}
                      onClick={() => toggleWishMilestone(task.id)}
                      aria-label={task.completed ? '取消完成' : '标记完成'}
                    >
                      {task.completed ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                    </button>
                    <input
                      className="input input-sm"
                      value={task.title}
                      onChange={e => patchWish({
                        tasks: wishDraft.tasks.map(t => (t.id === task.id ? { ...t, title: e.target.value } : t)),
                      })}
                    />
                    <button className="wd-ms-del" onClick={() => removeWishMilestone(task.id)} aria-label="删除里程碑">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="wd-ms-add">
                <input
                  className="input input-sm"
                  value={wishMilestone}
                  onChange={e => setWishMilestone(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addWishMilestone(); }
                  }}
                  placeholder="加一个里程碑"
                />
                <button className="btn btn-primary btn-sm" onClick={addWishMilestone}>添加</button>
              </div>
            </div>

            {saveError && <p className="form-error">{saveError}</p>}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={requestCloseWish}>取消</button>
              <button
                className="btn btn-primary"
                onClick={() => void saveWish()}
                disabled={saving || !wishDraft.title.trim() || !wishDraft.vision.trim()}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ 长期目标编辑器 ============ */}
      {goalDraft && (
        <div className="modal-overlay" onClick={requestCloseGoal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3 className="modal-title">{goalDraft.id != null ? '编辑长期目标' : '新建长期目标'}</h3>
              <button className="modal-x" onClick={requestCloseGoal} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            <div className="form-group">
              <label className="label">目标名称</label>
              <input
                className="input"
                value={goalDraft.title}
                onChange={e => patchGoal({ title: e.target.value })}
                placeholder="目标名称"
              />
            </div>

            <div className="form-group">
              <label className="label">分类</label>
              <select
                className="input select"
                value={goalDraft.category}
                onChange={e => patchGoal({ category: e.target.value })}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">描述（可选）</label>
              <textarea
                className="input textarea"
                value={goalDraft.description}
                onChange={e => patchGoal({ description: e.target.value })}
                placeholder="这个目标为什么要做，做到什么程度算完成"
                rows={2}
              />
            </div>

            {goalDraft.id == null && (
              <div className="form-group">
                <label className="label">第一步（可选）</label>
                <input
                  className="input"
                  value={goalDraft.firstStep}
                  onChange={e => patchGoal({ firstStep: e.target.value })}
                  placeholder="先写一个现在就能开始的动作"
                />
              </div>
            )}

            {saveError && <p className="form-error">{saveError}</p>}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={requestCloseGoal}>取消</button>
              <button
                className="btn btn-primary"
                onClick={() => void saveGoalDraft()}
                disabled={saving || !goalDraft.title.trim()}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        message={confirm?.message ?? ''}
        confirmText={confirm?.confirmText}
        onConfirm={confirm?.info ? undefined : () => {
          const action = confirm?.onConfirm;
          setConfirm(null);
          action?.();
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
