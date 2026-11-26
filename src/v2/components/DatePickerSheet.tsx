import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Sheet from './Sheet';
import { todayKey, yearMonth } from '../utils/dates';

interface Props {
  open: boolean;
  date: string;
  planDates?: ReadonlySet<string>;
  onSelect: (date: string) => void;
  onClose: () => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export default function DatePickerSheet({ open, date, planDates, onSelect, onClose }: Props) {
  const [month, setMonth] = useState(() => monthKey(date));

  useEffect(() => {
    if (open) setMonth(monthKey(date));
  }, [open, date]);

  const cells = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00`);
    const leading = (first.getDay() + 6) % 7;
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const list: Array<{ key: string; day?: number; date?: string }> = [];
    for (let index = 0; index < leading; index++) list.push({ key: `blank-${index}` });
    for (let day = 1; day <= days; day++) {
      const value = `${month}-${pad(day)}`;
      list.push({ key: value, day, date: value });
    }
    while (list.length % 7 !== 0) list.push({ key: `tail-${list.length}` });
    return list;
  }, [month]);

  const today = todayKey();
  const monthDate = `${month}-01`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="选择日期"
      subtitle={yearMonth(monthDate)}
      actions={(
        <div className="v-day-nav" style={{ marginRight: 4 }}>
          <button type="button" aria-label="上个月" onClick={() => setMonth(value => shiftMonth(value, -1))}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="下个月" onClick={() => setMonth(value => shiftMonth(value, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      footer={(
        <>
          <button type="button" className="v-btn v-btn--ghost v-grow" onClick={() => { onSelect(today); onClose(); }}>
            回到今天
          </button>
          <button type="button" className="v-btn v-btn--primary" onClick={onClose}>关闭</button>
        </>
      )}
    >
      <div className="v-datepicker-weekdays">
        {['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{`周${day}`}</span>)}
      </div>
      <div className="v-datepicker-grid">
        {cells.map(cell => {
          if (!cell.date) return <span key={cell.key} className="v-datepicker-blank" />;
          const selected = cell.date === date;
          const isToday = cell.date === today;
          const hasPlan = planDates?.has(cell.date);
          return (
            <button
              key={cell.key}
              type="button"
              className={`v-datepicker-day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
              aria-current={selected ? 'date' : undefined}
              onClick={() => { onSelect(cell.date!); onClose(); }}
            >
              <span>{cell.day}</span>
              {hasPlan && <i className="v-datepicker-dot" />}
            </button>
          );
        })}
      </div>
      <p className="v-tiny" style={{ textAlign: 'center', marginTop: 12 }}>
        有蓝点的是已经写过日程的日期
      </p>
    </Sheet>
  );
}
