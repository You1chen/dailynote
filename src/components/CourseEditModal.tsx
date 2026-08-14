import { useState } from 'react';
import { saveCourse } from '../db';
import type { Course } from '../types';
// settings-chip / settings-time-row / settings-field-hint 等表单样式复用设置页
import '../pages/SettingsPage.css';
import './CourseEditModal.css';

export const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const WEEK_TYPE_LABELS: Record<Course['weekType'], string> = {
  all: '每周',
  odd: '单周',
  even: '双周',
};

/** 新建/编辑表单（含 createdAt 以便编辑时保留原时间戳） */
interface CourseFormState {
  id?: number;
  name: string;
  teacher: string;
  location: string;
  dayOfWeek: number[]; // 多选
  startTime: string;
  endTime: string;
  weekType: Course['weekType'];
  startWeek: number;
  weekCount: number;
  createdAt: number;
}

const DEFAULT_FORM: CourseFormState = {
  name: '',
  teacher: '',
  location: '',
  dayOfWeek: [1],
  startTime: '08:00',
  endTime: '09:40',
  weekType: 'all',
  startWeek: 1,
  weekCount: 18,
  createdAt: 0,
};

function clampInt(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

interface Props {
  /** null = 新建，Course = 编辑 */
  course: Course | null;
  onClose: () => void;
  onSaved: () => void;
}

/** 课程新建/编辑弹窗（课程表页与周视图共用） */
export default function CourseEditModal({ course, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CourseFormState>(
    course
      ? {
          id: course.id,
          name: course.name,
          teacher: course.teacher,
          location: course.location,
          dayOfWeek: [...course.dayOfWeek],
          startTime: course.startTime,
          endTime: course.endTime,
          weekType: course.weekType,
          startWeek: course.startWeek,
          weekCount: course.weekCount,
          createdAt: course.createdAt,
        }
      : DEFAULT_FORM,
  );
  const [formError, setFormError] = useState('');

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      setFormError('请输入课程名');
      return;
    }
    if (form.endTime <= form.startTime) {
      setFormError('结束时间必须晚于开始时间');
      return;
    }
    if (form.dayOfWeek.length === 0) {
      setFormError('请至少选择一个星期');
      return;
    }
    const payload: Course = {
      name,
      teacher: form.teacher.trim(),
      location: form.location.trim(),
      dayOfWeek: [...form.dayOfWeek].sort((a, b) => a - b),
      startTime: form.startTime,
      endTime: form.endTime,
      weekType: form.weekType,
      startWeek: clampInt(form.startWeek, 1, 30),
      weekCount: clampInt(form.weekCount, 1, 30),
      createdAt: form.createdAt,
      updatedAt: Date.now(),
    };
    await saveCourse(form.id != null ? { ...payload, id: form.id } : payload);
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{course ? '编辑课程' : '新建课程'}</h3>
        <div className="form-group">
          <label className="label">课程名 *</label>
          <input
            className="input"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="课程名"
            maxLength={30}
          />
        </div>
        <div className="form-group">
          <label className="label">教师</label>
          <input
            className="input"
            value={form.teacher}
            onChange={e => setForm({ ...form, teacher: e.target.value })}
            placeholder="可留空"
            maxLength={30}
          />
        </div>
        <div className="form-group">
          <label className="label">上课地点</label>
          <input
            className="input"
            value={form.location}
            onChange={e => setForm({ ...form, location: e.target.value })}
            placeholder="上课地点"
            maxLength={30}
          />
        </div>
        <div className="form-group">
          <label className="label">星期（可多选）</label>
          <div className="settings-chip-row">
            {DAY_LABELS.map((label, dw) => {
              const active = form.dayOfWeek.includes(dw);
              return (
                <button
                  key={dw}
                  className={`settings-chip ${active ? 'settings-chip--active' : ''}`}
                  onClick={() => {
                    if (active) {
                      // 至少保留一个星期，不允许清空
                      if (form.dayOfWeek.length <= 1) return;
                      setForm({ ...form, dayOfWeek: form.dayOfWeek.filter(d => d !== dw) });
                    } else {
                      setForm({ ...form, dayOfWeek: [...form.dayOfWeek, dw].sort((a, b) => a - b) });
                    }
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="settings-field-hint" style={{ marginTop: 6 }}>
            多星期有课可多选，无需重复创建
          </p>
        </div>
        <div className="form-group">
          <label className="label">上课时间</label>
          <div className="settings-time-row">
            <input
              className="input input-sm"
              type="time"
              value={form.startTime}
              onChange={e => setForm({ ...form, startTime: e.target.value })}
            />
            <span className="settings-time-sep">—</span>
            <input
              className="input input-sm"
              type="time"
              value={form.endTime}
              onChange={e => setForm({ ...form, endTime: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="label">单双周</label>
          <div className="settings-chip-row">
            {(Object.keys(WEEK_TYPE_LABELS) as Course['weekType'][]).map(wt => (
              <button
                key={wt}
                className={`settings-chip ${form.weekType === wt ? 'settings-chip--active' : ''}`}
                onClick={() => setForm({ ...form, weekType: wt })}
              >
                {WEEK_TYPE_LABELS[wt]}
              </button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="label">周数范围（第 1 周起算）</label>
          <div className="courses-week-row">
            <span className="courses-week-label">从第</span>
            <input
              className="input input-sm courses-week-input"
              type="number"
              min={1}
              max={30}
              value={form.startWeek}
              onChange={e => setForm({ ...form, startWeek: parseInt(e.target.value, 10) })}
            />
            <span className="courses-week-label">周起，共</span>
            <input
              className="input input-sm courses-week-input"
              type="number"
              min={1}
              max={30}
              value={form.weekCount}
              onChange={e => setForm({ ...form, weekCount: parseInt(e.target.value, 10) })}
            />
            <span className="courses-week-label">周</span>
          </div>
        </div>
        {formError && <p className="cem-error">{formError}</p>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
