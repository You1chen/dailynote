import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { CORE_FEATURES } from '../content/coreFeatures';
import FeatureArt from './HelpArt';
import './HelpDialog.css';

export type HelpVariant = 'help' | 'welcome';

interface Props {
  open: boolean;
  variant?: HelpVariant;
  onClose: () => void;
}

const SWIPE_PAGES = [
  { arrow: '→', title: '从左向右滑', text: '打开导航。搜索、记事、回忆，以及事项信息、规划、数据都在这里。' },
  { arrow: '←', title: '从右向左滑', text: '在主页新建一张卡片。写完保存，会自动回到原来的页面。' },
  { arrow: '↔', title: '反向滑动', text: '关闭导航或回到主页。进入事项信息等子页后，向左滑只回到上一级。' },
  { arrow: '↕', title: '上下滑动', text: '滚动时间轴。要选一个时段，先长按空白处，再上下拖动。' },
];

const PAGE_COUNT = CORE_FEATURES.length + 1;

/** Exposed for tests: the footer action changes on the last page. */
export function helpPrimaryLabel(page: number, variant: HelpVariant): string {
  if (page < PAGE_COUNT - 1) return '下一页';
  return variant === 'welcome' ? '开始使用' : '完成';
}

/** 帮助与新手引导共用的居中弹窗：左滑右滑翻页，每页一个核心功能。 */
export default function HelpDialog({ open, variant = 'help', onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pager = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; id: number } | null>(null);
  const dragged = useRef(false);
  const [page, setPage] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!open) { setPage(0); setOffset(0); gesture.current = null; }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog || dialog.open) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  useRegisterBackHandler(() => { onClose(); return true; }, [onClose]);

  // The browser otherwise treats a horizontal drag as history navigation and
  // cancels the pointer stream, so claim horizontal moves before that happens.
  useEffect(() => {
    const node = pager.current;
    if (!open || !node) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch || event.touches.length !== 1) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) && event.cancelable) event.preventDefault();
    };
    const end = () => { start = null; };
    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', end);
    node.addEventListener('touchcancel', end);
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
    };
  }, [open]);

  if (!open) return null;

  const last = PAGE_COUNT - 1;
  const go = (next: number) => setPage(Math.max(0, Math.min(last, next)));
  const move = (direction: 1 | -1) => {
    setOffset(0);
    go(page + direction);
  };

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    gesture.current = { x: event.clientX, id: event.pointerId };
    dragged.current = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* older WebViews */ }
  }

  function dragPage(event: ReactPointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (!dragged.current && Math.abs(dx) < 6) return;
    dragged.current = true;
    const edge = (page === 0 && dx > 0) || (page === last && dx < 0);
    setOffset(edge ? dx * 0.28 : dx);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    const dx = event.clientX - start.x;
    setOffset(0);
    if (!dragged.current) return;
    dragged.current = false;
    if (dx <= -48) move(1);
    else if (dx >= 48) move(-1);
  }

  const title = variant === 'welcome' ? '欢迎使用 DailyNote' : '帮助';

  return (
    <dialog
      ref={dialogRef}
      className="help-dialog"
      aria-labelledby="help-dialog-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      }}
    >
      <header className="help-dialog-head">
        <div>
          <p className="help-dialog-eyebrow">{variant === 'welcome' ? '新手引导' : '使用说明'}</p>
          <h2 id="help-dialog-title">{title}</h2>
        </div>
        <button type="button" className="help-dialog-close" aria-label="关闭" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>

      <div
        className="help-pager"
        ref={pager}
        onPointerDown={startDrag}
        onPointerMove={dragPage}
        onPointerUp={endDrag}
        onPointerCancel={() => { gesture.current = null; dragged.current = false; setOffset(0); }}
        onLostPointerCapture={() => { gesture.current = null; setOffset(0); }}
      >
        <div className={`help-track${offset !== 0 ? ' help-track--dragging' : ''}`}
          style={{ transform: `translateX(calc(${-page * 100}% + ${offset}px))` }}>
          <section className="help-page-panel" aria-label="滑动与手势" aria-hidden={page !== 0}>
            <p className="help-page-kicker">先记住四个滑动</p>
            <ul className="help-swipe-list">
              {SWIPE_PAGES.map(({ arrow, title: label, text }) => (
                <li key={label}>
                  <span className="help-swipe-arrow" aria-hidden="true">{arrow}</span>
                  <div><strong>{label}</strong><p>{text}</p></div>
                </li>
              ))}
            </ul>
            <p className="help-page-foot">左右滑动翻页，继续看五项功能。</p>
          </section>

          {CORE_FEATURES.map(({ key, label, icon: Icon, summary, steps, gesture: hint }, index) => (
            <section className="help-page-panel" key={key} aria-label={label} aria-hidden={page !== index + 1}>
              <div className="help-page-art"><FeatureArt kind={key} /></div>
              <h3 className="help-page-title"><Icon size={18} aria-hidden="true" />{label}</h3>
              <p className="help-page-summary">{summary}</p>
              <ol className="help-page-steps">
                {steps.map(step => <li key={step}>{step}</li>)}
              </ol>
              <p className="help-page-hint">{hint}</p>
            </section>
          ))}
        </div>
      </div>

      <footer className="help-dialog-foot">
        <div className="help-dots" role="group" aria-label="翻页">
          {Array.from({ length: PAGE_COUNT }, (_, index) => (
            <button
              key={index}
              type="button"
              className={`help-dot${index === page ? ' help-dot--on' : ''}`}
              aria-label={`第 ${index + 1} 页`}
              aria-current={index === page ? 'true' : undefined}
              onClick={() => { setOffset(0); go(index); }}
            />
          ))}
        </div>
        <div className="help-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {variant === 'welcome' ? '跳过' : '关闭'}
          </button>
          <div className="help-dialog-move">
            <button type="button" className="btn btn-ghost btn-icon" aria-label="上一页" disabled={page === 0} onClick={() => move(-1)}>
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-primary" onClick={() => (page < last ? move(1) : onClose())}>
              {helpPrimaryLabel(page, variant)}
            </button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="下一页" disabled={page === last} onClick={() => move(1)}>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </footer>
    </dialog>
  );
}
