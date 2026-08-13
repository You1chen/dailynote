import { useEffect, useState, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, subMonths, addMonths, isSameMonth, isSameDay, isToday,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { getAllPlans } from '../db';
import './DayNavigator.css';

interface Props {
  date: string; // "YYYY-MM-DD"
  onDateChange: (date: string) => void;
  compact?: boolean;
}

export default function DayNavigator({ date, onDateChange, compact }: Props) {
  const selectedDate = new Date(date + 'T00:00:00');
  const [viewMonth, setViewMonth] = useState(startOfMonth(selectedDate));
  const [datesWithPlan, setDatesWithPlan] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载当月哪些日期有计划
  useEffect(() => {
    getAllPlans().then(plans => {
      const monthStart = startOfMonth(viewMonth);
      const monthEnd = endOfMonth(viewMonth);
      const set = new Set<string>();
      plans.forEach(p => {
        if (p.date >= format(monthStart, 'yyyy-MM-dd') && p.date <= format(monthEnd, 'yyyy-MM-dd')) {
          if (p.timeBlocks.length > 0) set.add(p.date);
        }
      });
      setDatesWithPlan(set);
    });
  }, [viewMonth]);

  // 生成日历网格日期
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const weeks: Date[][] = [];
  let current = calStart;
  while (current <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(current);
      current = addDays(current, 1);
    }
    weeks.push(week);
  }

  const prevMonth = () => setViewMonth(subMonths(viewMonth, 1));
  const nextMonth = () => setViewMonth(addMonths(viewMonth, 1));
  const goToday = () => {
    const today = new Date();
    setViewMonth(startOfMonth(today));
    onDateChange(format(today, 'yyyy-MM-dd'));
  };

  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];

  // 紧凑模式：仅显示日期 + 左右箭头
  if (compact) {
    const goPrev = () => {
      const d = new Date(date + 'T00:00:00');
      onDateChange(format(addDays(d, -1), 'yyyy-MM-dd'));
    };
    const goNext = () => {
      const d = new Date(date + 'T00:00:00');
      onDateChange(format(addDays(d, 1), 'yyyy-MM-dd'));
    };
    return (
      <div className="cal-nav cal-nav--compact">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={goPrev}>
          <ChevronLeft size={18} />
        </button>
        <button className="cal-month-title" onClick={goToday}>
          {format(selectedDate, 'yyyy年 M月 d日', { locale: zhCN })}
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={goNext}>
          <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="cal-strip">
      {/* 月份导航 */}
      <div className="cal-nav">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={prevMonth}>
          <ChevronLeft size={18} />
        </button>
        <button className="cal-month-title" onClick={goToday}>
          {format(viewMonth, 'yyyy年 M月', { locale: zhCN })}
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={nextMonth}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 日历网格 */}
      <div className="cal-grid-wrapper" ref={scrollRef}>
        {/* 星期头 */}
        <div className="cal-weekdays">
          {dayLabels.map(d => (
            <span key={d} className="cal-weekday">{d}</span>
          ))}
        </div>

        {/* 日期 */}
        {weeks.map((week, wi) => (
          <div key={wi} className="cal-week">
            {week.map((d, di) => {
              const dateStr = format(d, 'yyyy-MM-dd');
              const isSelected = isSameDay(d, selectedDate);
              const isTodayDate = isToday(d);
              const inMonth = isSameMonth(d, viewMonth);
              const hasPlan = datesWithPlan.has(dateStr);

              return (
                <button
                  key={di}
                  className={`cal-day ${isSelected ? 'cal-day--selected' : ''} ${isTodayDate ? 'cal-day--today' : ''} ${!inMonth ? 'cal-day--other' : ''}`}
                  onClick={() => onDateChange(dateStr)}
                >
                  <span className="cal-day-num">{format(d, 'd')}</span>
                  {hasPlan && <span className={`cal-day-dot ${isSelected ? 'cal-day-dot--sel' : ''}`} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
