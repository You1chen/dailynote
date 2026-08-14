import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, CheckCircle2, Circle } from 'lucide-react';
import type { TimeBlock } from '../types';
import './TimeBlockCard.css';

interface Props {
  block: TimeBlock;
  onChange: (changes: Partial<TimeBlock>) => void;
  onDelete: () => void;
}

export default function TimeBlockCard({ block, onChange, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  const focusColor = block.focusScore >= 7 ? 'var(--color-success)'
    : block.focusScore >= 4 ? 'var(--color-warning)' : 'var(--color-danger)';

  const effColor = block.efficiencyScore >= 7 ? 'var(--color-success)'
    : block.efficiencyScore >= 4 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div className={`time-block-card ${block.completed ? 'time-block-card--done' : ''}`}>
      {/* 折叠行 */}
      <div className="tbc-header" onClick={() => setExpanded(!expanded)}>
        <div className="tbc-time">
          <span className="tbc-time-text">{block.startTime} - {block.endTime}</span>
          {block.completed && <CheckCircle2 size={16} className="tbc-check" />}
        </div>
        <div className="tbc-title-row">
          <span className="tbc-task-title">{block.taskTitle || '未命名任务'}</span>
          <div className="tbc-scores">
            <span className="tbc-score-dot" style={{ background: focusColor }}>
              专{block.focusScore}
            </span>
            <span className="tbc-score-dot" style={{ background: effColor }}>
              效{block.efficiencyScore}
            </span>
          </div>
        </div>
        <div className="tbc-expand">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="tbc-detail">
          <div className="form-group">
            <label className="label">时间段</label>
            <div className="tbc-time-inputs">
              <input
                className="input input-sm"
                type="time"
                value={block.startTime}
                onChange={e => onChange({ startTime: e.target.value })}
              />
              <span>—</span>
              <input
                className="input input-sm"
                type="time"
                value={block.endTime}
                onChange={e => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="label">任务名称</label>
            <input
              className="input"
              value={block.taskTitle}
              onChange={e => onChange({ taskTitle: e.target.value })}
              placeholder="任务名称"
            />
          </div>

          <div className="form-group">
            <label className="label">计划内容</label>
            <textarea
              className="input textarea"
              value={block.plannedContent}
              onChange={e => onChange({ plannedContent: e.target.value })}
              placeholder="要做什么？"
              rows={2}
            />
          </div>

          <div className="form-group">
            <label className="label">实际执行情况</label>
            <textarea
              className="input textarea"
              value={block.actualExecution}
              onChange={e => onChange({ actualExecution: e.target.value })}
              placeholder="实际完成情况"
              rows={2}
            />
          </div>

          {/* 评分滑块 */}
          <div className="form-group">
            <label className="label">专注度</label>
            <div className="score-row">
              <span className="score-label">😵 分散</span>
              <input
                type="range"
                className="score-slider"
                min="1" max="10"
                value={block.focusScore}
                onChange={e => onChange({ focusScore: Number(e.target.value) })}
              />
              <span className="score-label" style={{ textAlign: 'right' }}>🧘 专注</span>
              <span className="score-value" style={{ color: focusColor }}>{block.focusScore}</span>
            </div>
          </div>

          <div className="form-group">
            <label className="label">效率</label>
            <div className="score-row">
              <span className="score-label">🐢 低效</span>
              <input
                type="range"
                className="score-slider"
                min="1" max="10"
                value={block.efficiencyScore}
                onChange={e => onChange({ efficiencyScore: Number(e.target.value) })}
              />
              <span className="score-label" style={{ textAlign: 'right' }}>🚀 高效</span>
              <span className="score-value" style={{ color: effColor }}>{block.efficiencyScore}</span>
            </div>
          </div>

          <div className="form-group">
            <label className="label">备注</label>
            <input
              className="input"
              value={block.notes}
              onChange={e => onChange({ notes: e.target.value })}
              placeholder="备注"
            />
          </div>

          <div className="tbc-actions">
            <button
              className={`btn btn-sm ${block.completed ? 'btn-outline' : 'btn-primary'}`}
              onClick={() => onChange({ completed: !block.completed })}
            >
              {block.completed ? <><CheckCircle2 size={16} /> 已完成</> : <><Circle size={16} /> 标记完成</>}
            </button>
            <button className="btn btn-sm btn-danger" onClick={onDelete}>
              <Trash2 size={16} /> 删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
