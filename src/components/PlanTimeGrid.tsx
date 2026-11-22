import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { minutesToTime } from '../utils/time';
import { blockAppSwipeForCurrentTouch, isAppSwipeClaimed } from '../hooks/useAppSwipe';

const TAP_SLOP = 7;
const RANGE_SLOP = 12;
const TOUCH_HOLD_MS = 320;
const INTERACTIVE = '.time-block, .course-block, .sleep-bar, .future-bar, .fs-time-block, .fs-course-block, .fs-sleep-bar';

interface Props {
  className: string;
  firstY: number;
  height: number;
  hourTops: number[];
  minuteAt: (y: number, endBoundary?: boolean) => number;
  onSelect: (start: number, end?: number) => void;
  children: ReactNode;
}

interface GridGesture {
  pointerId: number;
  clientX: number;
  clientY: number;
  y: number;
  startedAt: number;
  touch: boolean;
  canSelect: boolean;
  mode: 'pending' | 'range' | 'scroll' | 'ignored';
  scroller: HTMLElement | null;
  scrollTop: number;
}

export default function PlanTimeGrid({ className, firstY, height, hourTops, minuteAt, onSelect, children }: Props) {
  const gesture = useRef<GridGesture | null>(null);
  const [selection, setSelection] = useState<{ top: number; height: number } | null>(null);
  const suppressClick = useRef(false);
  const slotTops = [firstY, ...hourTops.filter(top => top > firstY && top < height)];

  function eventY(event: { clientY: number; currentTarget: HTMLDivElement }) {
    return event.clientY - event.currentTarget.getBoundingClientRect().top;
  }

  function startSelection(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    const target = event.target as HTMLElement;
    const touch = event.pointerType === 'touch';
    const y = eventY(event);
    const canSelect = y >= firstY && y <= height && !target.closest(INTERACTIVE)
      && (!touch || !!target.closest('.dp-time-slot'));
    const parent = event.currentTarget.parentElement;
    // Full-screen schedule scrolls locally. The home timeline scrolls the page.
    const scroller = canSelect && touch && parent
      ? parent.scrollHeight > parent.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)
        ? parent
        : (document.scrollingElement as HTMLElement | null)
      : null;
    gesture.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, y,
      startedAt: Date.now(), touch, canSelect, mode: 'pending', scroller, scrollTop: scroller?.scrollTop ?? 0,
    };
  }

  function trackMovement(start: GridGesture, event: PointerEvent<HTMLDivElement>) {
    const dx = event.clientX - start.clientX;
    const dy = event.clientY - start.clientY;
    if (start.mode === 'pending' && Math.hypot(dx, dy) > TAP_SLOP) {
      suppressClick.current = true;
      if ((start.touch && isAppSwipeClaimed()) || Math.abs(dx) >= Math.abs(dy) || !start.canSelect) start.mode = 'ignored';
      else if (start.touch && Date.now() - start.startedAt < TOUCH_HOLD_MS) {
        start.mode = 'scroll';
        blockAppSwipeForCurrentTouch();
      }
      else if (Math.abs(dy) >= RANGE_SLOP) {
        if (start.touch) blockAppSwipeForCurrentTouch();
        else event.currentTarget.setPointerCapture?.(event.pointerId);
        start.mode = 'range';
      }
    }
    if (start.mode === 'scroll' && start.scroller) start.scroller.scrollTop = start.scrollTop - dy;
    return start.mode;
  }

  function moveSelection(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId || trackMovement(start, event) !== 'range') return;
    const y = Math.min(height, Math.max(firstY, eventY(event)));
    setSelection({ top: Math.min(start.y, y), height: Math.abs(y - start.y) });
  }

  function cancelSelection(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    suppressClick.current = true;
    setSelection(null);
  }

  function endSelection(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const mode = trackMovement(start, event);
    gesture.current = null;
    setSelection(null);
    if (start.touch && isAppSwipeClaimed()) {
      suppressClick.current = true;
      return;
    }
    if (mode !== 'range' || Math.abs(start.clientY - event.clientY) < RANGE_SLOP) return;
    const y = Math.min(height, Math.max(firstY, eventY(event)));
    const from = minuteAt(Math.min(start.y, y));
    const to = minuteAt(Math.max(start.y, y), true);
    if (to > from) onSelect(from, to);
  }

  return (
    <div className={`${className} dp-time-grid`} data-tour="time-grid" role="group" aria-label="当天时间轴" style={{ height }}
      onPointerDown={startSelection} onPointerMove={moveSelection} onPointerUp={endSelection}
      onPointerCancel={cancelSelection} onLostPointerCapture={cancelSelection}
      onPointerLeave={event => { if (gesture.current?.mode === 'pending') cancelSelection(event); }}
      onClickCapture={event => {
        if (event.detail && suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClick={event => {
        if (event.detail === 0 || (event.target as HTMLElement).closest(INTERACTIVE)) return;
        const y = eventY(event);
        if (y >= firstY && y <= height) onSelect(minuteAt(y));
      }}>
      {slotTops.map((top, index) => {
        const minute = minuteAt(top);
        return (
          <button key={top} type="button" className="dp-time-slot"
            style={{ top, height: (slotTops[index + 1] ?? height) - top }}
            aria-label={`${minutesToTime(minute)} 新建任务`}
            onContextMenu={event => event.preventDefault()}
            onClick={event => { if (event.detail === 0) onSelect(minute); }} />
        );
      })}
      {selection && <div className="dp-time-selection" aria-hidden="true" style={selection} />}
      {children}
    </div>
  );
}
