import { useMemo } from 'react';
import { format, startOfWeek, addDays, subDays, getDay } from 'date-fns';
import type { DayStats } from '../types';
import './CalendarHeatmap.css';

interface Props {
  stats: DayStats[];
  days?: number;
}

export default function CalendarHeatmap({ stats, days = 84 }: Props) {
  const { weeks, monthLabels } = useMemo(() => {
    const map = new Map(stats.map(s => [s.date, s]));
    const today = new Date();
    const endDate = today;
    const startDate = subDays(today, days - 1);

    // 对齐到周日开始
    const gridStart = startOfWeek(startDate, { weekStartsOn: 0 });
    const gridEnd = endDate;

    const totalDays = Math.ceil((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 1;
    const totalWeeks = Math.ceil(totalDays / 7);

    const weeks: { date: string; score: number; hasData: boolean }[][] = [];
    const monthLabels: { label: string; weekIndex: number }[] = [];
    let lastMonth = '';

    for (let w = 0; w < totalWeeks; w++) {
      const week: { date: string; score: number; hasData: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(gridStart, w * 7 + d);
        const dateStr = format(date, 'yyyy-MM-dd');
        const stat = map.get(dateStr);

        if (date > today) {
          week.push({ date: dateStr, score: -1, hasData: false }); // 未来日期
        } else if (stat && stat.totalBlocks > 0) {
          const score = (stat.avgEfficiency + stat.avgFocus) / 2;
          week.push({ date: dateStr, score, hasData: true });
        } else {
          week.push({ date: dateStr, score: 0, hasData: false }); // 无数据
        }

        // 记录月份标签
        const month = format(date, 'M月');
        if (month !== lastMonth && d <= 3) {
          monthLabels.push({ label: month, weekIndex: w });
          lastMonth = month;
        }
      }
      weeks.push(week);
    }

    return { weeks, monthLabels };
  }, [stats, days]);

  function getColor(score: number, hasData: boolean): string {
    if (score < 0) return 'transparent'; // 未来
    if (!hasData || score === 0) return 'var(--color-border)'; // 无数据
    if (score < 4) return 'var(--color-heatmap-1)';
    if (score < 6) return 'var(--color-heatmap-2)';
    if (score < 8) return 'var(--color-heatmap-3)';
    return 'var(--color-heatmap-4)';
  }

  const dayLabels = ['', '一', '', '三', '', '五', ''];

  return (
    <div className="heatmap-wrapper">
      <div className="heatmap-scroll">
        {/* 月份标签 */}
        <div className="heatmap-months">
          <div className="heatmap-day-labels">
            {dayLabels.map((l, i) => <span key={i}>{l}</span>)}
          </div>
          <div className="heatmap-month-row">
            {monthLabels.map((m, i) => (
              <span
                key={i}
                className="heatmap-month-label"
                style={{ gridColumn: `${m.weekIndex + 1} / span 1` }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div className="heatmap-grid">
          {/* 星期标签列 */}
          <div className="heatmap-day-labels">
            {['', '一', '', '三', '', '五', ''].map((l, i) => (
              <span key={i} className="heatmap-day-label">{l}</span>
            ))}
          </div>

          {/* 格子 */}
          <div className="heatmap-cells">
            {weeks.map((week, wi) => (
              <div key={wi} className="heatmap-week">
                {week.map((day, di) => (
                  <div
                    key={di}
                    className="heatmap-cell"
                    style={{ background: getColor(day.score, day.hasData) }}
                    title={day.score > 0
                      ? `${day.date}\n综合: ${Math.round(day.score * 10) / 10}`
                      : day.score === 0 ? `${day.date}\n无记录` : ''}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 图例 */}
      <div className="heatmap-legend">
        <span className="heatmap-legend-label">少</span>
        <div className="heatmap-cell heatmap-legend-cell" style={{ background: 'var(--color-border)' }} />
        <div className="heatmap-cell heatmap-legend-cell" style={{ background: 'var(--color-heatmap-1)' }} />
        <div className="heatmap-cell heatmap-legend-cell" style={{ background: 'var(--color-heatmap-2)' }} />
        <div className="heatmap-cell heatmap-legend-cell" style={{ background: 'var(--color-heatmap-3)' }} />
        <div className="heatmap-cell heatmap-legend-cell" style={{ background: 'var(--color-heatmap-4)' }} />
        <span className="heatmap-legend-label">多</span>
      </div>
    </div>
  );
}
