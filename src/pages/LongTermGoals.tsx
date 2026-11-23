import { useState } from 'react';
import { Plus, Target, ChevronDown } from 'lucide-react';
import { useGoals } from '../hooks/useGoals';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from '../components/ConfirmDialog';
import GoalPlanEditor from '../components/GoalPlanEditor';
import GoalMap from '../components/GoalMap';
import GroupedPageHeader from '../components/GroupedPageHeader';
import type { GoalNode, LongTermGoal } from '../types';
import { effectiveNodes, percentLabel, toggleNode, treeProgress, treeStats } from '../utils/goalTree';
import './LongTermGoals.css';

export default function LongTermGoalsPage() {
  const { goals, loading, addGoal, updateGoal, removeGoal } = useGoals();
  const [goalEditor, setGoalEditor] = useState<{ id: number | null } | null>(null);
  const [goalMapId, setGoalMapId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; info?: boolean; onConfirm?: () => void } | null>(null);
  const plainGoals = goals.filter(g => g.kind !== 'wish');
  const mappedGoal = plainGoals.find(goal => goal.id === goalMapId);
  const editingGoal = plainGoals.find(goal => goal.id === goalEditor?.id);
  async function saveGoalPlan(input: { title: string; description: string; nodes: GoalNode[] }): Promise<boolean> {
    if (!goalEditor) return false;
    const { id } = goalEditor;
    const ok = id === null
      ? await addGoal(input.title, input.description, '其他', { nodes: input.nodes }) !== null
      : await updateGoal(id, input);
    if (ok) setGoalEditor(null);
    return ok;
  }

  async function toggleGoalLeaf(goal: LongTermGoal, leafId: string): Promise<boolean> {
    if (goal.id == null) return false;
    return updateGoal(goal.id, { nodes: toggleNode(effectiveNodes(goal), leafId) });
  }
  function askRemoveGoal(goal: LongTermGoal) {
    setConfirm({ message: `删除长期目标「${goal.title}」？可以在回收站恢复。`, onConfirm: async () => {
      const ok = await removeGoal(goal.id!);
      if (!ok) setConfirm({ message: '删除失败，目标还在。请检查存储后重试。', info: true });
      else setGoalMapId(null);
    } });
  }
  useRegisterBackHandler(() => {
    if (confirm) { setConfirm(null); return true; }
    if (goalMapId !== null && goalEditor === null) { setGoalMapId(null); return true; }
    return false;
  }, [confirm, goalMapId, goalEditor]);
  if (loading) return <div className="app-container"><GroupedPageHeader title="目标" /><p>加载中...</p></div>;
  return <div className="app-container">
    <GroupedPageHeader title="目标" blocked={!!confirm || !!mappedGoal || goalEditor !== null}>
      <button className="btn btn-primary btn-sm" onClick={() => setGoalEditor({ id: null })}><Plus size={16} /> 目标</button>
    </GroupedPageHeader>
      <section className="goal-section">
        <div className="section-title">
          <Target size={14} /> 长期目标
          <span className="section-count">{plainGoals.length}</span>
        </div>

        {plainGoals.length === 0 ? (
          <p className="wish-empty-hint">把想做到的事拆成能推进的目标。</p>
        ) : plainGoals.map(goal => {
          const nodes = effectiveNodes(goal);
          const percent = percentLabel(treeProgress(nodes));
          const stats = treeStats(nodes);

          return (
            <div key={goal.id} className="card goal-card">
              <button className="goal-head" type="button" onClick={() => setGoalMapId(goal.id!)} style={{ width: '100%', padding: 0, border: 0, background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left' }}>
                <span className="goal-info">
                  <span className="goal-title-row"><span className="goal-title">{goal.title}</span></span>
                  <span className="goal-sub">
                    {percent === null ? '尚未拆解' : `${stats.done}/${stats.total} 项 · ${percent}%`}
                  </span>
                  {percent !== null && (
                    <span className="goal-progress-row">
                      <span className="goal-progress-bar">
                        <span className="goal-progress-fill" style={{ width: `${percent}%` }} />
                      </span>
                    </span>
                  )}
                </span>
                <span className="goal-caret" aria-hidden="true"><ChevronDown size={18} /></span>
              </button>
            </div>
          );
        })}
      </section>
      {mappedGoal && goalEditor === null && (
        <GoalMap
          goal={mappedGoal}
          onToggleLeaf={id => toggleGoalLeaf(mappedGoal, id)}
          onEdit={() => setGoalEditor({ id: mappedGoal.id! })}
          onDelete={() => askRemoveGoal(mappedGoal)}
          onClose={() => setGoalMapId(null)}
        />
      )}
      {goalEditor !== null && (goalEditor.id === null || editingGoal) && (
        <GoalPlanEditor
          key={goalEditor.id ?? 'new'}
          goal={goalEditor.id === null ? null : editingGoal!}
          onSave={saveGoalPlan}
          onClose={() => setGoalEditor(null)}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        message={confirm?.message ?? ''}
        confirmText="删除"
        onConfirm={confirm?.info ? undefined : () => {
          const action = confirm?.onConfirm;
          setConfirm(null);
          action?.();
        }}
        onCancel={() => setConfirm(null)}
      />
  </div>;
}
