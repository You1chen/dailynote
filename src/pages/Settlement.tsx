import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
    <canvas ref={ref} className="settlement-canvas" role="img" aria-label={`${data.date}结算海报，第 ${index + 1} 页`} />
    {error && <p role="alert">海报暂时无法绘制，请查看下方文字明细。</p>}
  </div>;
}

export default function SettlementPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [today, setToday] = useState(todayStr);
  const requestedDate = params.get('date') ?? '';
  const parsedDate = new Date(`${requestedDate}T00:00:00`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && !Number.isNaN(parsedDate.getTime())
    && `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}` === requestedDate;
  const date = validDate ? requestedDate : today;
  const title = date === today ? '今日结算' : '当日结算';
  const [summary, setSummary] = useState(() => buildSettlement(getStore().activityEvents, date));
  const close = () => navigate(`/?date=${date}`);
  useRegisterBackHandler(() => { close(); return true; }, [navigate, date]);
  useEffect(() => {
    const refresh = () => {
      const currentToday = todayStr();
      setToday(currentToday);
      setSummary(buildSettlement(getStore().activityEvents, validDate ? requestedDate : currentToday));
    };
    refresh();
    window.addEventListener('dailynote-activity-changed', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('dailynote-activity-changed', refresh);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [requestedDate, validDate]);
  const data = useMemo(() => {
    const poster = posterFromSettlement(summary);
    const parsed = new Date(`${date}T00:00:00`);
    const chineseDate = `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日 · 星期${'日一二三四五六'[parsed.getDay()]}`;
    return {
      ...poster,
      date: chineseDate,
      title,
      empty: date === today ? '今日尚无记录' : '当日尚无记录',
      headline: date === today ? poster.headline : poster.headline?.replace('今天', '这一天'),
    };
  }, [summary, title, date, today]);
  const layout = useMemo(() => layoutSettlementPoster(data), [data]);
  return <main className="settlement-page" aria-label={title}>
    <header className="settlement-toolbar">
      <button type="button" onClick={close} aria-label="返回计划"><ArrowLeft size={19} />返回</button>
      <span>{title}</span>
      <input className="settlement-date" type="date" aria-label="结算日期" value={date}
        onChange={event => { if (event.target.value) setParams({ date: event.target.value }); }} />
    </header>
    <div className="settlement-scroll">
      <div className="settlement-posters">
        {layout.pages.map((page, index) => <PosterCanvas key={index} data={data} index={index} ratio={page.width / page.height} />)}
      </div>
      <p className="settlement-note">按所选日期汇总交互；已有数据中带可靠时间戳的记录会自动扫描补充。缺少操作时间的数据不推算，进度按当天净变化。</p>
      <details className="settlement-accessible">
        <summary>查看文字明细</summary>
        {data.sections.length ? data.sections.map(section => <section key={section.title}>
          <h2>{section.title}</h2>
          <ul>{section.items.map((item, index) => <li key={index}>{item.label}：{item.value}{item.detail ? ` · ${item.detail}` : ''}</li>)}</ul>
        </section>) : <p>所选日期暂无可确认的交互记录。</p>}
      </details>
    </div>
  </main>;
}
