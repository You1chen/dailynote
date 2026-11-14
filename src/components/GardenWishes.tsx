import { useMemo, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Trash2, CheckCircle2, Circle, Star, CalendarDays, Sparkles, Heart, Feather, Pencil, X } from 'lucide-react';
import { useGoals } from '../hooks/useGoals';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';
import type { GoalTask, LongTermGoal, WishStatus } from '../types';
import { genId } from '../types';
import '../pages/LongTermGoals.css';

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

export default function GardenWishes() {
  const { goals, loading, addWish, setWishStatus, updateGoal, removeGoal, addTask, toggleTask, removeTask } = useGoals();
  const [wishDraft, setWishDraft] = useState<WishDraft | null>(null);
  const [wishMilestone, setWishMilestone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [expandedWishId, setExpandedWishId] = useState<number | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState('');
  const wishes = useMemo(() => goals.filter(g => g.kind === 'wish' && g.gardenEntry !== 'confession'), [goals]);
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
  // ---- 草稿更新（统一标记 dirty） ----

  function patchWish(changes: Partial<WishDraft>) {
    setWishDraft(d => (d ? { ...d, ...changes, dirty: true } : d));
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
  function askRemoveGoal(wish: LongTermGoal) {
    setConfirm({ message: `收起愿望「${wish.title}」？可在花园设置中恢复。`, confirmText: '收起', onConfirm: async () => {
      try { if (!(await removeGoal(wish.id!))) setConfirm({ message: '未能保存，请重试。', info: true }); }
      catch { setConfirm({ message: '未能保存，请重试。', info: true }); }
    } });
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
  useRegisterBackHandler(() => {
    if (confirm) { setConfirm(null); return true; }
    if (wishDraft) { requestCloseWish(); return true; }
    return false;
  }, [confirm, wishDraft, wishMilestone]);
  if (loading) return <p className="garden-loading" role="status">正在翻开愿望…</p>;
  return <div className="garden-wishes">
    <button className="garden-wish-add" onClick={openWishCreate}><Plus size={15} /> 写下愿望</button>
      <section className="wish-section">
        <div className="section-title">
          <Star size={14} /> 愿望
          <span className="section-count">{wishes.length}</span>
        </div>

        {wishes.length === 0 ? (
          <div className="wish-empty-card">
            <span className="wish-empty-glow" aria-hidden="true" />
            <Sparkles size={18} className="wish-empty-spark" />
            <p className="wish-empty-title">还没有写下一件真正想做到的事</p>
            <p className="wish-empty-sub">先把它好好记住，不必急着完成。</p>
            <button className="wish-empty-btn" onClick={openWishCreate}>
              <Star size={13} /> 写下第一个愿望
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
                    aria-label="编辑愿望"
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
                    <button className="wish-act wish-act--danger" onClick={() => askRemoveGoal(wish)}>
                      <Trash2 size={13} /> 删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
      {/* ============ 愿望编辑器 ============ */}
      {wishDraft && (
        <div className="modal-overlay" onClick={requestCloseWish}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3 className="modal-title">{wishDraft.id != null ? '编辑愿望' : '新增愿望'}</h3>
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
              <label className="label">为什么想要</label>
              <textarea
                className="input textarea"
                value={wishDraft.why}
                onChange={e => patchWish({ why: e.target.value })}
                placeholder="这件事对你意味着什么"
                rows={2}
              />
            </div>

            <div className="form-group">
              <label className="label">期望完成</label>
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
  </div>;
}
