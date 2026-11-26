import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Plus,
  Sparkles,
} from 'lucide-react';
import PlanTimeGrid from '../../components/PlanTimeGrid';
import { useDailyPlan } from '../../hooks/useDailyPlan';
import { usePreferences } from '../../hooks/usePreferences';
import { useTaskBoard } from '../../hooks/useTaskBoard';
import { getAllPlans } from '../../db';
import type { Course, TimeBlock } from '../../types';
import { computeDayCourses } from '../../utils/courseSchedule';
import { dateObj, isToday, minutesToTime, monthDay, shiftDate, todayKey, weekdayName } from '../utils/dates';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import { cardTitle, typeMeta } from '../utils/cards';
import { cardDateKey, dateGroupLabel } from '../../utils/knowledgeCards';
import WeekTimetableSheet from '../components/WeekTimetableSheet';
import CourseImportSheet from '../components/CourseImportSheet';
import CourseDetailSheet from '../components/CourseDetailSheet';
import DatePickerSheet from '../components/DatePickerSheet';

const HOUR = 64;
const GRID_HEIGHT = 24 * HOUR;

interface DayEvent {
  key: string;
  kind: 'block' | 'course';
  start: number;
  end: number;
  block?: TimeBlock;
  course?: Course;
}

function dayCourses(courses: Course[], semester: ReturnType<typeof useData>['semester'], date: string): Course[] {
  if (semester?.startDate) return computeDayCourses(courses, semester, date);
  const day = dateObj(date).getDay();
  return courses
    .filter(course => course.dayOfWeek.includes(day))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
}

function layoutEvents(events: DayEvent[]): Array<DayEvent & { lane: number; lanes: number }> {
  const sorted = [...events].sort((a, b) =>
    a.start - b.start
    || a.end - b.end
    || (a.kind === b.kind ? 0 : a.kind === 'block' ? -1 : 1));
  const out: Array<DayEvent & { lane: number; lanes: number }> = [];
  let group: DayEvent[] = [];
  let groupEnd = -1;

  const flush = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const placed = group.map(event => {
      let lane = laneEnds.findIndex(end => end <= event.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = event.end;
      return { ...event, lane };
    });
    const lanes = Math.max(1, laneEnds.length);
    out.push(...placed.map(event => ({ ...event, lanes })));
    group = [];
    groupEnd = -1;
  };

  for (const event of sorted) {
    if (group.length && event.start >= groupEnd) flush();
    group.push(event);
    groupEnd = Math.max(groupEnd, event.end);
  }
  flush();
  return out;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export default function TodayPage() {
  const navigate = useNavigate();
  const ui = useUi();
  const { courses, semester, cards, loadingCourses } = useData();
  const { prefs } = usePreferences();
  const [date, setDate] = useState(todayKey());
  const { plan, loading, reload } = useDailyPlan(date);
  const { leaves } = useTaskBoard();
  const [planDates, setPlanDates] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [courseDetail, setCourseDetail] = useState<Course | null>(null);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  const activeTasks = useMemo(() => leaves.filter(leaf => !leaf.done), [leaves]);
  const todaysCourses = useMemo(() => dayCourses(courses, semester, date), [courses, semester, date]);
  const showToday = isToday(date);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    void getAllPlans()
      .then(plans => {
        if (!alive) return;
        setPlanDates(new Set(plans.filter(item => item.timeBlocks.length).map(item => item.date)));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [plan, date]);

  useEffect(() => {
    const onPlanChanged = (event: Event) => {
      const changed = (event as CustomEvent<{ date?: string }>).detail?.date;
      if (!changed || changed === date) void reload();
    };
    window.addEventListener('dailynote-plan-changed', onPlanChanged);
    return () => window.removeEventListener('dailynote-plan-changed', onPlanChanged);
  }, [date, reload]);

  useEffect(() => {
    if (loading) return;
    // Jump to now when the date changes, but never after an in-place save:
    // the user may have scrolled to a different hour to edit that block.
    if (scrolledFor.current === date) return;
    scrolledFor.current = date;
    const timer = window.setTimeout(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollTop = showToday
        ? Math.max(0, (nowMinutes / 60) * HOUR - 150)
        : 0;
    }, 70);
    return () => window.clearTimeout(timer);
    // Only jump when the date changes; the now line keeps moving on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loading, showToday]);

  const blocks = plan?.timeBlocks ?? [];
  const events = useMemo<Array<DayEvent & { lane: number; lanes: number }>>(() => {
    const list: DayEvent[] = [];
    for (const block of blocks) {
      list.push({
        key: `block-${block.id}`,
        kind: 'block',
        start: minutesOf(block.startTime),
        end: minutesOf(block.endTime),
        block,
      });
    }
    for (const course of todaysCourses) {
      list.push({
        key: `course-${course.id ?? course.name}`,
        kind: 'course',
        start: minutesOf(course.startTime),
        end: minutesOf(course.endTime),
        course,
      });
    }
    return layoutEvents(list.filter(event => event.end > event.start));
  }, [blocks, todaysCourses]);

  const completed = blocks.filter(block => block.completed).length;
  const hourTops = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour * HOUR), []);
  const recentCards = useMemo(
    () => [...cards].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3),
    [cards],
  );

  function openBlock(startMinute: number, endMinute?: number) {
    const snap = (value: number) => Math.round(value / 5) * 5;
    const start = snap(startMinute);
    const end = endMinute === undefined
      ? Math.min(1439, start + prefs.defaultDuration)
      : Math.max(start + 5, snap(endMinute));
    ui.openSchedule({
      date,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
    });
  }

  return (
    <>
      <div className="v-page">
        <header className="v-day-head">
          <div className="v-day-head-main">
            <div className="v-day-date">
              <h1>
                <button type="button" className="v-day-date-btn" onClick={() => setPickerOpen(true)} aria-label="选择日期">
                  {monthDay(date)}
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </h1>
              <span className="v-day-weekday">{weekdayName(date)}</span>
              {showToday && <span className="v-today-tag">今天</span>}
            </div>
            <p className="v-page-sub">
              {blocks.length
                ? `${blocks.length} 段日程${completed ? ` · ${completed} 段已完成` : ''}`
                : '还没有安排，留一点空白也很好'}
              {todaysCourses.length ? ` · ${todaysCourses.length} 门课` : ''}
            </p>
          </div>
          <div className="v-day-actions">
            <div className="v-day-nav">
              <button type="button" aria-label="前一天" onClick={() => setDate(shiftDate(date, -1))}>
                <ChevronLeft size={17} />
              </button>
              {!showToday && (
                <button type="button" className="v-day-today" onClick={() => setDate(todayKey())}>今天</button>
              )}
              <button type="button" aria-label="后一天" onClick={() => setDate(shiftDate(date, 1))}>
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </header>

        <div className="v-course-strip" aria-label="今日课程">
          {todaysCourses.length ? todaysCourses.map(course => (
            <button
              key={`${course.id}-${course.startTime}`}
              type="button"
              className="v-course-chip"
              title={`${course.name} · ${course.location || '地点未填'}`}
              onClick={() => setCourseDetail(course)}
            >
              <span className="v-course-chip-time">{course.startTime}</span>
              <span className="v-course-chip-name">{course.name}</span>
            </button>
          )) : (
            <button type="button" className="v-course-chip v-course-chip--action" onClick={() => setImportOpen(true)}>
              <BookOpen size={14} />
              <span className="v-course-chip-name">{loadingCourses ? '正在读取…' : '导入课表'}</span>
            </button>
          )}
          <button type="button" className="v-course-chip v-course-chip--action" onClick={() => setWeekOpen(true)}>
            <CalendarDays size={14} />
            <span className="v-course-chip-name">本周</span>
          </button>
          {!!todaysCourses.length && (
            <button type="button" className="v-course-chip v-course-chip--action" onClick={() => setImportOpen(true)}>
              <BookOpen size={14} />
              <span className="v-course-chip-name">导入</span>
            </button>
          )}
        </div>

        <div className="v-day-layout">
          <div className="v-timeline-shell">
            {!loading && !events.length && (
              <div className="v-card" style={{ padding: '13px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--v-accent-soft)', color: 'var(--v-accent)', flex: 'none' }}>
                  <Sparkles size={15} />
                </span>
                <span className="v-tiny" style={{ lineHeight: 1.55 }}>
                  点空白新建；长按后上下拖动，可框出一段时间。
                </span>
              </div>
            )}

            <div className="v-timeline-scroll" ref={scrollRef}>
              <PlanTimeGrid
                className="v-time-grid"
                firstY={0}
                height={GRID_HEIGHT}
                hourTops={hourTops}
                minuteAt={y => {
                  const minute = Math.round((y / HOUR) * 60 / 5) * 5;
                  return Math.max(0, Math.min(1439, minute));
                }}
                onSelect={openBlock}
              >
                {hourTops.map(hour => (
                  <div key={hour} className="v-hour" style={{ top: hour }}>
                    <span className="v-hour-label">{String(hour / HOUR).padStart(2, '0')}:00</span>
                    <span className="v-hour-line" />
                    <span className="v-hour-line v-hour-line--half" style={{ top: HOUR / 2 }} />
                  </div>
                ))}

                {events.map(event => {
                  const top = (event.start / 60) * HOUR;
                  const height = Math.max(event.kind === 'course' ? 28 : 30, ((event.end - event.start) / 60) * HOUR - 2);
                  const laneWidth = `calc((100% - 58px) / ${event.lanes} - 4px)`;
                  const left = `calc(52px + (100% - 58px) * ${event.lane} / ${event.lanes} + 1px)`;
                  if (event.kind === 'course' && event.course) {
                    return (
                      <button
                        key={event.key}
                        type="button"
                        className="v-block v-block--course course-block"
                        style={{ top, height, left, width: laneWidth }}
                        onClick={() => setCourseDetail(event.course!)}
                      >
                        <span className="v-block-time">{event.course.startTime}–{event.course.endTime}</span>
                        <span className="v-block-title">{event.course.name}</span>
                        {event.course.location && height > 54 && <span className="v-block-meta">📍 {event.course.location}</span>}
                      </button>
                    );
                  }
                  const block = event.block!;
                  return (
                    <button
                      key={event.key}
                      type="button"
                      className={`v-block time-block ${block.completed ? 'v-block--done' : ''}`}
                      style={{ top, height, left, width: laneWidth }}
                      onClick={() => ui.openSchedule({ date, block })}
                    >
                      <span className="v-block-time">{block.startTime}–{block.endTime}</span>
                      <span className="v-block-title">{block.taskTitle || '未命名日程'}</span>
                      {block.plannedContent && height > 62 && <span className="v-block-meta">{block.plannedContent}</span>}
                      {block.completed && <span className="v-block-check"><Check size={10} /> 已完成</span>}
                    </button>
                  );
                })}

                {showToday && (
                  <div className="v-now-line" style={{ top: (nowMinutes / 60) * HOUR }} aria-hidden="true" />
                )}
              </PlanTimeGrid>
            </div>
          </div>

          <aside className="v-rail">
            <section className="v-card">
              <div className="v-card-title">
                <h3><GraduationCap size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />今日课程</h3>
                <span>{todaysCourses.length ? `${todaysCourses.length} 门` : '无课'}</span>
              </div>
              {todaysCourses.length ? todaysCourses.map(course => (
                <button
                  key={`${course.id}-${course.startTime}`}
                  type="button"
                  className="v-rail-course"
                  style={{ background: 'transparent', border: 0, borderTop: '1px solid var(--v-separator)', textAlign: 'left', width: '100%', cursor: 'pointer' }}
                  onClick={() => setCourseDetail(course)}
                >
                  <span className="v-rail-course-time">{course.startTime}<br />{course.endTime}</span>
                  <span>
                    <span className="v-rail-course-name">{course.name}</span>
                    <span className="v-rail-course-loc">{course.location || '地点未填'}</span>
                  </span>
                </button>
              )) : (
                <button type="button" className="v-btn v-btn--soft v-btn--sm" style={{ width: '100%', marginBottom: 6 }} onClick={() => setImportOpen(true)}>
                  <Plus size={14} /> 导入课表
                </button>
              )}
              {!!courses.length && (
                <button type="button" className="v-btn v-btn--ghost v-btn--sm v-rail-more" onClick={() => setWeekOpen(true)}>
                  本周课表 <ChevronRight size={14} />
                </button>
              )}
            </section>

            <section className="v-card">
              <div className="v-rail-stat">
                <strong>{activeTasks.length}</strong>
                <span>项待办未完成</span>
              </div>
              {activeTasks.slice(0, 3).map(leaf => (
                <button
                  key={leaf.key}
                  type="button"
                  className="v-rail-todo"
                  style={{ background: 'transparent', border: 0, textAlign: 'left', width: '100%', cursor: 'pointer' }}
                  onClick={ui.openTodo}
                >
                  <span className="v-rail-todo-dot" />
                  <span className="v-rail-todo-label">{leaf.label}</span>
                </button>
              ))}
              <button type="button" className="v-btn v-btn--ghost v-btn--sm v-rail-more" onClick={ui.openTodo}>
                打开待办 <ChevronRight size={14} />
              </button>
            </section>

            <section className="v-card">
              <div className="v-card-title">
                <h3>最近卡片</h3>
                <button type="button" className="v-btn v-btn--ghost v-btn--sm" style={{ height: 26, padding: '0 6px' }} onClick={() => navigate('/cards')}>
                  全部 <ChevronRight size={13} />
                </button>
              </div>
              {recentCards.length ? recentCards.map(card => {
                const meta = typeMeta(card.type);
                return (
                  <button key={card.id} type="button" className="v-recent" onClick={() => ui.openCardDetail(card.id)}>
                    <span className="v-recent-dot" style={{ background: meta.color }} />
                    <span className="v-recent-title">{cardTitle(card)}</span>
                    <span className="v-recent-date">{dateGroupLabel(cardDateKey(card.createdAt))}</span>
                  </button>
                );
              }) : (
                <button type="button" className="v-btn v-btn--soft v-btn--sm" style={{ width: '100%' }} onClick={() => navigate('/cards')}>
                  <Plus size={14} /> 记一张卡片
                </button>
              )}
            </section>
          </aside>
        </div>
      </div>

      <CourseImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      <WeekTimetableSheet
        open={weekOpen}
        onClose={() => setWeekOpen(false)}
        courses={courses}
        semester={semester}
        onCourse={course => { setWeekOpen(false); setCourseDetail(course); }}
        onImport={() => { setWeekOpen(false); setImportOpen(true); }}
      />
      <DatePickerSheet
        open={pickerOpen}
        date={date}
        planDates={planDates}
        onSelect={setDate}
        onClose={() => setPickerOpen(false)}
      />
      <CourseDetailSheet
        open={!!courseDetail}
        course={courseDetail}
        onClose={() => setCourseDetail(null)}
      />
    </>
  );
}
