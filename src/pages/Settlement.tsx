import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { todayStr } from '../types';
import { getStore } from '../services/store';
import { buildSettlement, posterFromSettlement } from '../utils/settlement';
import { layoutSettlementPoster, renderSettlementPoster, type PosterData } from '../utils/settlementPoster';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import './Settlement.css';

function PosterCanvas({ data, index, ratio }: { data: PosterData; index: number; ratio: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      try { renderSettlementPoster(canvas, data, index); setError(false); }
      catch { setError(true); }
    };
    if (typeof IntersectionObserver === 'undefined') { paint(); return; }
    // 长海报只保留视口附近的画布像素，避免大量目标同时占满 WebView 内存。
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) paint();
      else { canvas.width = 1; canvas.height = 1; }
    }, { rootMargin: '800px' });
    observer.observe(canvas);
    return () => { observer.disconnect(); canvas.width = 1; canvas.height = 1; };
  }, [data, index]);
  return <div className="settlement-poster-page" style={{ aspectRatio: ratio }}>
    <canvas ref={ref} className="settlement-canvas" role="img" aria-label={`今日结算海报，第 ${index + 1} 页`} />
    {error && <p role="alert">海报暂时无法绘制，请查看下方文字明细。</p>}
  </div>;
}

export default function SettlementPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(() => buildSettlement(getStore().activityEvents, todayStr()));
  const close = () => navigate('/');
  useRegisterBackHandler(() => { close(); return true; }, [navigate]);
  useEffect(() => {
    const refresh = () => setSummary(buildSettlement(getStore().activityEvents, todayStr()));
    window.addEventListener('dailynote-activity-changed', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('dailynote-activity-changed', refresh);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, []);
  const data = useMemo(() => posterFromSettlement(summary), [summary]);
  const layout = useMemo(() => layoutSettlementPoster(data), [data]);
  return <main className="settlement-page" aria-label="今日结算">
    <header className="settlement-toolbar">
      <button type="button" onClick={close} aria-label="返回计划"><ArrowLeft size={19} />返回</button>
      <span>今日结算</span>
      <span className="settlement-date">{summary.date.slice(5).replace('-', ' / ')}</span>
    </header>
    <div className="settlement-scroll">
      <div className="settlement-posters">
        {layout.pages.map((page, index) => <PosterCanvas key={index} data={data} index={index} ratio={page.width / page.height} />)}
      </div>
      <p className="settlement-note">结算从本版开始记录每一次实际操作，进度按当天净变化；更早的操作没有时间戳可查，不补算。</p>
      <details className="settlement-accessible">
        <summary>查看文字明细</summary>
        {data.sections.length ? data.sections.map(section => <section key={section.title}>
          <h2>{section.title}</h2>
          <ul>{section.items.map((item, index) => <li key={index}>{item.label}：{item.value}{item.detail ? `（${item.detail}）` : ''}</li>)}</ul>
        </section>) : <p>今天的记录会从下一次行动开始积累。</p>}
      </details>
    </div>
  </main>;
}
