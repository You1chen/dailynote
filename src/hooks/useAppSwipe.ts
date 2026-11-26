import { useEffect, useLayoutEffect, useRef } from 'react';

export type SwipeSurface = 'page' | 'home' | 'navigation' | 'quick-note';
export type SwipeAction = 'open-navigation' | 'close-navigation' | 'open-quick-note' | 'close-quick-note';
export interface SwipePreview { action: SwipeAction; distance: number }

type SwipeConfig = {
  surface: SwipeSurface | undefined;
  context: string;
  onPreview: (preview: SwipePreview) => void;
  onRelease: (preview: SwipePreview, commit: boolean) => void;
};

const AXIS_SLOP = 8;
const COMMIT_DISTANCE = 56;
const CLICK_SUPPRESSION_MS = 350;
const EXCLUDED_TARGET = [
  'input', 'textarea', 'select', 'audio', 'video', '[contenteditable]:not([contenteditable="false"])',
  '[data-app-swipe="off"]', '.task-ball', '.tb-mask', '.tb-sheet', '.modal-overlay', '.cd-mask',
  '.course-modal-overlay', '.fs-overlay', '.bs-overlay', '.pref-overlay', '.mind-mask',
  '.kce-add', '.kce[aria-busy="true"]', '.kce-export-backdrop', '.kce-image-menu-backdrop', '.kce-comments',
].join(', ');

function swipeDirection(surface: SwipeSurface, dx: number): SwipeAction | undefined {
  if (surface === 'navigation') return dx < 0 ? 'close-navigation' : undefined;
  if (surface === 'quick-note') return dx > 0 ? 'close-quick-note' : undefined;
  if (dx > 0) return 'open-navigation';
  if (surface === 'home' && dx < 0) return 'open-quick-note';
}

export function appSwipeAction(surface: SwipeSurface, dx: number, dy: number): SwipeAction | undefined {
  if (Math.abs(dx) < COMMIT_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  return swipeDirection(surface, dx);
}

function travel(action: SwipeAction, dx: number) {
  const movesRight = action === 'open-navigation' || action === 'close-quick-note';
  return Math.max(0, movesRight ? dx : -dx);
}

let activeClaim = false;
let reservedForChild = false;
let suppressUntil = 0;

/** Grid touch pointerup may precede touchend, so a claim outlives release briefly. */
export function isAppSwipeClaimed() {
  return activeClaim || Date.now() < suppressUntil;
}

/** A child that has locked an exclusive gesture (e.g. a grid long press) keeps this touch. */
export function blockAppSwipeForCurrentTouch() {
  if (!activeClaim) reservedForChild = true;
}

/** Document capture arbitrates before a bubbling editor or grid gesture can commit. */
export function attachAppSwipe(target: Document, getConfig: () => SwipeConfig) {
  type Origin = { id: number; x: number; y: number; context: string; surface: SwipeSurface; preview?: SwipePreview };
  let origin: Origin | undefined;

  function finish(commit = false) {
    const preview = origin?.preview;
    origin = undefined;
    activeClaim = false;
    if (!preview) return;
    suppressUntil = Date.now() + CLICK_SUPPRESSION_MS;
    getConfig().onRelease(preview, commit);
  }

  function touchStart(event: TouchEvent) {
    if (event.touches.length !== 1) { finish(); return; }
    finish();
    suppressUntil = 0;
    reservedForChild = false;
    const { surface, context } = getConfig();
    if (!surface || !(event.target instanceof Element) || event.target.closest(EXCLUDED_TARGET)) return;
    const modal = event.target.closest('[aria-modal="true"], dialog[open]');
    if (surface === 'quick-note' && !modal?.matches('.kce')) return;
    if (modal && !modal.matches('.side-nav, .kce')) return;
    if (surface !== 'quick-note' && modal?.matches('.kce')) return;
    const touch = event.touches[0];
    origin = { id: touch.identifier, x: touch.clientX, y: touch.clientY, context, surface };
  }

  function touchMove(event: TouchEvent) {
    const start = origin;
    if (!start) return;
    const touch = event.touches[0];
    if (reservedForChild || event.touches.length !== 1 || touch?.identifier !== start.id || start.context !== getConfig().context) {
      finish();
      return;
    }
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const action = start.preview?.action;
    if (!action && Math.abs(dy) > AXIS_SLOP && Math.abs(dy) >= Math.abs(dx)) { finish(); return; }
    if (!action && (Math.abs(dx) < AXIS_SLOP || Math.abs(dx) < Math.abs(dy) * 1.5)) return;
    const direction = action ?? swipeDirection(start.surface, dx);
    if (!direction) { finish(); return; }
    // Once the browser has taken over scrolling, there is nothing for the shell to claim.
    if (!action && !event.cancelable) { finish(); return; }
    if (event.cancelable) event.preventDefault();
    activeClaim = true;
    start.preview = { action: direction, distance: travel(direction, dx) };
    getConfig().onPreview(start.preview);
  }

  function touchEnd(event: TouchEvent) {
    const start = origin;
    if (!start) return;
    const end = Array.from(event.changedTouches).find(touch => touch.identifier === start.id);
    if (!end || event.touches.length || !start.preview || start.context !== getConfig().context) { finish(); return; }
    const { action } = start.preview;
    start.preview = { action, distance: travel(action, end.clientX - start.x) };
    if (event.cancelable) event.preventDefault();
    // The quick editor has its own horizontal paging gesture on the same surface.
    if (start.surface === 'quick-note') event.stopPropagation();
    finish(start.preview.distance >= COMMIT_DISTANCE);
  }

  function touchCancel() { finish(); }
  function click(event: MouseEvent) {
    if (event.detail && isAppSwipeClaimed()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  target.addEventListener('touchstart', touchStart, { capture: true, passive: true });
  target.addEventListener('touchmove', touchMove, { capture: true, passive: false });
  target.addEventListener('touchend', touchEnd, { capture: true, passive: false });
  target.addEventListener('touchcancel', touchCancel, true);
  target.addEventListener('click', click, true);
  return () => {
    activeClaim = false;
    reservedForChild = false;
    suppressUntil = 0;
    target.removeEventListener('touchstart', touchStart, true);
    target.removeEventListener('touchmove', touchMove, true);
    target.removeEventListener('touchend', touchEnd, true);
    target.removeEventListener('touchcancel', touchCancel, true);
    target.removeEventListener('click', click, true);
  };
}

export function useAppSwipe(config: SwipeConfig) {
  const current = useRef(config);
  useLayoutEffect(() => { current.current = config; }, [config]);
  useEffect(() => attachAppSwipe(document, () => current.current), []);
}
