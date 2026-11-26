import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { GoalNode } from '../types';
import { hitMindmap, layoutMindmap, mindmapBounds } from '../utils/mindmap';

interface Props { title: string; nodes: GoalNode[]; onSelect: (id: string, leaf: boolean) => void }

export default function PlanMindmap({ title, nodes, onSelect }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const section = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(360);
  const [view, setView] = useState({ x: 180, y: 210, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const layout = layoutMindmap(title, nodes);
  const bounds = mindmapBounds(layout);
  // 画布高度跟随分支行数，不再固定占满一屏；超过一屏 58% 时交给拖动/缩放。
  const fitScale = Math.max(.3, (width - 24) / (bounds.right - bounds.left));
  const height = Math.round(Math.max(228, Math.min((bounds.bottom - bounds.top) * fitScale + 54, window.innerHeight * .58)));
  const box = { width, height };

  const fit = () => {
    const scale = Math.min(1.45, Math.max(.3, Math.min(
      (width - 16) / (bounds.right - bounds.left),
      (height - 16) / (bounds.bottom - bounds.top),
    )));
    setView({
      x: width / 2 - (bounds.left + bounds.right) / 2 * scale,
      y: height / 2 - (bounds.top + bounds.bottom) / 2 * scale,
      scale,
    });
  };

  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { fit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [width, height, nodes.length, title]);

  useEffect(() => {
    const field = canvas.current, ctx = field?.getContext('2d');
    if (!field || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    field.width = Math.ceil(box.width * dpr);
    field.height = Math.ceil(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    const root = layout[0];
    const byId = new Map(layout.map(n => [n.id, n]));

    // 连线：从中心节点侧边弧到分支卡片内侧
    layout.forEach(n => {
      if (!n.parent) return;
      const from = byId.get(n.parent)!;
      const side = n.x > from.x ? 1 : -1;
      const startX = from.x + from.width / 2 * side;
      const startY = from.y + (n.y > from.y ? Math.min(28, from.height / 3) : 0);
      const endX = n.x - n.width / 2 * side;
      const endY = n.y - n.height / 2 + 4;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(startX + 44 * side, startY + 18, endX - 44 * side, endY, endX, endY);
      ctx.strokeStyle = n.color;
      ctx.globalAlpha = .5;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(endX, endY, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
    });

    layout.forEach(n => {
      const rootNode = !n.parent;
      const left = n.x - n.width / 2;
      const top = n.y - n.height / 2;
      ctx.save();
      ctx.shadowColor = rootNode ? '#1c5a4b55' : '#26413a1f';
      ctx.shadowBlur = rootNode ? 18 : 10;
      ctx.shadowOffsetY = rootNode ? 7 : 3;
      ctx.beginPath();
      ctx.roundRect(left, top, n.width, n.height, rootNode ? 22 : 18);
      ctx.fillStyle = rootNode ? n.color : '#fffdf8';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.roundRect(left, top, n.width, n.height, rootNode ? 22 : 18);
      ctx.strokeStyle = rootNode ? n.color : `${n.color}66`;
      ctx.lineWidth = rootNode ? 1 : 1.4;
      ctx.stroke();

      // 分支卡片左侧的彩色竖条
      if (!rootNode) {
        ctx.beginPath();
        ctx.roundRect(left + 1.5, top + 14, 3.5, n.height - 28, 2);
        ctx.fillStyle = n.color;
        ctx.fill();
      }

      const textWidth = n.width - (rootNode ? 34 : 42);
      ctx.font = `${rootNode ? 700 : 600} ${rootNode ? 18 : 15.5}px system-ui, -apple-system, "PingFang SC", sans-serif`;
      const characters = [...n.title];
      const rows: string[] = [];
      let row = '';
      characters.forEach(char => {
        if (ctx.measureText(row + char).width > textWidth && row) { rows.push(row); row = char; }
        else row += char;
      });
      if (row) rows.push(row);
      const shown = rows.slice(0, rootNode ? 2 : 2);
      if (rows.length > shown.length) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/.$/, '')}…`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rootNode ? '#ffffff' : '#25352f';
      shown.forEach((text, index) => ctx.fillText(text, left + (rootNode ? 17 : 19), top + 23 + index * 21));

      const metaY = top + n.height - 22;
      ctx.font = '11.5px system-ui, -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = rootNode ? '#d7f6ea' : '#7b8b84';
      const meta = rootNode
        ? `${n.steps} 个分支 · ${n.progress == null ? '尚未拆解' : `${Math.round(n.progress)}%`}`
        : n.leaf
          ? (n.completed ? '已完成 · 点按撤销' : '点按完成')
          : `${n.steps} 个下一步 · 点按展开`;
      ctx.fillText(meta, left + (rootNode ? 17 : 19), metaY);

      if (!rootNode) {
        ctx.beginPath();
        ctx.roundRect(left + 19, top + n.height - 11, n.width - 42, 3.6, 2);
        ctx.fillStyle = `${n.color}22`;
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(left + 19, top + n.height - 11, (n.width - 42) * ((n.progress ?? 0) / 100), 3.6, 2);
        ctx.fillStyle = n.color;
        ctx.fill();
      }
    });
  }, [layout, box, view]);

  const zoom = (factor: number, originX = box.width / 2, originY = box.height / 2) => {
    setView(v => {
      const scale = Math.max(.3, Math.min(2.4, v.scale * factor));
      const ratio = scale / v.scale;
      return { scale, x: originX - (originX - v.x) * ratio, y: originY - (originY - v.y) * ratio };
    });
  };

  return (
    <section className="gp-canvas-section" ref={section} aria-label="计划思维导图">
      <div className="gp-canvas-tools">
        <span>让每一步，长成你的计划</span>
        <button type="button" aria-label="缩小导图" onClick={() => zoom(.82)}><Minus size={16} /></button>
        <button type="button" aria-label="放大导图" onClick={() => zoom(1.22)}><Plus size={16} /></button>
        <button type="button" aria-label="适配全部节点" onClick={fit}><Maximize2 size={16} /></button>
      </div>
      <canvas
        ref={canvas}
        style={{ width: '100%', height: box.height, touchAction: 'none' }}
        aria-label="思维导图画布，可拖动、双指缩放；文字操作见下方节点目录"
        onWheel={event => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : .91); }}
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          gesture.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={event => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          const before = [...pointers.current.values()];
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const after = [...pointers.current.values()];
          if (after.length > 1) {
            gesture.current.moved = true;
            const distance = (points: typeof after) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const ratio = distance(after) / Math.max(1, distance(before));
            zoom(ratio, after[0].x - event.currentTarget.getBoundingClientRect().left, after[0].y - event.currentTarget.getBoundingClientRect().top);
            return;
          }
          if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 6) gesture.current.moved = true;
          setView(v => ({ ...v, x: v.x + event.clientX - previous.x, y: v.y + event.clientY - previous.y }));
        }}
        onPointerUp={event => {
          const wasDragging = gesture.current.moved;
          pointers.current.delete(event.pointerId);
          if (wasDragging) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const v = viewRef.current;
          const node = hitMindmap(layout, (event.clientX - rect.left - v.x) / v.scale, (event.clientY - rect.top - v.y) / v.scale);
          if (node?.parent) onSelect(node.id, node.leaf);
        }}
        onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current.moved = true; }}
      />
      <p className="gp-canvas-hint">拖动画布 · 双指缩放 · 点分支深入 · 点末级行动完成</p>
    </section>
  );
}
