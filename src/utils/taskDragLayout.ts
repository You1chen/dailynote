interface DragRect { top: number; bottom: number }

/** Offset the dragged group directly; neighbours move once its edge passes their midpoint. */
export function taskDragLayout(rects: DragRect[], source: number, dy: number) {
  const offsets = rects.map(() => 0);
  const dragged = rects[source];
  let targetIndex = source;
  if (!dragged) return { targetIndex, offsets };
  offsets[source] = dy;
  const extent = dragged.bottom - dragged.top;
  if (dy > 0) {
    for (let i = source + 1; i < rects.length && dragged.bottom + dy > (rects[i].top + rects[i].bottom) / 2; i++) {
      offsets[i] = -extent;
      targetIndex = i;
    }
  } else if (dy < 0) {
    for (let i = source - 1; i >= 0 && dragged.top + dy < (rects[i].top + rects[i].bottom) / 2; i--) {
      offsets[i] = extent;
      targetIndex = i;
    }
  }
  return { targetIndex, offsets };
}
