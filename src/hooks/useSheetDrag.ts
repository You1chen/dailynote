import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Bind these handlers to a generously sized handle with touch-action:none. */
export function useSheetDrag(onDismiss: () => void, enabled = true) {
  const start = useRef<{ y: number; id: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reset = () => { start.current = null; setOffset(0); setDragging(false); };
  useEffect(() => { reset(); }, [enabled]);
  return {
    offset, dragging,
    style: { transform: offset ? `translateY(${offset}px)` : undefined, transition: dragging ? 'none' : 'transform .22s ease-out' },
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || !event.isPrimary || event.button !== 0) return;
        start.current = { y: event.clientY, id: event.pointerId };
        setDragging(true);
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Optional on older WebViews. */ }
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        if (start.current?.id !== event.pointerId) return;
        event.preventDefault();
        setOffset(Math.max(0, event.clientY - start.current.y));
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        if (start.current?.id !== event.pointerId) return;
        const distance = event.clientY - start.current.y;
        reset();
        if (distance >= 80) onDismiss();
      },
      onPointerCancel: reset,
      onLostPointerCapture: reset,
    },
  };
}
