import { useState } from 'react';
import { Plus, Target, ChevronDown, ChevronUp, Trash2, CheckCircle2, Circle, Clock } from 'lucide-react';
import { useGoals } from '../hooks/useGoals';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import './LongTermGoals.css';

const CATEGORIES = ['学业', '技能', '健康', '习惯', '其他'];

export default function LongTermGoalsPage() {
  const { goals, loading, addGoal, updateGoal, removeGoal, addTask, toggleTask, removeTask } = useGoals();
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('学业');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // 作息模板管理（内置在此页）
  const [showRoutineForm, setShowRoutineForm] = useState(false);

  // 返回键：关闭弹窗
  useRegisterBackHandler(() => {
    if (showForm) {
      setShowForm(false);
      return true;
    }
    if (showRoutineForm) {
      setShowRoutineForm(false);
      return true;
    }
    return false;
  }, [showForm, showRoutineForm]);

  const handleCreateGoal = async () => {
    if (!newTitle.trim()) return;
    await addGoal(newTitle.trim(), newDesc.trim(), newCategory);
    setNewTitle('');
    setNewDesc('');
    setShowForm(false);
  };

  const handleAddTask = async (goalId: number) => {
    if (!newTaskTitle.trim()) return;
    await addTask(goalId, newTaskTitle.trim());
    setNewTaskTitle('');
  };

  if (loading) {
    return (
      <div className="app-container">
        <div className="page-header"><h1 className="page-title">长期目标</h1></div>
        <div className="empty-state"><p>加载中...</p></div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="page-header">
        <h1 className="page-title">长期目标</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
          <Plus size={16} /> 新建目标
        </button>
      </div>

      {/* 新建目标弹窗 */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">新建长期目标</h3>
            <div className="form-group">
              <label className="label">目标名称</label>
              <input className="input" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="例如：提高英语作文分数" />
            </div>
            <div className="form-group">
              <label className="label">分类</label>
              <select className="input select" value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">描述</label>
              <textarea className="input textarea" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="补充说明..." rows={2} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreateGoal}>创建</button>
            </div>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="empty-state">
          <Target size={48} className="icon" />
          <p>还没有长期目标</p>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
            从需求倒推方案：大目标 → 拆解任务 → 填充到每日计划
          </p>
        </div>
      ) : (
        goals.map(goal => {
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

              {isExpanded && (
                <div className="goal-detail">
                  {goal.description && <p className="goal-desc">{goal.description}</p>}

                  {/* 任务列表 */}
                  <div className="task-list">
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

                  {/* 添加任务 */}
                  <div className="add-task-row">
                    <input
                      className="input input-sm"
                      value={newTaskTitle}
                      onChange={e => setNewTaskTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddTask(gid); }}
                      placeholder="添加子任务..."
                    />
                    <button className="btn btn-primary btn-sm" onClick={() => handleAddTask(gid)}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
