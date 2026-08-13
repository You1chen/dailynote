import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, Zap, Target, BookOpen, Trash2 } from 'lucide-react';
import CalendarHeatmap from '../components/CalendarHeatmap';
import TrendChart from '../components/TrendChart';
import { useStats } from '../hooks/useStats';
import { useAllReflections } from '../hooks/useReflections';
import './Dashboard.css';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { dayStats, totalReflections, totalHarvests, streak, getRecentDays, monthlyAvgEfficiency } = useStats();
  const allReflections = useAllReflections();

  const recent30Days = useMemo(() => getRecentDays(30), [dayStats]);

  // 反思高频关键词（简单统计）
  const hotProblems = useMemo(() => {
    const words = new Map<string, number>();
    allReflections.forEach(r => {
      if (r.problem) {
        // 简单按词分割
        const segs = r.problem.split(/[，,。.、\s]+/).filter(s => s.length >= 2 && s.length <= 8);
        segs.forEach(s => {
          words.set(s, (words.get(s) || 0) + 1);
        });
      }
    });
    return Array.from(words.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [allReflections]);

  const totalPlans = dayStats.filter(d => d.totalBlocks > 0).length;
  const monthlyEff = monthlyAvgEfficiency();

  return (
    <div className="app-container">
      <div className="page-header">
        <h1 className="page-title">宏观视图</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/trash')} title="回收站">
          <Trash2 size={16} />
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="stats-grid">
        <div className="stat-card stat-card--primary">
          <Flame size={20} />
          <div className="stat-value">{streak}</div>
          <div className="stat-label">连续打卡</div>
        </div>
        <div className="stat-card stat-card--success">
          <Zap size={20} />
          <div className="stat-value">{monthlyEff}</div>
          <div className="stat-label">本月均效率</div>
        </div>
        <div className="stat-card stat-card--warning">
          <Target size={20} />
          <div className="stat-value">{totalPlans}</div>
          <div className="stat-label">有记录天数</div>
        </div>
        <div className="stat-card stat-card--info">
          <BookOpen size={20} />
          <div className="stat-value">{totalReflections}</div>
          <div className="stat-label">反思总数</div>
        </div>
      </div>

      {/* 日历热力图 */}
      <div className="card">
        <h3 className="card-title">打卡热力图（近3月）</h3>
        <CalendarHeatmap stats={dayStats} days={84} />
      </div>

      {/* 趋势图 */}
      <TrendChart data={recent30Days} dataKeys={['avgFocus', 'avgEfficiency']} title="专注与效率趋势（近30天）" />

      <TrendChart data={recent30Days} dataKeys={['completionRate']} title="计划完成率趋势（近30天）" />

      {/* 反思热点 */}
      {hotProblems.length > 0 && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 12 }}>反思高频关键词</h3>
          <div className="hot-tags">
            {hotProblems.map(([word, count]) => (
              <span
                key={word}
                className="hot-tag"
                style={{
                  fontSize: `${Math.max(0.7, Math.min(1.2, 0.7 + count * 0.05))}rem`,
                  opacity: 0.5 + count * 0.05,
                }}
              >
                {word}
                <sup>{count}</sup>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 收获统计 */}
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 8 }}>数据总览</h3>
        <div className="summary-list">
          <div className="summary-item">
            <span>收获记录总数</span>
            <strong>{totalHarvests}</strong>
          </div>
          <div className="summary-item">
            <span>反思记录总数</span>
            <strong>{totalReflections}</strong>
          </div>
          <div className="summary-item">
            <span>有计划的日期</span>
            <strong>{totalPlans} 天</strong>
          </div>
          <div className="summary-item">
            <span>当前连续打卡</span>
            <strong>{streak} 天</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
