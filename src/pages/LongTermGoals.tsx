import { useMemo, useState } from 'react';
import {
  Plus, Target, ChevronDown, ChevronUp, Trash2, CheckCircle2, Circle,
  Star, CalendarDays, Sparkles, Heart, Feather,
} from 'lucide-react';
import { useGoals } from '../hooks/useGoals';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import type { LongTermGoal, WishStatus } from '../types';
import './LongTermGoals.css';

const CATEGORIES = ['学业', '技能', '健康', '习惯', '其他'];

const STATUS_LABEL: Record<WishStatus, string> = {
  active: '进行中',
  done: '已实现',
  paused: '暂缓',
};

/** 卡片上写给未来的那句轻声提示，跟状态走，不落库 */
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

export default function LongTermGoalsPage() {
  const { goals, loading, addGoal, addWish, setWishStatus, removeGoal, addTask, toggleTask, removeTask } = useGoals();

  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('学业');

  // 大愿望表单：名称 + 愿景为必填，其余可选
  const [showWishForm, setShowWishForm] = useState(false);
  const [wishTitle, setWishTitle] = useState('');
  const [wishVision, setWishVision] = useState('');
  const [wishWhy, setWishWhy] = useState('');
  const [wishTarget, setWishTarget] = useState('');

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const wishes = useMemo(() => goals.filter(g => g.kind === 'wish'), [goals]);
  const plainGoals = useMemo(() => goals.filter(g => g.kind !== 'wish'), [goals]);

  useRegisterBackHandler(() => {
    if (showForm) { setShowForm(false); return true; }
    if (showWishForm) { setShowWishForm(false); return true; }
    return false;
  }, [showForm, showWishForm]);

  const handleCreateGoal = async () => {
    if (!newTitle.trim()) return;
    await addGoal(newTitle.trim(), newDesc.trim(), newCategory);
    setNewTitle('');
    setNewDesc('');
    setShowForm(false);
  };

  const handleCreateWish = async () => {
    if (!wishTitle.trim() || !wishVision.trim()) return;
    await addWish({
      title: wishTitle,
      vision: wishVision,
      description: wishWhy,
      targetDate: wishTarget,
    });
    setWishTitle('');
    setWishVision('');
    setWishWhy('');
    setWishTarget('');
    setShowWishForm(false);
  };

  const handleAddTask = async (goalId: number) => {
    if (!newTaskTitle.trim()) return;
    await addTask(goalId, newTaskTitle.trim());
    setNewTaskTitle('');
  };

  /** 展开后的子任务区：大愿望叫「里程碑」 */
  function renderTasks(goal: LongTermGoal, label: string) {
    const gid = goal.id!;
    return (
      <div className="goal-detail">
        {goal.kind === 'wish' && goal.description && (
          <p className="wish-why"><span>为什么想要</span>{goal.description}</p>
        )}
        {goal.kind !== 'wish' && goal.description && <p className="goal-desc">{goal.description}</p>}

        <div className="task-list">
          {goal.tasks.length === 0 && <p className="wish-empty">{label}还没拆</p>}
          {goal.tasks.map(task => (
            <div key={task.id} className={`task-item ${task.completed ? 'task-item--done' : ''}`}>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleTask(gid, task.id)}>
                {task.completed ? <CheckCircle2 size={18} color="var(--color-success)" /> : <Circle size={18} />}
              </button>
              <span className="task-title">{task.title}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeTask(gid, task.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="add-task-row">
          <input
            className="input input-sm"
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddTask(gid); }}
            placeholder={`添加${label}...`}
          />
          <button className="btn btn-primary btn-sm" onClick={() => handleAddTask(gid)}>
            <Plus size={14} />
          </button>
        </div>
      </div>
    );
  }

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
          <button className="btn btn-outline btn-sm" onClick={() => setShowWishForm(true)}>
            <Star size={15} /> 大愿望
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            <Plus size={16} /> 目标
          </button>
        </span>
      </div>

      {/* 大愿望 */}
      <section className="wish-section">
        <div className="section-title">
          <Star size={14} /> 大愿望
          <span className="section-count">{wishes.length}</span>
        </div>

        {wishes.length === 0 ? (
          <p className="wish-empty-hint">写下一件真正想做到的事，它值得比待办更认真。</p>
        ) : wishes.map(wish => {
          const gid = wish.id!;
          const isExpanded = expandedId === gid;
          const done = wish.tasks.filter(t => t.completed).length;
          const progress = wish.tasks.length > 0 ? done / wish.tasks.length : 0;
          const left = daysLeft(wish.targetDate);
          const status = wish.status ?? 'active';

          return (
            <div key={gid} className={`wish-card wish-card--${status}`}>
              <span className="wish-card-glow" aria-hidden="true" />
              <div className="wish-top" onClick={() => setExpandedId(isExpanded ? null : gid)}>
                <div className="wish-title-row">
                  <span className="wish-mark" aria-hidden="true">
                    {status === 'done' ? <CheckCircle2 size={16} /> : <Sparkles size={15} />}
                  </span>
                  <span className="wish-title">{wish.title}</span>
                  <span className={`wish-status wish-status--${status}`}>{STATUS_LABEL[status]}</span>
                </div>

                {wish.vision && (
                  <p className="wish-vision">
                    <span className="wish-quote" aria-hidden="true">“</span>
                    {wish.vision}
                    <span className="wish-quote wish-quote--close" aria-hidden="true">”</span>
                  </p>
                )}

                <div className="wish-memory">
                  {status === 'done' ? <Heart size={11} fill="currentColor" /> : <Feather size={11} />}
                  <span>{MEMORY_LINE[status]}</span>
                </div>

                <div className="wish-meta">
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
                  {wish.tasks.length > 0 && (
                    <span className="wish-progress-text">{done}/{wish.tasks.length} 个里程碑</span>
                  )}
                </div>

                {wish.tasks.length > 0 && (
                  <div className="wish-journey">
                    <span className="wish-journey-from" aria-hidden="true" />
                    <div className="goal-progress-bar wish-progress">
                      <div className="goal-progress-fill" style={{ width: `${progress * 100}%` }} />
                    </div>
                    <span className={`wish-journey-to ${progress >= 1 ? 'is-reached' : ''}`} aria-hidden="true" />
                  </div>
                )}
              </div>

              <div className="wish-acts">
                {status !== 'done' && (
                  <button className="wish-act" onClick={() => setWishStatus(gid, 'done')}>已实现</button>
                )}
                {status === 'active' && (
                  <button className="wish-act" onClick={() => setWishStatus(gid, 'paused')}>暂缓</button>
                )}
                {status !== 'active' && (
                  <button className="wish-act" onClick={() => setWishStatus(gid, 'active')}>继续</button>
                )}
                <button className="wish-act wish-act--danger" onClick={() => removeGoal(gid)}>
                  <Trash2 size={13} />
                </button>
                <button className="wish-act wish-act--toggle" onClick={() => setExpandedId(isExpanded ? null : gid)}>
                  {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </div>

              {isExpanded && renderTasks(wish, '里程碑')}
            </div>
          );
        })}
      </section>

      {/* 长期目标 */}
      <section className="goal-section">
        <div className="section-title">
          <Target size={14} /> 长期目标
          <span className="section-count">{plainGoals.length}</span>
        </div>

        {plainGoals.length === 0 ? (
          <p className="wish-empty-hint">把大愿望拆成能推进的目标。</p>
        ) : plainGoals.map(goal => {
          const gid = goal.id!;
          const isExpanded = expandedId === gid;
          const completedTasks = goal.tasks.filter(t => t.completed).length;
          const progress = goal.tasks.length > 0 ? completedTasks / goal.tasks.length : 0;

          return (
            <div key={gid} className="card goal-card animate-in">
              <div className="card-header" onClick={() => setExpandedId(isExpanded ? null : gid)}>
                <div className="goal-info">
                  <div className="goal-title-row">
                    <span className="goal-category-tag">{goal.category}</span>
                    <span className="goal-title">{goal.title}</span>
                  </div>
                  {goal.tasks.length > 0 && (
                    <div className="goal-progress-row">
                      <div className="goal-progress-bar">
                        <div className="goal-progress-fill" style={{ width: `${progress * 100}%` }} />
                      </div>
                      <span className="goal-progress-text">{completedTasks}/{goal.tasks.length}</span>
                    </div>
                  )}
                </div>
                <div className="goal-expand">
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={e => { e.stopPropagation(); removeGoal(gid); }}>
                    <Trash2 size={16} />
                  </button>
                  {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
              </div>
              {isExpanded && renderTasks(goal, '任务')}
            </div>
          );
        })}
      </section>

      {/* 新增大愿望 */}
      {showWishForm && (
        <div className="modal-overlay" onClick={() => setShowWishForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">新增大愿望</h3>
            <div className="form-group">
              <label className="label">名称</label>
              <input className="input" value={wishTitle} onChange={e => setWishTitle(e.target.value)} placeholder="想做到的事" />
            </div>
            <div className="form-group">
              <label className="label">愿景</label>
              <textarea
                className="input textarea"
                value={wishVision}
                onChange={e => setWishVision(e.target.value)}
                placeholder="做到的那天，是什么样子？"
                rows={2}
              />
            </div>
            <div className="form-group">
              <label className="label">为什么想要（可选）</label>
              <textarea className="input textarea" value={wishWhy} onChange={e => setWishWhy(e.target.value)} placeholder="这件事对你意味着什么" rows={2} />
            </div>
            <div className="form-group">
              <label className="label">期望完成（可选）</label>
              <input className="input" type="date" value={wishTarget} onChange={e => setWishTarget(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowWishForm(false)}>取消</button>
              <button
                className="btn btn-primary"
                onClick={handleCreateWish}
                disabled={!wishTitle.trim() || !wishVision.trim()}
              >创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 新建长期目标 */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">新建长期目标</h3>
            <div className="form-group">
              <label className="label">目标名称</label>
              <input className="input" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="目标名称" />
            </div>
            <div className="form-group">
              <label className="label">分类</label>
              <select className="input select" value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">描述</label>
              <textarea className="input textarea" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="描述" rows={2} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreateGoal}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
