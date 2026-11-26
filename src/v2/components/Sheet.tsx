import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type SheetSize = 'default' | 'wide' | 'full' | 'center';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: SheetSize;
  bodyClassName?: string;
  closeLabel?: string;
  /** Prevent closing while saving. */
  busy?: boolean;
}

let lockCount = 0;
let previousOverflow = '';

function lockBody(): void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function unlockBody(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = previousOverflow;
}

const SETTLE = 240;
/** Only the top-most open sheet reacts to Escape / Tab trapping. */
const sheetStack: symbol[] = [];

export default function Sheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
  footer,
  size = 'default',
  bodyClassName,
  closeLabel = '关闭',
  busy = false,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const token = useRef(Symbol());
  const [drag, setDrag] = useState(0);
  const [settling, setSettling] = useState(false);
  const dragRef = useRef<{ id: number; startY: number; lastY: number; time: number; velocity: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    lockBody();
    sheetStack.push(token.current);
    return () => {
      const index = sheetStack.indexOf(token.current);
      if (index >= 0) sheetStack.splice(index, 1);
      unlockBody();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== token.current) return;
      if (event.key === 'Escape') {
        if (busy) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open) {
      setDrag(0);
      setSettling(false);
      dragRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      const input = panel.current?.querySelector<HTMLElement>('input, textarea, [data-autofocus]');
      if (input) input.focus({ preventScroll: true });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy) return;
    dragRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      time: performance.now(),
      velocity: 0,
    };
    setSettling(false);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* older webviews */ }
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.id !== event.pointerId) return;
    const now = performance.now();
    const delta = event.clientY - state.lastY;
    if (now > state.time) state.velocity = delta / (now - state.time);
    state.lastY = event.clientY;
    state.time = now;
    setDrag(Math.max(0, event.clientY - state.startY));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.id !== event.pointerId) return;
    dragRef.current = null;
    const distance = Math.max(0, event.clientY - state.startY);
    const fast = state.velocity > 0.65;
    setSettling(true);
    if (distance > 120 || (fast && distance > 36)) {
      setDrag(Math.max(distance, 160));
      window.setTimeout(onClose, SETTLE);
    } else {
      setDrag(0);
      window.setTimeout(() => setSettling(false), SETTLE);
    }
  }

  const panelStyle = drag > 0
    ? { transform: `translateY(${drag}px)`, transition: settling ? `transform ${SETTLE}ms var(--v-spring)` : 'none' }
    : undefined;

  const sizeClass = size === 'default' ? '' : ` v-sheet--${size}`;
  const wrapClass = size === 'center' ? 'v-sheet-wrap v-sheet-wrap--center' : 'v-sheet-wrap';

  return createPortal(
    <>
      <div className="v-sheet-backdrop" onClick={busy ? undefined : onClose} />
      <div className={wrapClass} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <div
          ref={panel}
          className={`v-sheet${sizeClass}`}
          style={panelStyle}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
        >
          <div className="v-sheet-grip" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
          {(title || actions) && (
            <header className="v-sheet-head">
              <div className="v-grow">
                {title && <h2 id={titleId}>{title}</h2>}
                {subtitle && <p className="v-sheet-sub">{subtitle}</p>}
              </div>
              {actions}
              <button type="button" className="v-iconbtn v-sheet-close" aria-label={closeLabel} onClick={onClose} disabled={busy}>
                <X size={18} />
              </button>
            </header>
          )}
          <div className={`v-sheet-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
          {footer && <footer className="v-sheet-foot">{footer}</footer>}
        </div>
      </div>
    </>,
    document.body,
  );
}
