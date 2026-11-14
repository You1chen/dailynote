import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, X, Save, Trash2, Edit3, CheckCircle2, Circle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import DayNavigator from '../components/DayNavigator';
import KnowledgeCardCollector from '../components/KnowledgeCardCollector';
import { useReflections } from '../hooks/useReflections';
import { getAllReflections } from '../db';
import { useDailyPlan } from '../hooks/useDailyPlan';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { PERIODS, type Period, todayStr } from '../types';
import type { Reflection } from '../types';
import './Reflection.css';

export default function ReflectionPage() {
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(searchParams.get('date') || todayStr());

  useEffect(() => {
    const d = searchParams.get('date');
    if (d) setDate(d);
  }, [searchParams]);
  const { reflections, loading, addOrUpdate, remove } = useReflections(date);
  const { plan } = useDailyPlan(date);
  const [activePeriod, setActivePeriod] = useState<Period>('morning');
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [allReflections, setAllReflections] = useState<Reflection[]>([]);
  const refreshAll = useCallback(async () => { setAllReflections(await getAllReflections()); }, []);
  useEffect(() => { void refreshAll(); }, [refreshAll]);
  const reflectionMarks = useMemo(() => {
    const marks: Record<string, number> = {};
    for (const item of allReflections) marks[item.date] = (marks[item.date] ?? 0) + 1;
    return marks;
  }, [allReflections]);

  // 当前时段的反思列表
  const periodReflections = reflections
    .filter(r => r.period === activePeriod)
    .sort((a, b) => b.createdAt - a.createdAt);

  // 全屏编辑器状态
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editProblem, setEditProblem] = useState('');
  const [editCause, setEditCause] = useState('');
  const [editSolution, setEditSolution] = useState('');
  const [editTask, setEditTask] = useState('');

  // 返回键：关闭全屏编辑器
  useRegisterBackHandler(() => {
    if (collectorOpen) {
      setCollectorOpen(false);
      return true;
    }
    if (editorOpen) {
      setEditorOpen(false);
      return true;
    }
    return false;
  }, [editorOpen, collectorOpen]);

  const openNew = useCallback(() => {
    setEditingId(null);
    setEditProblem('');
    setEditCause('');
    setEditSolution('');
    setEditTask('');
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((r: Reflection) => {
    setEditingId(r.id ?? null);
    setEditProblem(r.problem);
    setEditCause(r.cause);
    setEditSolution(r.solution);
    setEditTask(r.relatedTaskTitle);
    setEditorOpen(true);
  }, []);

  const handleSave = async () => {
    if (!editProblem.trim() && !editCause.trim() && !editSolution.trim()) return;
    const r: Reflection = {
      date,
      period: activePeriod,
      problem: editProblem.trim(),
      cause: editCause.trim(),
      solution: editSolution.trim(),
      relatedTaskTitle: editTask.trim(),
      resolved: false,
      createdAt: Date.now(),
    };
    if (editingId) {
      r.id = editingId;
      const existing = reflections.find(x => x.id === editingId);
      if (existing) r.resolved = existing.resolved;
    }
    await addOrUpdate(r);
    await refreshAll();
    setEditorOpen(false);
  };

  const handleDelete = async () => {
    if (editingId) {
      await remove(editingId);
      await refreshAll();
      setEditorOpen(false);
    }
  };

  const toggleResolved = async (r: Reflection) => {
    await addOrUpdate({ ...r, resolved: !r.resolved });
    await refreshAll();
  };

  // 当天所有有执行记录的任务列表（供关联）
  const taskOptions = (plan?.timeBlocks ?? [])
    .filter(b => b.taskTitle || b.actualExecution)
    .map(b => b.taskTitle)
    .filter(Boolean);

  return (
    <div className="app-container">
      <DayNavigator date={date} onDateChange={setDate} marks={reflectionMarks} markTone="green" />

      {/* 时段切换 */}
      <div className="period-tabs">
        {PERIODS.map(p => {
          const count = reflections.filter(r => r.period === p.value).length;
          return (
            <button
              key={p.value}
              className={`period-tab ${activePeriod === p.value ? 'period-tab--active' : ''}`}
              onClick={() => setActivePeriod(p.value)}
            >
              {p.label}
              {count > 0 && <span className="period-badge">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* 添加按钮 */}
      <div className="reflection-actions">
        <button className="btn btn-primary reflection-add-btn" onClick={openNew}>
          <Edit3 size={18} /> 添加{PERIODS.find(p => p.value === activePeriod)?.label}反思
        </button>
        <button className="btn btn-outline reflection-collector-btn" onClick={() => setCollectorOpen(true)}>
          卡片收集器
        </button>
      </div>

      {/* 反思条目列表 */}
      {loading ? (
        <div className="empty-state"><p>加载中...</p></div>
      ) : periodReflections.length === 0 ? (
        <div className="empty-state">
          <p>该时段还没有反思</p>
        </div>
      ) : (
        <div className="reflection-list">
          {periodReflections.map((r, idx) => (
            <div key={r.id} className={`reflection-card animate-in ${r.resolved ? 'reflection-card--resolved' : ''}`} style={{ animationDelay: `${idx * 40}ms` }}>
              <div className="reflection-card-body" onClick={() => openEdit(r)}>
                {/* 问题块 */}
                <div className="ref-block ref-block--problem">
                  <span className="ref-block-label">🔍 问题</span>
                  <p className="ref-block-text">{r.problem || '未填写'}</p>
                </div>

                {/* 原因块 */}
                {r.cause && (
                  <div className="ref-block ref-block--cause">
                    <span className="ref-block-label">🤔 原因</span>
                    <p className="ref-block-text">{r.cause}</p>
                  </div>
                )}

                {/* 改进块 */}
                {r.solution && (
                  <div className="ref-block ref-block--solution">
                    <span className="ref-block-label">💡 改进方案</span>
                    <p className="ref-block-text">{r.solution}</p>
                  </div>
                )}

                {/* 关联任务 */}
                {r.relatedTaskTitle && (
                  <span className="ref-task-tag">📋 {r.relatedTaskTitle}</span>
                )}
              </div>

              <div className="reflection-card-actions">
                <button
                  className={`btn btn-sm ${r.resolved ? 'btn-outline' : 'btn-ghost'}`}
                  onClick={(e) => { e.stopPropagation(); toggleResolved(r); }}
                >
                  {r.resolved ? <><CheckCircle2 size={14} /> 已解决</> : <><Circle size={14} /> 未解决</>}
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={(e) => { e.stopPropagation(); r.id && remove(r.id); }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {collectorOpen && <KnowledgeCardCollector onClose={() => setCollectorOpen(false)} />}

      {/* 全屏编辑器 */}
      {editorOpen && (
        <div className="fs-overlay" onClick={() => setEditorOpen(false)}>
          <div className="fs-editor" onClick={e => e.stopPropagation()}>
            <div className="fs-header">
              <button className="btn btn-ghost btn-icon" onClick={() => setEditorOpen(false)}>
                <X size={22} />
              </button>
              <span className="fs-header-title">{editingId ? '编辑反思' : '新建反思'}</span>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>
                <Save size={16} /> 保存
              </button>
            </div>

            <div className="ref-editor-body">
              {/* 问题 */}
              <div className="ref-editor-section">
                <label className="ref-editor-label">🔍 问题</label>
                <textarea
                  className="input textarea ref-editor-textarea"
                  value={editProblem}
                  onChange={e => setEditProblem(e.target.value)}
                  placeholder="遇到的问题"
                  rows={3}
                  autoFocus
                />
              </div>

              {/* 原因 */}
              <div className="ref-editor-section">
                <label className="ref-editor-label">🤔 原因</label>
                <textarea
                  className="input textarea ref-editor-textarea"
                  value={editCause}
                  onChange={e => setEditCause(e.target.value)}
                  placeholder="根本原因"
                  rows={3}
                />
              </div>

              {/* 改进 */}
              <div className="ref-editor-section">
                <label className="ref-editor-label">💡 改进方案</label>
                <textarea
                  className="input textarea ref-editor-textarea"
                  value={editSolution}
                  onChange={e => setEditSolution(e.target.value)}
                  placeholder="改进方案"
                  rows={3}
                />
              </div>

              {/* 关联任务 */}
              <div className="ref-editor-section">
                <label className="ref-editor-label">关联任务</label>
                {taskOptions.length > 0 ? (
                  <select className="input select" value={editTask} onChange={e => setEditTask(e.target.value)}>
                    <option value="">不关联</option>
                    {taskOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <input className="input" value={editTask} onChange={e => setEditTask(e.target.value)} placeholder="输入关联任务" />
                )}
              </div>
            </div>

            {/* 底部删除 */}
            {editingId && (
              <div className="ref-editor-footer">
                <button className="btn btn-danger" onClick={handleDelete}>
                  <Trash2 size={16} /> 删除此反思
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
