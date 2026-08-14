import { X, RotateCcw } from 'lucide-react';
import type { UserPreferences } from '../hooks/usePreferences';
import './PreferencePanel.css';

interface Props {
  visible: boolean;
  prefs: UserPreferences;
  onUpdate: (partial: Partial<UserPreferences>) => void;
  onReset: () => void;
  onClose: () => void;
}

const DENSITY_OPTIONS: { label: string; value: number }[] = [
  { label: '紧凑', value: 48 },
  { label: '标准', value: 64 },
  { label: '宽松', value: 80 },
];

export default function PreferencePanel({ visible, prefs, onUpdate, onReset, onClose }: Props) {
  if (!visible) return null;

  return (
    <div className="pref-overlay" onClick={onClose}>
      <div className="pref-sheet" onClick={e => e.stopPropagation()}>
        <div className="pref-handle" />

        <div className="pref-header">
          <h3 className="pref-title">偏好设置</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="pref-body">
          {/* 睡眠时间 */}
          <div className="pref-section">
            <label className="label">😴 睡眠时间段</label>
            <p className="pref-hint">此时间段在时间网格中折叠</p>
            <div className="pref-time-row">
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="label" style={{ fontSize: '0.6875rem' }}>开始</label>
                <input
                  className="input input-sm"
                  type="time"
                  value={prefs.sleepStart}
                  onChange={e => onUpdate({ sleepStart: e.target.value })}
                />
              </div>
              <span className="pref-time-sep">—</span>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="label" style={{ fontSize: '0.6875rem' }}>结束</label>
                <input
                  className="input input-sm"
                  type="time"
                  value={prefs.sleepEnd}
                  onChange={e => onUpdate({ sleepEnd: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* 隐藏睡眠时段开关 */}
          <div className="pref-section">
            <div className="pref-toggle-row">
              <div>
                <span className="pref-toggle-label">隐藏睡眠时段</span>
                <p className="pref-hint">开启后在网格中折叠睡眠时间</p>
              </div>
              <label className="pref-switch">
                <input
                  type="checkbox"
                  checked={prefs.hideSleepHours}
                  onChange={e => onUpdate({ hideSleepHours: e.target.checked })}
                />
                <span className="pref-switch-slider" />
              </label>
            </div>
          </div>

          {/* 默认任务时长 */}
          <div className="pref-section">
            <label className="label">⏱ 默认任务时长</label>
            <p className="pref-hint">点击空白处创建任务时的默认时长</p>
            <div className="pref-duration-row">
              {[15, 30, 45, 60, 90, 120].map(d => (
                <button
                  key={d}
                  className={`pref-chip ${prefs.defaultDuration === d ? 'pref-chip--active' : ''}`}
                  onClick={() => onUpdate({ defaultDuration: d })}
                >
                  {d >= 60 ? `${d / 60}h` : `${d}min`}
                </button>
              ))}
            </div>
          </div>

          {/* 网格密度 */}
          <div className="pref-section">
            <label className="label">📐 网格密度</label>
            <p className="pref-hint">调整每小时的高度</p>
            <div className="pref-density-row">
              {DENSITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`pref-chip ${prefs.hourHeight === opt.value ? 'pref-chip--active' : ''}`}
                  onClick={() => onUpdate({ hourHeight: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 重置 */}
          <div className="pref-section">
            <button className="btn btn-ghost btn-sm" onClick={onReset} style={{ color: 'var(--color-danger)' }}>
              <RotateCcw size={14} /> 恢复默认设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
