import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Maximize2, Settings } from 'lucide-react';
import DayNavigator from './DayNavigator';
import type { TimeBlock } from '../types';
import type { UserPreferences } from '../hooks/usePreferences';
import { timeToMinutes, isInSleepPeriod, sleepLabel, gridClickY, blockRenderRect } from '../utils/time';
import './FullscreenSchedule.css';

interface Props {
  visible: boolean;
  date: string;
  blocks: TimeBlock[];
  prefs: UserPreferences;
  onDateChange: (d: string) => void;
  onBlockClick: (block: TimeBlock) => void;
  onGridClick: (startTime: string) => void;
  onPrefsClick: () => void;
  onClose: () => void;
}

export default function FullscreenSchedule({
  visible, date, blocks, prefs,
  onDateChange, onBlockClick, onGridClick, onPrefsClick, onClose,
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
  const visibleHours = hideSleep ? 24 - Math.round(sleepDurationMin / 60) : 24;

  const gridHeight = visibleHours * hourHeight + (hideSleep ? 28 : 0); // 28px for collapsed bar

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
  const isToday = date === new Date().toISOString().slice(0, 10);
  const showNowLine = isToday && !(hideSleep && isInSleepPeriod(nowMinutes, sleepStart, sleepEnd));

  // 将实际分钟映射到网格 top 位置
  function minutesToTop(minutes: number): number {
    if (!hideSleep) return (minutes / 60) * hourHeight;

    const s = timeToMinutes(sleepStart);
    const e = timeToMinutes(sleepEnd);

    if (sleepCrosses) {
      // 跨夜：睡眠 23:00-07:00，可见 07:00-23:00
      if (minutes >= e && minutes < s) {
        // 在可见范围内（07:00-23:00）
        return ((minutes - e) / 60) * hourHeight + 28; // +28 弥补顶部睡眠条的偏移
      } else {
        return -1; // 在睡眠时段
      }
    } else {
      // 不跨夜：睡眠在中间（罕见）
      if (minutes < s) {
        return (minutes / 60) * hourHeight + 28;
      } else if (minutes >= e) {
        return ((minutes - (e - s)) / 60) * hourHeight + 28;
      } else {
        return -1; // 在睡眠时段
      }
    }
  }

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.fs-time-block')) return;
    if ((e.target as HTMLElement).closest('.fs-sleep-bar')) return;

    // 滚动容器（.fs-grid-container）的 rect.top 不随内部滚动变化；
    // 若取 e.currentTarget（.fs-grid）的 rect.top，会随滚动偏移，再加 scrollTop 会双重补偿
    const rect = scrollRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = gridClickY(e.clientY, rect.top, scrollRef.current?.scrollTop ?? 0);

    // 精确逆映射：minutesToTop 的反函数
    let actualMinutes: number;
    if (hideSleep) {
      const adjustedY = y - 28;
      if (adjustedY < 0) return; // 点击在折叠条上

      if (sleepCrosses) {
        // 跨夜：逆公式 visualMinutes = adjustedY * 60 / hourHeight, 然后 + eMin
        actualMinutes = (adjustedY * 60) / hourHeight + eMin;
        if (actualMinutes >= 1440) actualMinutes -= 1440;
        // 边界保护：不超过 sleepStart
        if (actualMinutes >= sMin) actualMinutes = sMin - 5;
      } else {
        // 不跨夜：压缩空间中 >= sMin 意味着已越过睡眠间隙
        actualMinutes = (adjustedY * 60) / hourHeight;
        if (actualMinutes >= sMin) actualMinutes += sleepDurationMin;
      }
    } else {
      actualMinutes = (y * 60) / hourHeight;
    }

    actualMinutes = Math.max(0, Math.min(1430, Math.round(actualMinutes / 5) * 5));
    onGridClick(
      `${String(Math.floor(actualMinutes / 60)).padStart(2, '0')}:${String(actualMinutes % 60).padStart(2, '0')}`
    );
  }

  // 生成可见的小时标签
  function getVisibleHourLabels(): { hour: number; top: number }[] {
    const labels: { hour: number; top: number }[] = [];
    if (!hideSleep) {
      for (let h = 0; h < 24; h++) {
        labels.push({ hour: h, top: h * hourHeight });
      }
    } else {
      // 从 sleepEnd 开始，到 sleepStart 结束
      const seH = Math.floor(eMin / 60);
      const ssH = Math.floor(sMin / 60);
      let offset = 28; // 折叠条高度
      if (sleepCrosses) {
        // e.g., 07:00-23:00
        let h = seH;
        let visualH = 0;
        while (h !== ssH || visualH === 0) {
          labels.push({ hour: h, top: offset + visualH * hourHeight });
          h = (h + 1) % 24;
          visualH++;
        }
      } else {
        // e.g., sleep at 03:00-06:00
        for (let h = 0; h < 24; h++) {
          if (h >= sMin / 60 && h < eMin / 60) continue; // skip sleep
          const adjustedH = h >= eMin / 60 ? h - Math.round(sleepDurationMin / 60) : h;
          labels.push({ hour: h, top: offset + adjustedH * hourHeight });
        }
      }
    }
    return labels;
  }

  const hourLabels = getVisibleHourLabels();

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
          <div className="fs-grid" style={{ height: gridHeight }} onClick={handleGridClick}>
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

            {/* 时间块 */}
            {blocks.map(block => {
              const rect = blockRenderRect(block.startTime, block.endTime, {
                hideSleep,
                sleepStart,
                sleepEnd,
                hourHeight,
                barHeight: 28,
                gridHeight,
              });
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
                      {block.taskTitle || '点击编辑...'}
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
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
