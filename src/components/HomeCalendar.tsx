import { useRef, type PointerEvent } from 'react';
import { addDays, addMonths, endOfMonth, format, startOfMonth, startOfWeek } from 'date-fns';
import { todayStr } from '../types';

const WEEK_OPTIONS = { weekStartsOn: 1 } as const;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const TAP_SLOP = 8;
const SWIPE_DISTANCE = 40;
const AXIS_RATIO = 1.5;

interface Props {
  date: string;
  month: string | null;
  planDates: ReadonlySet<string>;
  onDateChange: (date: string) => void;
  onMonthChange: (month: string) => void;
  onClose: () => void;
}

interface SwipeOrigin {
  id: number;
  x: number;
  y: number;
  weekStart?: string;
  day?: string;
}

function localDate(date: string) {
  return new Date(`${date}T00:00:00`);
}

function dateKey(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function weekFrom(monday: Date) {
  return WEEKDAYS.map((_, column) => dateKey(addDays(monday, column)));
}

export default function HomeCalendar({ date, month, planDates, onDateChange, onMonthChange, onClose }: Props) {
  const origin = useRef<SwipeOrigin | null>(null);
  const suppressClick = useRef(false);
  const selected = localDate(date);
  const viewedMonth = month ? startOfMonth(localDate(month)) : null;
  const today = todayStr();
  const rows: string[][] = [];
  if (viewedMonth) {
    const first = startOfWeek(viewedMonth, WEEK_OPTIONS);
    const last = endOfMonth(viewedMonth);
    for (let monday = first; monday <= last; monday = addDays(monday, 7)) {
      rows.push(weekFrom(monday));
    }
  } else {
    rows.push(weekFrom(startOfWeek(selected, WEEK_OPTIONS)));
  }

  function step(direction: -1 | 1) {
    if (viewedMonth) onMonthChange(dateKey(addMonths(viewedMonth, direction)));
    else onDateChange(dateKey(addDays(selected, direction * 7)));
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) {
      if (event.pointerType === 'touch' && origin.current) {
        origin.current = null;
        suppressClick.current = true;
      }
      return;
    }
    if (event.button !== 0) return;
    suppressClick.current = false;
    const target = event.target as Element;
    origin.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      weekStart: target.closest<HTMLElement>('[data-week-start]')?.dataset.weekStart,
      day: target.closest<HTMLElement>('[data-calendar-day]')?.dataset.calendarDay,
    };
  }

  function trackSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = origin.current;
    if (!start || start.id !== event.pointerId) return;
    if (!suppressClick.current && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) {
      suppressClick.current = true;
      // Capture the drag once it leaves tap range, so releasing on a nearby control can't click it.
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function cancelSwipe(event: PointerEvent<HTMLDivElement>) {
    if (origin.current?.id !== event.pointerId) return;
    origin.current = null;
    suppressClick.current = true;
  }

  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = origin.current;
    if (!start || start.id !== event.pointerId) return;
    origin.current = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > TAP_SLOP) suppressClick.current = true;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) >= Math.abs(dy) * AXIS_RATIO) {
      step(dx < 0 ? 1 : -1);
    } else if (Math.abs(dy) >= SWIPE_DISTANCE && Math.abs(dy) >= Math.abs(dx) * AXIS_RATIO) {
      if (dy > 0 && !viewedMonth) onMonthChange(dateKey(startOfMonth(selected)));
      if (dy < 0 && viewedMonth && start.weekStart) {
        const row = rows.find(week => week[0] === start.weekStart);
        if (!row) return;
        // Use the row where the swipe began, even if the finger ends in a different row.
        const monthStart = dateKey(viewedMonth);
        const nextDate = row.includes(date) ? date : start.day ?? (row[0] < monthStart ? monthStart : row[0]);
        if (nextDate !== date) onDateChange(nextDate);
        onClose();
      }
    }
  }

  return (
    <div id="dp-calendar" className={`dp-calendar${viewedMonth ? ' dp-cal' : ''}`}
      role="group" aria-label={viewedMonth ? '月历' : '周历'} data-app-swipe="off"
      onPointerDown={startSwipe} onPointerMove={trackSwipe} onPointerUp={finishSwipe}
      onPointerCancel={cancelSwipe}
      onLostPointerCapture={event => { if (event.target === event.currentTarget) cancelSwipe(event); }}
      onClickCapture={event => {
        if (event.detail > 0 && suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={event => {
        if (viewedMonth && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (!viewedMonth && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          step(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}>
      {viewedMonth && (
        <>
          <div className="dp-cal-nav">
            <button type="button" className="dp-arrow" aria-label="上个月" onClick={() => step(-1)}>‹</button>
            <button type="button" className="dp-cal-title" aria-label="回到今天"
              onClick={() => { onDateChange(today); onClose(); }}>
              {format(viewedMonth, 'yyyy年 M月')}
            </button>
            <button type="button" className="dp-arrow" aria-label="下个月" onClick={() => step(1)}>›</button>
          </div>
          <div className="dp-cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map(day => <span key={day} className="dp-wd-w">{day}</span>)}
          </div>
        </>
      )}
      {rows.map(row => (
        <div key={viewedMonth ? row[0] : 'week'} className={viewedMonth ? 'dp-cal-row' : 'dp-week'} data-week-start={row[0]}>
          {row.map((day, column) => {
            const active = day === date;
            const outsideMonth = month && day.slice(0, 7) !== month.slice(0, 7);
            const dayOfMonth = Number(day.slice(-2));
            return (
              <button key={viewedMonth ? day : column} type="button" data-calendar-day={day}
                className={`dp-wd${active ? ' dp-wd--on' : ''}${outsideMonth ? ' dp-wd--other' : ''}`}
                aria-label={`${day} 周${WEEKDAYS[column]}`} aria-pressed={active}
                aria-current={day === today ? 'date' : undefined}
                onClick={() => { onDateChange(day); if (viewedMonth) onClose(); }}>
                {!viewedMonth && <span className="dp-wd-w">{WEEKDAYS[column]}</span>}
                <span className={`dp-wd-n${day === today && !active ? ' dp-wd-n--today' : ''}`}>{dayOfMonth}</span>
                <span className={`dp-wd-dot${planDates.has(day) ? ' dp-wd-dot--on' : ''}`} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
