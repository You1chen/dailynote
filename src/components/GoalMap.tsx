import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Pencil, Trash2, X } from 'lucide-react';
import type { GoalNode, LongTermGoal } from '../types';
import { effectiveNodes, nodeProgress, percentLabel, treeProgress } from '../utils/goalTree';
import './GoalPlanEditor.css';
import PlanMindmap from './PlanMindmap';

export interface GoalMapProps {
  goal: LongTermGoal;
  onToggleLeaf: (id: string) => Promise<boolean>;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function findPath(nodes: GoalNode[], id: string, chain: GoalNode[] = []): GoalNode[] | null {
  for (const node of nodes) {
    const path = [...chain, node];
    if (node.id === id) return path;
    const nested = findPath(node.children, id, path);
    if (nested) return nested;
  }
  return null;
}

export default function GoalMap({ goal, onToggleLeaf, onEdit, onDelete, onClose }: GoalMapProps) {
  const nodes = effectiveNodes(goal);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const path = focusId ? findPath(nodes, focusId) : null;
  const focus = path?.[path.length - 1] ?? null;
  const children = focus?.children ?? nodes;
  const progress = focus ? nodeProgress(focus) : treeProgress(nodes);

  useEffect(() => {
    if (focusId && !path) setFocusId(null);
  }, [focusId, path]);

  async function toggle(id: string) {
    if (toggling) return;
    setToggling(id);
    setError('');
    try { if (!(await onToggleLeaf(id))) setError('更新完成状态失败，请重试。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '更新完成状态失败，请重试。'); }
    finally { setToggling(null); }
  }

  return <div className="gp-map" aria-label="目标地图">
    <header className="gp-map-head">
      <div><span className="gp-map-kicker">目标地图</span><h2>{goal.title}</h2></div>
      <div className="gp-map-actions"><button type="button" className="gp-icon" title="关闭地图" aria-label="关闭地图" onClick={onClose}><X size={19} /></button><button type="button" className="gp-icon" title="编辑目标" aria-label="编辑目标" onClick={onEdit}><Pencil size={19} /></button><button type="button" className="gp-icon gp-danger-icon" title="删除目标" aria-label="删除目标" onClick={onDelete}><Trash2 size={19} /></button></div>
    </header>
    {focus && <nav className="gp-breadcrumb" aria-label="目标层级">
      <button type="button" onClick={() => setFocusId(null)}>{goal.title}</button>
      {path?.map(node => <span key={node.id} className="gp-crumb"><ChevronRight size={15} /><button type="button" onClick={() => setFocusId(node.id)}>{node.title}</button></span>)}
    </nav>}
    <div key={focusId ?? 'root'} className="gp-map-focus">
      {focus && <button type="button" className="gp-map-back" onClick={() => setFocusId(path && path.length > 1 ? path[path.length - 2].id : null)}><ArrowLeft size={18} />返回上一级</button>}
      <div className="gp-map-summary"><span>{focus ? '当前分支' : '总进度'}</span><strong>{progress === null ? '尚未拆解' : `${percentLabel(progress)}%`}</strong></div>
      <PlanMindmap title={focus?.title ?? goal.title} nodes={children} onSelect={(id, leaf) => { if (leaf) void toggle(id); else setFocusId(id); }} />
      <details className="gp-map-directory"><summary>节点目录 · 键盘与文字操作</summary>
      {children.length > 0 ? <div className="gp-map-branches" role="list">{children.map(node => {
        const leaf = node.children.length === 0;
        const value = nodeProgress(node);
        return <div className="gp-map-node" key={node.id} role="listitem">
          {leaf ? <button type="button" className={`gp-check gp-map-check ${node.completed ? 'gp-check--done' : ''}`} disabled={toggling !== null} title={node.completed ? '取消完成' : '标记完成'} aria-label={`${node.completed ? '取消完成' : '标记完成'}：${node.title}`} onClick={() => void toggle(node.id)}><Check size={18} /></button> : <span className="gp-map-branch-dot" />}
          <button type="button" className="gp-map-node-main" onClick={() => { if (!leaf) setFocusId(node.id); }} disabled={leaf} aria-label={leaf ? node.title : `查看 ${node.title} 的子目标`}><span className={node.completed && leaf ? 'gp-map-node-done' : ''}>{node.title}</span><span className="gp-map-node-progress">{percentLabel(value)}%</span>{!leaf && <ChevronRight size={19} />}</button>
          <div className="gp-map-node-track"><div style={{ width: `${value}%` }} /></div>
        </div>;
      })}</div> : <p className="gp-map-empty">{focus ? '此节点还没有子目标' : '尚未拆解目标'}</p>}
      </details>
      {!focus && goal.description.trim() && <section className="gp-map-notes"><h3>附件线索</h3><p>{goal.description}</p></section>}
      {error && <p className="gp-error" role="alert">{error}</p>}
    </div>
  </div>;
}
