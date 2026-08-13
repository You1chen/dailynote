import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { DayStats } from '../types';

interface Props {
  data: DayStats[];
  dataKeys: ('avgFocus' | 'avgEfficiency' | 'completionRate')[];
  title: string;
}

const LABELS: Record<string, string> = {
  avgFocus: '专注度',
  avgEfficiency: '效率',
  completionRate: '完成率',
};

const COLORS: Record<string, string> = {
  avgFocus: '#6366f1',
  avgEfficiency: '#10b981',
  completionRate: '#f59e0b',
};

export default function TrendChart({ data, dataKeys, title }: Props) {
  if (data.length === 0) {
    return (
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 12 }}>{title}</h3>
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <p>暂无数据</p>
        </div>
      </div>
    );
  }

  const chartData = data.map(d => ({
    date: d.date.slice(5), // MM-DD
    avgFocus: d.avgFocus,
    avgEfficiency: d.avgEfficiency,
    completionRate: Math.round(d.completionRate * 100),
  }));

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <h3 className="card-title" style={{ marginBottom: 8 }}>{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            domain={[0, dataKeys[0] === 'completionRate' ? 100 : 10]}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-sm)',
            }}
          />
          <Legend
            formatter={v => LABELS[v] || v}
            wrapperStyle={{ fontSize: 'var(--font-xs)' }}
          />
          {dataKeys.map(key => (
            <Line
              key={key}
              type="monotone"
              dataKey={key === 'completionRate' ? 'completionRate' : key}
              stroke={COLORS[key]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
