import { useEffect, useRef, useState } from 'react';

/** Drag a bottom-sheet grab handle downward to dismiss it. */
export function useSheetDrag(onDismiss: () => void, enabled = true) {
  const start = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const end = (clientY: number) => {
    if (start.current === null) return;
    const distance = Math.max(0, clientY - start.current);
    start.current = null;
    setDragging(false);
    if (distance > 80) { setOffset(0); onDismiss(); }
    else setOffset(0);
  };
  useEffect(() => { if (!enabled) { start.current = null; setOffset(0); setDragging(false); } }, [enabled]);
  return {
    offset,
    dragging,
    style: { transform: offset ? `translateY(${offset}px)` : undefined, transition: dragging ? 'none' : 'transform .22s ease-out' },
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (!enabled) return;
        start.current = event.clientY;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (start.current === null) return;
        setOffset(Math.max(0, event.clientY - start.current));
      },
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => end(event.clientY),
      onPointerCancel: (event: React.PointerEvent<HTMLElement>) => end(event.clientY),
      onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
        if (start.current !== null && event.buttons === 0) end(event.clientY);
      },
    },
  };
}
