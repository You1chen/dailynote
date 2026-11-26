import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Maximize2, Settings } from 'lucide-react';
import PlanTimeGrid from './PlanTimeGrid';
import DayNavigator from './DayNavigator';
import { todayStr, type TimeBlock, type Course } from '../types';
import type { UserPreferences } from '../hooks/usePreferences';
import { timeToMinutes, isInSleepPeriod, sleepLabel, topToMinutes, minutesToTop as dayMinutesToTop, blockRenderRect } from '../utils/time';
import './FullscreenSchedule.css';

interface Props {
  visible: boolean;
  date: string;
  blocks: TimeBlock[];
  prefs: UserPreferences;
  onDateChange: (d: string) => void;
  onBlockClick: (block: TimeBlock) => void;
  onGridSelect: (start: number, end?: number) => void;
  onPrefsClick: () => void;
  onClose: () => void;
  /** 当天课程（只读展示，调用方用 computeDayCourses 算好传入） */
  courses?: Course[];
  onCourseClick?: (course: Course) => void;
}

export default function FullscreenSchedule({
  visible, date, blocks, prefs,
  onDateChange, onBlockClick, onGridSelect, onPrefsClick, onClose,
  courses, onCourseClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hourHeight = prefs.hourHeight;
  const hideSleep = prefs.hideSleepHours;
  const sleepStart = prefs.sleepStart;
  const sleepEnd = prefs.sleepEnd;

  const nowMinutes = (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  // 计算可见小时
  const sMin = timeToMinutes(sleepStart);
  const eMin = timeToMinutes(sleepEnd);
  const sleepCrosses = eMin < sMin;
  const sleepDurationMin = sleepCrosses ? (1440 - sMin) + eMin : eMin - sMin;
  const barHeight = hideSleep ? 28 : 0;
  const gridHeight = ((1440 - (hideSleep ? sleepDurationMin : 0)) / 60) * hourHeight + barHeight;
  const geometry = { hideSleep, sleepStart, sleepEnd, hourHeight, barHeight, gridHeight };

  // 自动滚动到当前时间（使用 minutesToTop 正确映射睡眠偏移）
  useEffect(() => {
    if (visible && scrollRef.current) {
      const top = minutesToTop(nowMinutes);
      if (top < 0) {
        // 当前时刻在折叠睡眠时段内：即时任务贴对应边界显示，滚到该边界
        // 23:00-24:00 贴网格底部，00:00-07:00（及不跨夜）贴顶部
        const pinBottom = sleepCrosses && nowMinutes >= sMin;
        scrollRef.current.scrollTop = pinBottom ? scrollRef.current.scrollHeight : 0;
      } else if (top > 0) {
        scrollRef.current.scrollTop = Math.max(0, top - 200);
      }
    }
  }, [visible, date]);

  // 判断是否在今天且在睡眠时段
  const isToday = date === todayStr();
  const showNowLine = isToday && !(hideSleep && isInSleepPeriod(nowMinutes, sleepStart, sleepEnd));

  function minutesToTop(minute: number) {
    return dayMinutesToTop(minute, geometry);
  }

  function gridMinute(y: number, endBoundary = false) {
    if (hideSleep && sleepCrosses && y >= gridHeight - 0.01) return sMin;
    if (hideSleep && !sleepCrosses && endBoundary && Math.abs(y - (barHeight + sMin * hourHeight / 60)) < 0.01) return sMin;
    return topToMinutes(y, geometry) ?? 0;
  }

  const hourLabels = Array.from({ length: 24 }, (_, hour) => ({ hour, top: minutesToTop(hour * 60) }))
    .filter(label => label.top >= 0);

  if (!visible) return null;

  return createPortal(
    <div className="fs-overlay">
      <div className="fs-container">
        {/* 顶栏 */}
        <div className="fs-topbar">
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={22} />
          </button>
          <DayNavigator date={date} onDateChange={onDateChange} compact />
          <button className="btn btn-ghost btn-icon" onClick={onPrefsClick}>
            <Settings size={20} />
          </button>
        </div>

        {/* 时间网格 */}
        <div className="fs-grid-container" ref={scrollRef}>
          <PlanTimeGrid className="fs-grid" firstY={barHeight} height={gridHeight}
            hourTops={hourLabels.map(label => label.top)} minuteAt={gridMinute} onSelect={onGridSelect}>
            {/* 睡眠折叠条 */}
            {hideSleep && (
              <div
                className="fs-sleep-bar"
                style={{ top: 0, height: 24 }}
                onClick={onPrefsClick}
              >
                <span className="fs-sleep-bar-text">
                  😴 睡眠时间 · {sleepLabel(sleepStart, sleepEnd)}
                </span>
              </div>
            )}

            {/* 小时标签 */}
            {hourLabels.map(({ hour, top }) => (
              <div key={hour} className="fs-hour-row" style={{ top, height: hourHeight }}>
                <span className="fs-hour-label">
                  {String(hour).padStart(2, '0')}:00
                </span>
                <div className="fs-hour-line" />
              </div>
            ))}

            {/* 课程块（只读展示，z-index 低于任务块） */}
            {(courses ?? []).map(course => {
              const rect = blockRenderRect(course.startTime, course.endTime, geometry);
              if (!rect) return null;
              const { top, height } = rect;
              return (
                <div
                  key={`fs-course-${course.id}`}
                  className="fs-course-block"
                  style={{ top, height, left: 52, right: 4 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCourseClick?.(course);
                  }}
                >
                  <div className="fs-course-block-inner">
                    <span className="fs-course-block-time">
                      {course.startTime}-{course.endTime}
                    </span>
                    <span className="fs-course-block-name">{course.name}</span>
                    {course.location && (
                      <span className="fs-course-block-loc">📍 {course.location}</span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 时间块 */}
            {blocks.map(block => {
              const rect = blockRenderRect(block.startTime, block.endTime, geometry);
              if (!rect) return null;
              const { top, height } = rect;
              const isDone = block.completed;
              const clDone = block.checklist?.filter(c => c.done).length ?? 0;
              const clTotal = block.checklist?.length ?? 0;

              return (
                <div
                  key={block.id}
                  className={`fs-time-block ${isDone ? 'fs-time-block--done' : ''} ${!block.taskTitle ? 'fs-time-block--empty' : ''}`}
                  style={{ top, height, left: 52, right: 4 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onBlockClick({ ...block, checklist: block.checklist || [] });
                  }}
                >
                  <div className="fs-time-block-inner">
                    <span className="fs-time-block-time">
                      {block.startTime}-{block.endTime}
                    </span>
                    <span className="fs-time-block-title">
                      {block.taskTitle}
                    </span>
                    {clTotal > 0 && (
                      <span className="fs-time-block-meta">
                        ☑ {clDone}/{clTotal}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 当前时间线 */}
            {showNowLine && (() => {
              const top = minutesToTop(nowMinutes);
              if (top < 0) return null;
              return (
                <div className="fs-now-line" style={{ top }}>
                  <div className="fs-now-dot" />
                  <div className="fs-now-bar" />
                </div>
              );
            })()}
          </PlanTimeGrid>
        </div>
      </div>
    </div>,
    document.body
  );
}
