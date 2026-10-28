import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, startOfWeek, format, isSameDay } from 'date-fns';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAllCourses, getSemester, getPlanByDate } from '../db';
import type { Course, SemesterRecord, DailyPlan } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { usePreferences } from '../hooks/usePreferences';
import { blockRenderRect, minutesToTop, topToMinutes, minutesToTime, sleepLabel, getVisibleHours } from '../utils/time';
import { computeDayCourses, weekIndex, isDayHoliday } from '../utils/courseSchedule';
import CourseEditModal, { DAY_LABELS } from '../components/CourseEditModal';
import './WeekViewPage.css';

// 网格几何（与课程表视图/日视图同一套：全 0-24h、无睡眠折叠）
const TIME_COL_W = 44;
const COL_W = 52;
const GRID_HEADER_H = 58;

export default function WeekViewPage() {
  const navigate = useNavigate();
  const { prefs } = usePreferences();

  // 显示周：周一 → 周日（与国人习惯一致；日历内部仍以 0=周日 的 getDay 记星期）
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<SemesterRecord | undefined>(undefined);
  const [plans, setPlans] = useState<(DailyPlan | undefined)[]>([]);
  // 编辑弹窗：undefined=关闭
  const [editingCourse, setEditingCourse] = useState<Course | undefined>(undefined);

  useRegisterBackHandler(() => {
    navigate(-1);
    return true;
  }, []);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekDateStrs = useMemo(() => weekDates.map(d => format(d, 'yyyy-MM-dd')), [weekDates]);

  const loadWeek = useCallback(async () => {
    const [cs, sem, ps] = await Promise.all([
      getAllCourses(),
      getSemester(),
      Promise.all(weekDateStrs.map(getPlanByDate)),
    ]);
    setCourses(cs);
    setSemester(sem);
    setPlans(ps);
  }, [weekDateStrs]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const goPrev = useCallback(() => setWeekStart(ws => addDays(ws, -7)), []);
  const goNext = useCallback(() => setWeekStart(ws => addDays(ws, 7)), []);
  const goThisWeek = useCallback(() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 })), []);

  const handleCourseSaved = useCallback(() => {
    setEditingCourse(undefined);
    loadWeek();
  }, [loadWeek]);

  const hourHeight = prefs.hourHeight;
  // 与日计划一致的睡眠折叠：折叠条 28px，睡眠时段整段压成一条
  const hideSleep = prefs.hideSleepHours;
  const barHeight = hideSleep ? 28 : 0;
  const sleepStart = prefs.sleepStart;
  const sleepEnd = prefs.sleepEnd;
  const visibleHours = hideSleep ? getVisibleHours(sleepStart, sleepEnd) : 24;
  const gridHeight = visibleHours * hourHeight + barHeight;
  const gridGeo = { hideSleep, sleepStart, sleepEnd, hourHeight, barHeight, gridHeight };

  /**
   * 点空白处：按列定位日期、按 y 反算时间，直接跳那一天并由日计划打开新建面板。
   * 编辑面板只有日计划那一套（这里不重复造轮子）。
   */
  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top - GRID_HEADER_H;
    if (y < 0) return;
    const idx = Math.floor((x - TIME_COL_W) / COL_W);
    if (idx < 0 || idx > 6) return;
    const minutes = topToMinutes(y, gridGeo);
    if (minutes == null) return;
    const m = Math.max(0, Math.min(1430, Math.round(minutes / 5) * 5));
    navigate(`/?date=${weekDateStrs[idx]}&new=${minutesToTime(m)}`);
  }
  return (
    <div className="app-container app-container--week">
      {/* 页面标题 */}
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={22} />
        </button>
        <h1 className="page-title">周视图</h1>
        <div style={{ width: 36 }} />
      </div>

      {/* 周导航 */}
      <div className="wv-nav">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={goPrev} title="上一周">
          <ChevronLeft size={18} />
        </button>
        <button className="wv-nav-title" onClick={goThisWeek} title="回到本周">
          {format(weekDates[0], 'yyyy年M月d日')} – {format(weekDates[6], 'M月d日')}
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={goNext} title="下一周">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="wv-scroll">
        <div className="wv-inner" style={{ height: GRID_HEADER_H + gridHeight }} onClick={handleGridClick}>
          {/* 极淡列分隔线（替代原来的格子边框） */}
          {Array.from({ length: 8 }, (_, i) => (
            <div key={`col-${i}`} className="wv-col-line" style={{ left: TIME_COL_W + i * COL_W }} />
          ))}
          {/* 表头：星期 + 日期 + 周次 + 放假角标 */}
          <div className="wv-head" style={{ height: GRID_HEADER_H }}>
            {weekDates.map((d, i) => {
              const ds = weekDateStrs[i];
              const wk = semester?.startDate ? weekIndex(ds, semester.startDate) : 0;
              const holiday = isDayHoliday(ds, semester);
              return (
                <div
                  key={ds}
                  className={`wv-head-cell${isSameDay(d, new Date()) ? ' wv-head-cell--today' : ''}`}
                  style={{ left: TIME_COL_W + i * COL_W, width: COL_W }}
                >
                  <span className="wv-head-day">{DAY_LABELS[(i + 1) % 7]}</span>
                  <span className="wv-head-date">{format(d, 'M/d')}</span>
                  {wk >= 1 && <span className="wv-head-week">第{wk}周</span>}
                  {holiday && <span className="wv-head-holiday">放假</span>}
                </div>
              );
            })}
          </div>

          {/* 睡眠折叠条 */}
          {hideSleep && (
            <div className="wv-sleep-bar" style={{ top: GRID_HEADER_H, height: barHeight }}>
              <span className="wv-sleep-text">💤 {sleepLabel(sleepStart, sleepEnd)}</span>
            </div>
          )}

          {/* 小时行（折叠时段跳过） */}
          {Array.from({ length: 24 }, (_, h) => h).map(h => {
            const top = minutesToTop(h * 60, gridGeo);
            if (top < 0) return null;
            return (
              <div
                key={h}
                className="wv-hour-row"
                style={{ top: GRID_HEADER_H + top, height: hourHeight }}
              >
                <span className="wv-hour-label">{String(h).padStart(2, '0')}:00</span>
                <div className="wv-hour-line" />
              </div>
            );
          })}

          {/* 任务块（当天计划，只读展示） */}
          {weekDates.map((d, i) => {
            const plan = plans[i];
            if (!plan) return null;
            return plan.timeBlocks.map(b => {
              const rect = blockRenderRect(b.startTime, b.endTime, gridGeo);
              if (!rect) return null;
              return (
                <div
                  key={b.id}
                  className="wv-task-block"
                  title={`${b.taskTitle} · ${b.startTime}-${b.endTime}`}
                  onClick={e => {
                    e.stopPropagation();
                    navigate(`/?date=${weekDateStrs[i]}&block=${b.id}`);
                  }}
                  style={{
                    left: TIME_COL_W + i * COL_W + 2,
                    width: COL_W - 6,
                    top: GRID_HEADER_H + rect.top,
                    height: rect.height,
                  }}
                >
                  <div className="wv-block-inner">
                    <span className="wv-block-time">{b.startTime}-{b.endTime}</span>
                    <span className="wv-block-title">{b.taskTitle}</span>
                  </div>
                </div>
              );
            });
          })}

          {/* 课程块（按具体周忠实过滤：周次/单双周/节假日全生效） */}
          {weekDates.map((d, i) => {
            const dayCourses = computeDayCourses(courses, semester, weekDateStrs[i]);
            return dayCourses.map(c => {
              const rect = blockRenderRect(c.startTime, c.endTime, gridGeo);
              if (!rect) return null;
              return (
                <div
                  key={`${c.id}-${i}`}
                  className="wv-course-block"
                  title={`${c.name} · ${c.startTime}-${c.endTime}${c.location ? ` · ${c.location}` : ''}`}
                  style={{
                    left: TIME_COL_W + i * COL_W + 2,
                    width: COL_W - 6,
                    top: GRID_HEADER_H + rect.top,
                    height: rect.height,
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    setEditingCourse(c);
                  }}
                >
                  <div className="wv-block-inner">
                    <span className="wv-block-time">{c.startTime}-{c.endTime}</span>
                    <span className="wv-block-title">{c.name}</span>
                    {c.location && <span className="wv-block-loc">{c.location}</span>}
                  </div>
                </div>
              );
            });
          })}
        </div>
      </div>

      {/* 课程编辑弹窗（与课程表页共用） */}
      {editingCourse !== undefined && (
        <CourseEditModal
          course={editingCourse}
          onClose={() => setEditingCourse(undefined)}
          onSaved={handleCourseSaved}
        />
      )}
    </div>
  );
}
