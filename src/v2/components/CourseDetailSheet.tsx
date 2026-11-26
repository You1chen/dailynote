import { useState } from 'react';
import { MapPin, Trash2, UserRound } from 'lucide-react';
import Sheet from './Sheet';
import type { Course } from '../../types';
import { deleteCourse } from '../../db';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import { WEEKDAY_FULL } from '../utils/dates';

interface Props {
  open: boolean;
  course: Course | null;
  onClose: () => void;
}

export default function CourseDetailSheet({ open, course, onClose }: Props) {
  const { reloadCourses } = useData();
  const ui = useUi();
  const [busy, setBusy] = useState(false);

  if (!course) return null;

  async function remove() {
    const id = course?.id;
    if (id == null || busy) return;
    const ok = await ui.confirm({
      title: '删除这门课程？',
      message: '只删除课程表里的这一门课，已经写进日程的时间块不会受影响。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCourse(id);
      await reloadCourses();
      window.dispatchEvent(new Event('dailynote-courses-changed'));
      ui.toast('课程已删除');
      onClose();
    } catch (cause) {
      ui.toast(cause instanceof Error ? cause.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="课程"
      subtitle={course.dayOfWeek.map(day => WEEKDAY_FULL[day]).join('、')}
      footer={(
        <>
          <button type="button" className="v-btn v-btn--danger" onClick={() => void remove()} disabled={busy}>
            <Trash2 size={15} /> 删除
          </button>
          <span className="v-grow" />
          <button type="button" className="v-btn v-btn--primary" onClick={onClose}>关闭</button>
        </>
      )}
    >
      <h1 className="v-detail-title" style={{ fontSize: 25 }}>{course.name}</h1>
      <div className="v-detail-meta">
        <span>{course.startTime} – {course.endTime}</span>
        <span>·</span>
        <span>第 {course.startWeek}–{course.startWeek + course.weekCount - 1} 周</span>
        <span>·</span>
        <span>{course.weekType === 'odd' ? '单周' : course.weekType === 'even' ? '双周' : '每周'}</span>
      </div>
      <div className="v-settings-row">
        <span style={{ color: 'var(--v-teal)' }}><MapPin size={18} /></span>
        <div className="v-settings-row-label">
          <strong>地点</strong>
          <span>{course.location || '未填写'}</span>
        </div>
      </div>
      <div className="v-settings-row">
        <span style={{ color: 'var(--v-text-3)' }}><UserRound size={18} /></span>
        <div className="v-settings-row-label">
          <strong>教师</strong>
          <span>{course.teacher || '未填写'}</span>
        </div>
      </div>
      <p className="v-tiny" style={{ marginTop: 14, lineHeight: 1.6 }}>
        需要修改时间或周次时，重新导入一次课表即可；也可以在导入预览里逐门修正。
      </p>
    </Sheet>
  );
}
