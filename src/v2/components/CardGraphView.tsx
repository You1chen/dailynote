import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { CardGraphEdge, CardGraphNode } from '../utils/cardGraph';
import type { CardLinkSuggestion } from '../utils/cardDiscovery';
import { layoutCardGraph } from '../utils/graphLayout';

interface Props {
  nodes: CardGraphNode[];
  edges: CardGraphEdge[];
  /** Non-written discoveries rendered as faint dashed lines. */
  suggestions?: CardLinkSuggestion[];
  onOpen: (id: string) => void;
  /** Long-press / right-click opens the card menu at viewport coordinates. */
  onLongPress?: (id: string, clientX: number, clientY: number) => void;
}

const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP = 7;

const FALLBACK_W = 1000;
const FALLBACK_H = 700;

interface Transform { x: number; y: number; k: number; }
const IDENTITY: Transform = { x: 0, y: 0, k: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nodeRadius(node: CardGraphNode): number {
  const contentCount = node.card.contents.length;
  // Logseq-like graph: compact dots whose weight grows with connection count.
  return 7 + Math.min(7, node.degree * 0.9) + Math.min(4, contentCount * 0.5);
}

export default function CardGraphView({ nodes, edges, suggestions = [], onOpen, onLongPress }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: FALLBACK_W, h: FALLBACK_H });
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; k: number; x: number; y: number } | null>(null);
  const longPressRef = useRef<{ timer: number; fired: boolean; id: string } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  // Match the layout coordinate system to the actual CSS pixel size: labels,
  // node radii and text then keep the same on-screen size across breakpoints.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setSize(current => Math.abs(current.w - rect.width) < 2 && Math.abs(current.h - rect.height) < 2
        ? current
        : { w: Math.round(rect.width), h: Math.round(rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutCardGraph(
    nodes.map(node => ({
      id: node.id,
      degree: node.degree,
      group: node.card.type || '知识',
      createdAt: node.card.createdAt,
    })),
    edges.map(edge => ({ source: edge.source, target: edge.target, weight: edge.weight })),
    {
      width: size.w,
      height: size.h,
      padding: size.w < 520 ? 34 : 56,
      // Floating zoom controls sit in the top-right corner; keep labels clear.
      paddingRight: size.w < 520 ? 86 : 76,
    },
  ), [nodes, edges, size.w, size.h]);

  useEffect(() => {
    setPositions(layout);
  }, [layout]);

  useEffect(() => {
    setTransform(IDENTITY);
  }, [size.w, size.h]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      const from = map.get(edge.source) ?? new Set<string>();
      const to = map.get(edge.target) ?? new Set<string>();
      from.add(edge.target);
      to.add(edge.source);
      map.set(edge.source, from);
      map.set(edge.target, to);
    }
    return map;
  }, [edges]);

  const active = hover ?? dragging;
  const activeNeighbors = active ? neighbors.get(active) ?? new Set<string>() : null;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0014);
      setTransform(current => {
        const k = clamp(current.k * factor, 0.45, 2.8);
        const cx = size.w / 2;
        const cy = size.h / 2;
        return {
          k,
          x: cx - (cx - current.x) * (k / current.k),
          y: cy - (cy - current.y) * (k / current.k),
        };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  function reset() {
    setTransform(IDENTITY);
  }

  function zoom(factor: number) {
    setTransform(current => {
      const k = clamp(current.k * factor, 0.45, 2.8);
      const cx = size.w / 2;
      const cy = size.h / 2;
      return {
        k,
        x: cx - (cx - current.x) * (k / current.k),
        y: cy - (cy - current.y) * (k / current.k),
      };
    });
  }

  function toViewBoxDelta(dx: number, dy: number): { dx: number; dy: number } {
    return { dx, dy };
  }

  function startNodeDrag(event: ReactPointerEvent, node: CardGraphNode) {
    if (event.button !== 0 || pointers.current.size > 1) return;
    event.stopPropagation();
    try { svg.current?.setPointerCapture(event.pointerId); } catch { /* older webviews */ }
    const point = positions[node.id] ?? { x: size.w / 2, y: size.h / 2 };
    dragRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: point.x,
      originY: point.y,
      moved: false,
    };
    setDragging(node.id);
    clearLongPress();
    const timer = window.setTimeout(() => {
      const current = longPressRef.current;
      if (!current || current.timer !== timer) return;
      current.fired = true;
      dragRef.current = null;
      setDragging(null);
      navigator.vibrate?.(12);
      onLongPress?.(node.id, event.clientX, event.clientY);
    }, LONG_PRESS_MS);
    longPressRef.current = { timer, fired: false, id: node.id };
  }

  function openNodeContextMenu(event: ReactMouseEvent, node: CardGraphNode) {
    event.preventDefault();
    event.stopPropagation();
    clearLongPress();
    onLongPress?.(node.id, event.clientX, event.clientY);
  }

  function startPan(event: ReactPointerEvent) {
    if (event.button !== 0 || pointers.current.size > 1) return;
    if ((event.target as Element).closest('.v-graph-node')) return;
    try { svg.current?.setPointerCapture(event.pointerId); } catch { /* older webviews */ }
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
      moved: false,
    };
  }

  function pointerDown(event: ReactPointerEvent) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        k: transform.k,
        x: transform.x,
        y: transform.y,
      };
      dragRef.current = null;
      panRef.current = null;
      setDragging(null);
    }
  }

  function pointerMove(event: ReactPointerEvent) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pendingLongPress = longPressRef.current;
    const currentDrag = dragRef.current;
    if (pendingLongPress && !pendingLongPress.fired && currentDrag) {
      if (Math.hypot(event.clientX - currentDrag.startX, event.clientY - currentDrag.startY) > LONG_PRESS_SLOP) {
        clearLongPress();
      }
    }
    const pinch = pinchRef.current;
    if (pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.distance > 0) {
        const k = clamp(pinch.k * (distance / pinch.distance), 0.45, 2.8);
        setTransform({ k, x: pinch.x, y: pinch.y });
      }
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const delta = toViewBoxDelta(dx, dy);
      setPositions(current => ({
        ...current,
        [drag.id]: { x: clamp(drag.originX + delta.dx / transform.k, 24, size.w - 24), y: clamp(drag.originY + delta.dy / transform.k, 24, size.h - 24) },
      }));
      return;
    }

    const pan = panRef.current;
    if (pan) {
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (!pan.moved && Math.hypot(dx, dy) > 3) pan.moved = true;
      if (!pan.moved) return;
      const delta = toViewBoxDelta(dx, dy);
      setTransform(current => ({ ...current, x: pan.originX + delta.dx, y: pan.originY + delta.dy }));
    }
  }

  function pointerUp(event: ReactPointerEvent) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    const longPressed = longPressRef.current?.fired ?? false;
    clearLongPress();
    const drag = dragRef.current;
    const pan = panRef.current;
    dragRef.current = null;
    panRef.current = null;
    setDragging(null);
    if (drag && !drag.moved && !longPressed) onOpen(drag.id);
    if (pan && !pan.moved) {
      // A plain click on the canvas does nothing; keep the view stable.
    }
  }

  function pointerCancel(event: ReactPointerEvent) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    clearLongPress();
    dragRef.current = null;
    panRef.current = null;
    setDragging(null);
  }

  return (
    <div className="v-graph-card v-graph-card--logseq" ref={host} aria-label="卡片关系网">
      <div className="v-graph-hint">
        <span>拖动 · 长按菜单 · 正文 [[标题]] 连成实线</span>
      </div>
      <svg
        ref={svg}
        className="v-graph-svg"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={event => { pointerDown(event); startPan(event); }}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerCancel}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {suggestions.map(suggestion => {
            const from = positions[suggestion.source];
            const to = positions[suggestion.target];
            if (!from || !to) return null;
            const isActive = !!active && (suggestion.source === active || suggestion.target === active);
            const dim = !!active && !isActive;
            return (
              <line
                key={`suggestion-${suggestion.id}`}
                className={`v-graph-suggestion${isActive ? ' is-active' : ''}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--v-text-2)"
                strokeWidth={isActive ? 1.25 : 0.95}
                strokeDasharray="3 4"
                strokeLinecap="round"
                opacity={dim ? 0.1 : isActive ? 0.7 : 0.34}
              >
                <title>{`建议：${suggestion.reason}`}</title>
              </line>
            );
          })}

          {edges.map(edge => {
            const from = positions[edge.source];
            const to = positions[edge.target];
            if (!from || !to) return null;
            const isActive = !!active && (edge.source === active || edge.target === active);
            const dim = !!active && !isActive;
            const manual = edge.kind === 'manual';
            return (
              <line
                key={edge.id}
                className={`v-graph-edge${dim ? ' is-dim' : ''}${isActive ? ' is-active' : ''}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={isActive ? 'var(--v-text-2)' : manual ? 'var(--v-text-3)' : 'var(--v-separator-strong)'}
                strokeWidth={isActive ? 1.7 : manual ? 1.25 : 0.9}
                strokeLinecap="round"
                opacity={isActive ? 0.95 : manual ? 0.72 : 0.46}
              >
                <title>{edge.kinds.join('、')}</title>
              </line>
            );
          })}

          {nodes.map(node => {
            const point = positions[node.id];
            if (!point) return null;
            const radius = nodeRadius(node);
            const isActive = node.id === active;
            const isNeighbor = !!activeNeighbors?.has(node.id);
            const dim = !!active && !isActive && !isNeighbor;
            const title = node.card.title.trim() || '未命名卡片';
            const keywordCount = node.card.keywords?.length ?? 0;
            return (
              <g
                key={node.id}
                className={`v-graph-node${dim ? ' is-dim' : ''}${isActive ? ' is-active' : ''}`}
                transform={`translate(${point.x} ${point.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${title}${keywordCount ? `，关键词 ${node.card.keywords?.join('、')}` : ''}`}
                onPointerDown={event => startNodeDrag(event, node)}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover(current => current === node.id ? null : current)}
                onContextMenu={event => openNodeContextMenu(event, node)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(node.id);
                  }
                  if (event.key === 'F10' && event.shiftKey) {
                    event.preventDefault();
                    const box = host.current?.getBoundingClientRect();
                    onLongPress?.(node.id, (box?.left ?? 0) + point.x, (box?.top ?? 0) + point.y);
                  }
                }}
              >
                <title>{title}</title>
                <circle r={radius + 12} fill="transparent" />
                <circle
                  className="v-node-dot"
                  r={radius}
                  fill={isActive || isNeighbor ? 'var(--v-text)' : 'var(--v-text-3)'}
                  opacity={dim ? 0.28 : isActive || isNeighbor ? 0.95 : 0.72}
                />
                <circle
                  r={radius + 5}
                  fill="none"
                  stroke="var(--v-text-3)"
                  strokeWidth={1}
                  opacity={isActive ? 0.3 : 0}
                />
                <text
                  y={radius + 15}
                  textAnchor="middle"
                  fill={isActive ? 'var(--v-text)' : 'var(--v-text-2)'}
                  fontSize={11}
                  fontWeight={isActive ? 650 : 520}
                  style={{ pointerEvents: 'none' }}
                >
                  {title.length > 10 ? `${title.slice(0, 10)}…` : title}
                </text>
                {keywordCount > 0 && (
                  <circle cx={radius + 5} cy={-radius + 2} r={2.2} fill="var(--v-text-3)" opacity={0.8} />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="v-graph-controls">
        <button type="button" aria-label="放大" onClick={() => zoom(1.2)}><Plus size={16} /></button>
        <button type="button" aria-label="缩小" onClick={() => zoom(1 / 1.2)}><Minus size={16} /></button>
        <button type="button" aria-label="恢复视图" onClick={reset}><Maximize2 size={15} /></button>
      </div>

      <div className="v-graph-legend">
        <span><i className="v-legend-line" />已确认</span>
        <span><i className="v-legend-line v-legend-line--dashed" />待确认建议</span>
      </div>

      {nodes.length < 2 && (
        <div className="v-graph-empty">
          <div className="v-empty-icon"><Maximize2 size={22} /></div>
          <strong>{nodes.length ? '再记一张就能连线' : '还没有卡片'}</strong>
          <p>{nodes.length ? '两张卡片之间出现的关联会先作为虚线建议，确认后才连成实线。长按节点可以设置关键词。' : '新建几张卡片，这里会慢慢长成一张关系网。'}</p>
        </div>
      )}
    </div>
  );
}
