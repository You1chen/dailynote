import { useMemo } from 'react';
import Sheet from './Sheet';
import type { Course, SemesterRecord } from '../../types';
import { computeDayCourses } from '../../utils/courseSchedule';
import { weekOf, dateObj, WEEKDAY_CN, monthDay, timeToMinutes } from '../utils/dates';

interface Props {
  open: boolean;
  onClose: () => void;
  courses: Course[];
  semester?: SemesterRecord;
  onCourse?: (course: Course) => void;
  onImport?: () => void;
}

const HOUR = 52;
const DEFAULT_START = 7 * 60;
const DEFAULT_END = 22 * 60;

interface Positioned {
  course: Course;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

function positionCourses(courses: Course[], startMin: number): Positioned[] {
  const sorted = [...courses]
    .map(course => ({
      course,
      start: timeToMinutes(course.startTime),
      end: timeToMinutes(course.endTime),
    }))
    .filter(item => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Positioned[] = [];
  let group: typeof sorted = [];
  let groupEnd = startMin;

  const flush = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const placed = group.map(item => {
      let lane = laneEnds.findIndex(end => end <= item.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = item.end;
      return { ...item, lane };
    });
    const lanes = Math.max(1, laneEnds.length);
    for (const item of placed) {
      out.push({
        course: item.course,
        top: ((item.start - startMin) / 60) * HOUR,
        height: Math.max(22, ((item.end - item.start) / 60) * HOUR),
        lane: item.lane,
        lanes,
      });
    }
    group = [];
    groupEnd = startMin;
  };

  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) flush();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return out;
}

export default function WeekTimetableSheet({ open, onClose, courses, semester, onCourse, onImport }: Props) {
  const today = new Date();
  const dates = useMemo(() => weekOf(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayCourses = useMemo(() => dates.map(date => {
    if (semester?.startDate) return computeDayCourses(courses, semester, date);
    const day = dateObj(date).getDay();
    return courses
      .filter(course => course.dayOfWeek.includes(day))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }), [dates, courses, semester]);

  const all = dayCourses.flat();
  const earliest = all.length ? Math.min(...all.map(course => timeToMinutes(course.startTime))) : DEFAULT_START;
  const latest = all.length ? Math.max(...all.map(course => timeToMinutes(course.endTime))) : DEFAULT_END;
  const startMin = Math.max(0, Math.floor(Math.min(DEFAULT_START, earliest) / 60) * 60);
  const endMin = Math.min(24 * 60, Math.ceil(Math.max(DEFAULT_END, latest) / 60) * 60);
  const height = ((endMin - startMin) / 60) * HOUR;
  const hours = Array.from({ length: Math.floor((endMin - startMin) / 60) + 1 }, (_, index) => startMin / 60 + index);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="本周课表"
      subtitle={`${monthDay(dates[0])} — ${monthDay(dates[6])}${semester?.startDate ? ' · 按学期周次过滤' : ' · 未设置开学日期'}`}
      size="full"
      footer={(
        <>
          <span className="v-tiny v-grow">点课程块查看详情</span>
          {onImport && (
            <button type="button" className="v-btn v-btn--ghost" onClick={() => { onClose(); onImport(); }}>
              导入课表
            </button>
          )}
          <button type="button" className="v-btn v-btn--primary" onClick={onClose}>完成</button>
        </>
      )}
    >
      <div className="v-week-scroll">
        <div className="v-week-grid" style={{ gridTemplateRows: `auto ${height}px` }}>
          <div />
          {dates.map((date, index) => {
            const d = dateObj(date);
            const isToday = date === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            return (
              <div key={date} className={`v-week-day ${isToday ? 'v-week-day--today' : ''}`}>
                周{WEEKDAY_CN[d.getDay()]} {d.getDate()}
              </div>
            );
          })}

          <div style={{ position: 'relative', height }}>
            {hours.map(hour => (
              <div key={hour} className="v-week-hour" style={{ top: (hour - startMin / 60) * HOUR }}>
                <div className="v-week-hour-label">{String(hour).padStart(2, '0')}:00</div>
              </div>
            ))}
          </div>

          {dates.map((date, index) => {
            const positioned = positionCourses(dayCourses[index], startMin);
            return (
              <div key={date} className="v-week-col" style={{ height }}>
                {hours.map(hour => (
                  <div key={hour} className="v-week-hour" style={{ top: (hour - startMin / 60) * HOUR }} />
                ))}
                {positioned.map(({ course, top, height: blockHeight, lane, lanes }) => {
                  const width = `calc(${100 / lanes}% - 4px)`;
                  const left = `calc(${(100 / lanes) * lane}% + 2px)`;
                  return (
                    <button
                      key={`${course.id}-${lane}`}
                      type="button"
                      className="v-week-course"
                      style={{ top, height: blockHeight, left, right: 'auto', width }}
                      onClick={() => onCourse?.(course)}
                      title={`${course.name} ${course.startTime}-${course.endTime}`}
                    >
                      {course.name}
                      {blockHeight > 38 && <><br /><span style={{ opacity: 0.75, fontWeight: 500 }}>{course.startTime}</span></>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
