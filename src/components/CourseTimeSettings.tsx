import { useState } from 'react';
import { isValidCourseTime, type CourseTimeCombination } from '../utils/courseTimeCombinations';

interface Props {
  combinations: CourseTimeCombination[];
  onChange: (combinations: CourseTimeCombination[]) => void;
}

export default function CourseTimeSettings({ combinations, onChange }: Props) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const clear = () => { setStartTime(''); setEndTime(''); setEditing(null); setError(''); };
  const save = () => {
    if (!isValidCourseTime(startTime) || !isValidCourseTime(endTime) || endTime <= startTime) {
      setError('请输入有效时间，且结束时间必须晚于开始时间');
      return;
    }
    if (combinations.some(pair => pair.startTime === startTime && pair.startTime !== editing)) {
      setError('该开始时间已有组合，请编辑原组合');
      return;
    }
    onChange([...combinations.filter(pair => pair.startTime !== editing), { startTime, endTime }]
      .sort((a, b) => a.startTime.localeCompare(b.startTime)));
    clear();
  };
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">📚 课程时间组合</h2>
      <div className="card">
        {combinations.map(pair => (
          <div className="settings-course-time-item" key={pair.startTime}>
            <span>{pair.startTime} → {pair.endTime}</span>
            <button className="btn btn-ghost" aria-label={`编辑 ${pair.startTime} 时间组合`} onClick={() => {
              setStartTime(pair.startTime); setEndTime(pair.endTime); setEditing(pair.startTime); setError('');
            }}>编辑</button>
            <button className="btn btn-ghost" aria-label={`删除 ${pair.startTime} 时间组合`} onClick={() => {
              onChange(combinations.filter(item => item.startTime !== pair.startTime));
              if (editing === pair.startTime) clear();
            }}>删除</button>
          </div>
        ))}
        {combinations.length === 0 && <p className="settings-field-hint">暂无组合</p>}
        <div className="settings-time-row" style={{ marginTop: 12 }}>
          <input className="input input-sm" type="time" aria-label="组合开始时间" value={startTime} onChange={e => setStartTime(e.target.value)} />
          <span className="settings-time-sep">→</span>
          <input className="input input-sm" type="time" aria-label="组合结束时间" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
        {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <div className="settings-chip-row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={save}>{editing ? '保存组合' : '添加组合'}</button>
          {editing && <button className="btn btn-ghost" onClick={clear}>取消编辑</button>}
        </div>
      </div>
    </section>
  );
}
