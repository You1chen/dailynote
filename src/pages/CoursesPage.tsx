import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type PointerEvent } from 'react';
import { useRouteBack } from '../hooks/useRouteBack';
import { Trash2 } from 'lucide-react';
import { getAllCourses, deleteCourse, getSemester, saveSemester, saveCourse } from '../db';
import type { Course, SemesterRecord } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { usePreferences } from '../hooks/usePreferences';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { isCourseInSemester } from '../utils/courseSchedule';
import { createTimetable, timetableDayBlocks, timetableSlot, timetableTime, TIMETABLE_FULL_WEEK, TIMETABLE_WEEKDAYS, type CourseSlot } from '../utils/courseTimetable';
import { parseTimetableText, type ImportedCourseRow } from '../utils/timetableImport';
import CourseEditModal, { DAY_LABELS, WEEK_TYPE_LABELS } from '../components/CourseEditModal';
// settings-section / settings-field / settings-chip 等通用表单样式复用设置页
import './SettingsPage.css';
import ConfirmDialog from '../components/ConfirmDialog';
import './CoursesPage.css';

const COURSE_COLORS = ['#85b978', '#e8899d', '#c49a4a', '#a28bd4', '#62b3c7', '#d88967', '#8d9fc9'];

const SPECIAL_KINDS: { value: 'holiday' | 'makeup'; label: string }[] = [
  { value: 'holiday', label: '放假' },
  { value: 'makeup', label: '补课' },
];

/** 课程覆盖的周范围文本，如「第1-18周」 */
function weekRangeText(c: Course): string {
  return `第${c.startWeek}-${c.startWeek + c.weekCount - 1}周`;
}

const DRAG_THRESHOLD = 6;

type GridGesture = { pointerId: number; day: number; y: number; minute: number; dragging: boolean };
type EditingState = { course: Course | null; slot?: CourseSlot };

export default function CoursesPage() {
  const routeBack = useRouteBack();
  const { prefs } = usePreferences();
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<SemesterRecord | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const [showWeekends, setShowWeekends] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [selection, setSelection] = useState<{ day: number; from: number; to: number } | null>(null);
  const gesture = useRef<GridGesture | null>(null);
  const [askDeleteCourse, setAskDeleteCourse] = useState<Course | null>(null);
  const [askDeleteSpecial, setAskDeleteSpecial] = useState<number | null>(null);

  // 特殊日期表单
  const [semesterOpen, setSemesterOpen] = useState(false);
  const [specialDate, setSpecialDate] = useState('');
  const [specialKind, setSpecialKind] = useState<'holiday' | 'makeup'>('holiday');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportedCourseRow[]>([]);
  const [importStep, setImportStep] = useState<'text' | 'preview'>('text');
  const [importStartWeek, setImportStartWeek] = useState('');
  const [importWeekCount, setImportWeekCount] = useState('');
  const [importWeekType, setImportWeekType] = useState<'all' | 'odd' | 'even'>('all');

  const closeImport = () => { if (!importBusy) setImportOpen(false); };
  const importSheet = useSheetDrag(closeImport, importOpen && !importBusy);
  const semesterSheet = useSheetDrag(() => setSemesterOpen(false), semesterOpen && !importOpen);
  const backFromPreview = () => { setImportStep('text'); setImportError(''); };
  const handleBack = useCallback(() => {
    if (askDeleteSpecial !== null) setAskDeleteSpecial(null);
    else if (askDeleteCourse) setAskDeleteCourse(null);
    else if (editing) setEditing(null);
    else if (importOpen) {
      if (!importBusy) {
        if (importStep === 'preview') { setImportStep('text'); setImportError(''); }
        else setImportOpen(false);
      }
    } else if (semesterOpen) setSemesterOpen(false);
    else routeBack();
  }, [askDeleteSpecial, askDeleteCourse, editing, importOpen, importBusy, importStep, semesterOpen, routeBack]);

  useRegisterBackHandler(() => {
    handleBack();
    return true;
  }, [handleBack]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!askDeleteSpecial && !askDeleteCourse && !editing && !importOpen && !semesterOpen) return;
      event.preventDefault();
      handleBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBack, askDeleteSpecial, askDeleteCourse, editing, importOpen, semesterOpen]);

  const load = useCallback(async () => {
    const [cs, sem] = await Promise.all([getAllCourses(), getSemester()]);
    setCourses(cs);
    setSemester(sem);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ============ 学期设置 ============

  const handleStartDateChange = async (startDate: string) => {
    await saveSemester({
      id: 1,
      startDate: startDate || null,
      specialDates: semester?.specialDates ?? [],
      updatedAt: Date.now(),
    });
    await load();
  };

  const handleAddSpecialDate = async () => {
    if (!specialDate) return;
    const specialDates = [...(semester?.specialDates ?? [])];
    const existing = specialDates.find(s => s.date === specialDate);
    if (existing) existing.kind = specialKind; // 同一天重复添加 → 替换类型
    else specialDates.push({ id: Date.now(), date: specialDate, kind: specialKind });
    await saveSemester({
      id: 1,
      startDate: semester?.startDate ?? null,
      specialDates,
      updatedAt: Date.now(),
    });
    setSemester(await getSemester());
    setSpecialDate('');
  };

  const removeSpecialDate = async (id: number) => {
    setAskDeleteSpecial(null);
    await saveSemester({
      id: 1,
      startDate: semester?.startDate ?? null,
      specialDates: (semester?.specialDates ?? []).filter(s => s.id !== id),
      updatedAt: Date.now(),
    });
    setSemester(await getSemester());
  };

  // ============ 课程 ============

  const removeCourse = async (c: Course) => {
    await deleteCourse(c.id!);
    setAskDeleteCourse(null);
    setEditing(null);
    setCourses(await getAllCourses());
  };

  function parseImport() {
    const parsed = parseTimetableText(importText);
    if (!parsed.rows.length) { setImportError(parsed.errors[0] || '没有可导入的课程'); return; }
    if (parsed.errors.length) { setImportError(parsed.errors.join('；')); return; }
    setImportPreview(parsed.rows);
    setImportStep('preview');
    setImportError('');
  }

  function updateImportRow(index: number, patch: Partial<ImportedCourseRow>) {
    setImportPreview(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  async function importCourses() {
    const startWeek = Number(importStartWeek);
    const weekCount = Number(importWeekCount);
    if (!Number.isInteger(startWeek) || startWeek < 1 || startWeek > 30 || !Number.isInteger(weekCount) || weekCount < 1 || weekCount > 30) {
      setImportError('请填写 1–30 的起始周和持续周数');
      return;
    }
    if (!importPreview.length) { setImportError('没有可导入的课程'); return; }
    if (importPreview.some(row => !row.name.trim() || row.dayOfWeek.length !== 1 || row.startTime >= row.endTime)) {
      setImportError('请补全课程名，并确认结束时间晚于开始时间');
      return;
    }
    setImportBusy(true);
    setImportError('');
    try {
      const now = Date.now();
      for (const row of importPreview) {
        await saveCourse({ name: row.name.trim(), teacher: '', location: row.location.trim(), dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime, weekType: importWeekType, startWeek, weekCount, createdAt: now, updatedAt: now });
      }
      await load();
      setImportOpen(false);
      setImportText('');
      setImportPreview([]);
      setImportStep('text');
    } catch (cause) {
      setImportError(String(cause));
    } finally {
      setImportBusy(false);
    }
  }

  const handleCourseSaved = async () => {
    setEditing(null);
    setCourses(await getAllCourses());
  };

  const days = showWeekends ? TIMETABLE_FULL_WEEK : TIMETABLE_WEEKDAYS;
  const gridCourses = useMemo(() => courses.filter(c => isCourseInSemester(c, semester)), [courses, semester]);
  const timetable = useMemo(() => createTimetable(gridCourses, days, prefs.hourHeight), [gridCourses, days, prefs.hourHeight]);
  const dayBlocks = useMemo(() => days.map(day => timetableDayBlocks(gridCourses, day)), [gridCourses, days]);
  const hourTicks = Array.from({ length: 24 }, (_, hour) => hour * 60)
    .filter(minute => timetable.bands.some(band => !band.folded && minute >= band.start && minute < band.end));

  function openSlot(day: number, from: number, to?: number) {
    setEditing({ course: null, slot: timetableSlot(day, from, to, prefs.courseTimeCombinations) });
  }

  function eventMinute(event: PointerEvent<HTMLDivElement>) {
    return timetable.minuteAtY(event.clientY - event.currentTarget.getBoundingClientRect().top);
  }

  function startSelection(event: PointerEvent<HTMLDivElement>, day: number) {
    if (!event.isPrimary || event.button !== 0 || gesture.current || (event.target as HTMLElement).closest('.ct-course-block')) return;
    gesture.current = { pointerId: event.pointerId, day, y: event.clientY, minute: eventMinute(event), dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSelection(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    start.dragging ||= Math.abs(event.clientY - start.y) >= DRAG_THRESHOLD;
    if (start.dragging) setSelection({ day: start.day, from: start.minute, to: eventMinute(event) });
  }

  function cancelSelection(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setSelection(null);
  }

  function endSelection(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dragged = start.dragging || Math.abs(event.clientY - start.y) >= DRAG_THRESHOLD;
    const end = dragged ? eventMinute(event) : undefined;
    cancelSelection(event);
    openSlot(start.day, start.minute, end);
  }

  if (loading) {
    return <div className="app-container"><div className="empty-state"><p>加载中...</p></div></div>;
  }

  return (
    <div className="app-container courses-page">
      <header className="page-header courses-page-header">
        <button type="button" className="btn btn-ghost courses-back" onClick={handleBack}>返回</button>
        <h1 className="page-title">课程表</h1>
        <button type="button" className="btn btn-ghost courses-settings" onClick={() => setSemesterOpen(true)}>学期设置</button>
      </header>
      <section className="ct-scroll" aria-label="课程表网格" style={{ '--ct-day-count': days.length } as CSSProperties}>
        <div className="ct-head ct-columns">
          {days.map(day => <span key={day}>{DAY_LABELS[day]}</span>)}
          <span className="ct-scroll-rail" aria-hidden="true" />
        </div>
        <div className="ct-body ct-columns" style={{ height: timetable.height }}>
          {days.map((day, index) => {
            const selected = selection?.day === day ? selection : null;
            const selectionTop = selected ? timetable.yAtMinute(Math.min(selected.from, selected.to)) : 0;
            return (
              <div className="ct-day" key={day} aria-label={DAY_LABELS[day]} role="group"
                onPointerDown={event => startSelection(event, day)} onPointerMove={moveSelection}
                onPointerUp={endSelection} onPointerCancel={cancelSelection} onLostPointerCapture={cancelSelection}>
                {timetable.bands.map(band => (
                  <button key={band.start} className={`ct-band${band.folded ? ' ct-band--folded' : ''}`} type="button"
                    style={{ top: band.top, height: band.height }}
                    aria-label={`${DAY_LABELS[day]} ${timetableTime(band.start)}–${timetableTime(band.end)}${band.folded ? '（折叠）' : ''}：新建课程`}
                    onClick={event => { if (event.detail === 0) openSlot(day, band.folded ? (band.start + band.end) / 2 : band.start); }}>
                    {band.folded && <span aria-hidden="true">⋯</span>}
                  </button>
                ))}
                {hourTicks.map(minute => <span className="ct-hour-line" key={minute} style={{ top: timetable.yAtMinute(minute) }} />)}
                {selected && <div className="ct-selection" style={{ top: selectionTop, height: timetable.yAtMinute(Math.max(selected.from, selected.to)) - selectionTop }} />}
                {dayBlocks[index].map(({ course, start, end, lane, laneCount }) => {
                  const top = timetable.yAtMinute(start);
                  const label = `${course.name} · ${course.startTime}–${course.endTime} · ${weekRangeText(course)} · ${WEEK_TYPE_LABELS[course.weekType]}${course.location ? ` · ${course.location}` : ''}`;
                  return (
                    <button type="button" key={course.id} className="ct-course-block"
                      style={{ left: `${lane / laneCount * 100}%`, width: `${100 / laneCount}%`, top, height: timetable.yAtMinute(end) - top, background: COURSE_COLORS[(course.id ?? 0) % COURSE_COLORS.length] }}
                      title={label} aria-label={`编辑 ${label}`} onClick={() => setEditing({ course })}>
                      <span className="ct-block-name">{course.name}{course.weekType !== 'all' && <sup>{course.weekType === 'odd' ? '单' : '双'}</sup>}</span>
                      <span className="ct-block-time">{course.startTime}–{course.endTime}</span>
                      {course.location && <span className="ct-block-loc">{course.location}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="ct-scroll-rail" aria-hidden="true" />
        </div>
      </section>

      {semesterOpen && !importOpen && <div className="modal-overlay" onClick={() => setSemesterOpen(false)}>
        <section className="modal courses-semester-modal" role="dialog" aria-modal="true" aria-labelledby="semester-settings-title" style={semesterSheet.style} onClick={event => event.stopPropagation()}>
          <div className="sheet-grip" aria-hidden="true" {...semesterSheet.handlers} />
          <h3 className="modal-title" id="semester-settings-title">学期设置</h3>
          <div className="settings-field">
            <label className="label" htmlFor="semester-start-date">开学时间</label>
            <input id="semester-start-date" className="input" type="date" value={semester?.startDate ?? ''} onChange={e => handleStartDateChange(e.target.value)} />
            {!semester?.startDate && <p className="courses-warn" role="status">未设置开学时间，课程暂不显示</p>}
          </div>
          <div className="settings-field">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setImportError(''); setImportStep('text'); setImportPreview([]); setImportOpen(true); }}>粘贴导入</button>
          </div>
          <div className="settings-field courses-weekend-setting">
            <label><input type="checkbox" checked={showWeekends} onChange={event => setShowWeekends(event.target.checked)} /> 显示周末</label>
          </div>
          <div className="settings-field">
            <label className="label">特殊日期</label>
            <div className="courses-special-add">
              <input className="input input-sm" type="date" value={specialDate} onChange={e => setSpecialDate(e.target.value)} />
              <div className="courses-kind-row">{SPECIAL_KINDS.map(k => <button key={k.value} className={`settings-chip ${specialKind === k.value ? 'settings-chip--active' : ''}`} onClick={() => setSpecialKind(k.value)}>{k.label}</button>)}</div>
              <button className="btn btn-primary btn-sm" onClick={handleAddSpecialDate} disabled={!specialDate}>添加</button>
            </div>
            {(semester?.specialDates?.length ?? 0) > 0 && <div className="courses-special-list">{semester!.specialDates.slice().sort((a, b) => a.date.localeCompare(b.date)).map(s => <div key={s.id} className="courses-special-item"><span className="courses-special-date">{s.date}</span><span className={`courses-special-tag ${s.kind === 'holiday' ? 'courses-special-tag--holiday' : 'courses-special-tag--makeup'}`}>{s.kind === 'holiday' ? '放假' : '补课'}</span><button className="btn btn-ghost btn-icon courses-special-del" title="删除" onClick={() => setAskDeleteSpecial(s.id)}><Trash2 size={14} /></button></div>)}</div>}
          </div>
          <div className="modal-actions"><button className="btn btn-primary" onClick={() => setSemesterOpen(false)}>完成</button></div>
        </section>
      </div>}

      {importOpen && <div className="modal-overlay" onClick={closeImport}>
        <section className="modal courses-import-modal" role="dialog" aria-modal="true" aria-labelledby="course-import-title" style={importSheet.style} onClick={event => event.stopPropagation()}>
          <div className="sheet-grip" aria-hidden="true" {...importSheet.handlers} />
          <h3 className="modal-title" id="course-import-title">粘贴课表</h3>
          {importStep === 'text' ? <>
            <textarea className="input textarea" rows={8} value={importText} onChange={event => { setImportText(event.target.value); setImportError(''); }} placeholder={'周一 08:00-09:40 高等数学 @教1-101\n周三 14:30-16:10 大学物理'} autoFocus />
            {importError && <p className="courses-warn" role="alert">{importError}</p>}
            <div className="modal-actions"><button className="btn btn-ghost" onClick={closeImport}>取消</button><button className="btn btn-primary" disabled={!importText.trim()} onClick={parseImport}>解析预览</button></div>
          </> : <>
            <div className="courses-import-list">{importPreview.map((row, index) => <div key={index} className="courses-import-row">
              <input className="input input-sm" aria-label={`课程 ${index + 1} 名称`} value={row.name} onChange={event => updateImportRow(index, { name: event.target.value })} />
              <div className="courses-import-grid">
                <select className="input input-sm" aria-label={`课程 ${index + 1} 星期`} value={row.dayOfWeek[0]} onChange={event => updateImportRow(index, { dayOfWeek: [Number(event.target.value)] })}>{DAY_LABELS.map((label, day) => <option key={day} value={day}>{label}</option>)}</select>
                <input className="input input-sm" aria-label={`课程 ${index + 1} 开始时间`} type="time" value={row.startTime} onChange={event => updateImportRow(index, { startTime: event.target.value })} />
                <input className="input input-sm" aria-label={`课程 ${index + 1} 结束时间`} type="time" value={row.endTime} onChange={event => updateImportRow(index, { endTime: event.target.value })} />
              </div>
              <input className="input input-sm" aria-label={`课程 ${index + 1} 地点`} value={row.location} onChange={event => updateImportRow(index, { location: event.target.value })} placeholder="地点" />
            </div>)}</div>
            <div className="courses-import-weeks">
              <label>周次<input className="input input-sm" type="number" min={1} max={30} value={importStartWeek} onChange={event => setImportStartWeek(event.target.value)} placeholder="起始" /></label>
              <span>起，共</span>
              <input className="input input-sm" type="number" min={1} max={30} value={importWeekCount} onChange={event => setImportWeekCount(event.target.value)} placeholder="周数" />
              <span>周</span>
              <select className="input input-sm" value={importWeekType} onChange={event => setImportWeekType(event.target.value as 'all' | 'odd' | 'even')}><option value="all">每周</option><option value="odd">单周</option><option value="even">双周</option></select>
            </div>
            {importError && <p className="courses-warn" role="alert">{importError}</p>}
            <div className="modal-actions"><button className="btn btn-ghost" disabled={importBusy} onClick={backFromPreview}>返回</button><button className="btn btn-primary" disabled={importBusy || !importStartWeek || !importWeekCount} onClick={() => void importCourses()}>{importBusy ? '导入中…' : '确认导入'}</button></div>
          </>}
        </section>
      </div>}
      {editing && (
        <CourseEditModal
          course={editing.course}
          initialSlot={editing.slot}
          onClose={() => setEditing(null)}
          onSaved={handleCourseSaved}
          onDelete={editing.course?.id != null ? () => setAskDeleteCourse(editing.course) : undefined}
        />
      )}
      <ConfirmDialog
        open={askDeleteCourse !== null}
        message={askDeleteCourse ? `确定删除课程「${askDeleteCourse.name}」？删除后可在回收站恢复。` : ''}
        onCancel={() => setAskDeleteCourse(null)}
        onConfirm={() => askDeleteCourse && removeCourse(askDeleteCourse)}
      />
      <ConfirmDialog
        open={askDeleteSpecial !== null}
        message="删除这条特殊日期？"
        onCancel={() => setAskDeleteSpecial(null)}
        onConfirm={() => askDeleteSpecial !== null && removeSpecialDate(askDeleteSpecial)}
      />
    </div>
  );
}
