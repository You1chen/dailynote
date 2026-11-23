import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useRouteBack } from '../hooks/useRouteBack';
import './GroupedPageHeader.css';

const EDGE_WIDTH = 32;
const BACK_DISTANCE = 56;

export default function GroupedPageHeader({ title, children, blocked = false }: {
  title: string;
  children?: ReactNode;
  blocked?: boolean;
}) {
  const back = useRouteBack();
  const header = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = header.current?.parentElement;
    if (!page || blocked) return;
    let origin: { id: number; x: number; y: number } | undefined;
    let claimed = false;

    function start(event: TouchEvent) {
      origin = undefined;
      claimed = false;
      if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
      if (event.target.closest('input, textarea, select, [contenteditable], [aria-modal="true"]')) return;
      const touch = event.touches[0];
      if (touch.clientX > EDGE_WIDTH) return;
      origin = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    }

    function move(event: TouchEvent) {
      if (!origin) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch.identifier !== origin.id || !event.cancelable) {
        cancel();
        return;
      }
      const dx = touch.clientX - origin.x;
      const dy = Math.abs(touch.clientY - origin.y);
      if (!claimed && Math.max(Math.abs(dx), dy) < 8) return;
      if (!claimed && (dx <= 0 || dx < dy * 1.5)) { cancel(); return; }
      claimed = true;
      event.preventDefault();
    }

    function end(event: TouchEvent) {
      const start = origin;
      const touch = start && Array.from(event.changedTouches).find(item => item.identifier === start.id);
      const commit = claimed && start && touch && !event.touches.length
        && touch.clientX - start.x >= Math.max(BACK_DISTANCE, Math.abs(touch.clientY - start.y) * 1.5);
      cancel();
      if (commit) back();
    }

    function cancel() { origin = undefined; claimed = false; }

    page.addEventListener('touchstart', start, { passive: true });
    page.addEventListener('touchmove', move, { passive: false });
    page.addEventListener('touchend', end);
    page.addEventListener('touchcancel', cancel);
    return () => {
      page.removeEventListener('touchstart', start);
      page.removeEventListener('touchmove', move);
      page.removeEventListener('touchend', end);
      page.removeEventListener('touchcancel', cancel);
    };
  }, [back, blocked]);

  return (
    <div className="page-header grouped-page-header" ref={header}>
      <div className="grouped-page-title">
        <button className="btn btn-ghost grouped-page-back" type="button" onClick={back} aria-label="返回">
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1 className="page-title">{title}</h1>
      </div>
      {children}
    </div>
  );
}
