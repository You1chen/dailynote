import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import {
  fitCoverScale,
  clampPan,
  zoomAround,
  cropSourceRect,
  renderAvatarToDataURL,
  downscaleImage,
} from '../utils/avatarCrop';
import './AvatarCropper.css';

const MAX_ZOOM = 4; // 相对 cover 的最大缩放倍数

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (dataURL: string) => void;
}

/**
 * 头像裁剪弹窗：导入任意图片 → 拖动/双指捏合/滚轮/按钮缩放 → 确定输出方形 dataURL。
 * 手势期间直接改写 img style（ref 驱动），不触发 React 重渲染。
 */
export default function AvatarCropper({ file, onCancel, onConfirm }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /** 图片左上角偏移 + 缩放（唯一真相源，手势期间只写 ref） */
  const tf = useRef({ x: 0, y: 0, s: 1 });
  const imgSize = useRef({ w: 0, h: 0 });
  const sFitRef = useRef(1);
  const cancelled = useRef(false);
  /** 活动指针（client 坐标） */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** 捏合起点：中点（视口局部坐标）+ 指距 */
  const pinch = useRef<{ mid: { x: number; y: number }; dist: number } | null>(null);
  const lastPan = useRef<{ x: number; y: number } | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(1); // 滑杆值（1–4，相对 cover）

  // 关闭时标记，防加载回调在卸载后写状态
  const handleCancel = useCallback(() => {
    cancelled.current = true;
    onCancel();
  }, [onCancel]);

  const applyTransform = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const { x, y, s } = tf.current;
    const { w, h } = imgSize.current;
    img.style.width = `${w * s}px`;
    img.style.height = `${h * s}px`;
    img.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  const clampScale = useCallback((s: number): number => {
    const fit = sFitRef.current;
    return Math.min(MAX_ZOOM * fit, Math.max(fit, s));
  }, []);

  const clampAndApply = useCallback(() => {
    const t = tf.current;
    const c = clampPan(t.x, t.y, t.s, viewportSize(), imgSize.current.w, imgSize.current.h);
    t.x = c.x;
    t.y = c.y;
    applyTransform();
  }, [applyTransform]);

  function viewportSize(): number {
    return viewportRef.current?.getBoundingClientRect().width || 0;
  }

  /** 围绕视口点 (px, py) 以 factor 倍数缩放 */
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const t = tf.current;
    const ns = clampScale(t.s * factor);
    const z = zoomAround(t.x, t.y, t.s, px, py, ns);
    t.x = z.x;
    t.y = z.y;
    t.s = ns;
    clampAndApply();
    setZoom(t.s / sFitRef.current);
  }, [clampScale, clampAndApply]);

  // ---- 加载图片（DOM img 常驻，全程以它为准，确认时 drawImage 必为已加载态） ----
  useEffect(() => {
    const dom = imgRef.current;
    if (!dom) return;
    const load = (url: string) => new Promise<void>((resolve, reject) => {
      dom.onload = () => resolve();
      dom.onerror = () => reject(new Error('图片加载失败'));
      dom.src = url;
    });
    const reader = new FileReader();
    reader.onerror = () => {
      if (!cancelled.current) setStatus('error');
    };
    reader.onload = () => {
      (async () => {
        try {
          await load(reader.result as string);
          if (cancelled.current) return;
          if (!dom.naturalWidth || !dom.naturalHeight) throw new Error('无尺寸');
          // 巨图（>4096px）降采样后灌回 DOM img 并等待加载
          const downscaled = await downscaleImage(dom);
          if (cancelled.current) return;
          if (downscaled !== dom) {
            await load(downscaled.src);
            if (cancelled.current) return;
          }
          const V = viewportSize();
          if (V <= 0) throw new Error('视口不可用');
          imgSize.current = { w: dom.naturalWidth, h: dom.naturalHeight };
          const fit = fitCoverScale(V, imgSize.current.w, imgSize.current.h);
          sFitRef.current = fit;
          tf.current = {
            x: (V - imgSize.current.w * fit) / 2,
            y: (V - imgSize.current.h * fit) / 2,
            s: fit,
          };
          applyTransform();
          setZoom(1);
          setStatus('ready');
        } catch {
          if (!cancelled.current) setStatus('error');
        }
      })();
    };
    reader.readAsDataURL(file);
  }, [file, applyTransform]);

  // ---- 手势 ----
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      lastPan.current = { x: e.clientX, y: e.clientY };
    } else if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const r = viewportRef.current!.getBoundingClientRect();
      pinch.current = {
        mid: { x: (p1.x + p2.x) / 2 - r.left, y: (p1.y + p2.y) / 2 - r.top },
        dist: Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y)),
      };
      lastPan.current = null;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];

    if (pts.length === 1 && lastPan.current) {
      const dx = e.clientX - lastPan.current.x;
      const dy = e.clientY - lastPan.current.y;
      lastPan.current = { x: e.clientX, y: e.clientY };
      tf.current.x += dx;
      tf.current.y += dy;
      clampAndApply();
    } else if (pts.length === 2 && pinch.current) {
      const r = viewportRef.current!.getBoundingClientRect();
      const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
      const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      const newS = clampScale(tf.current.s * (dist / pinch.current.dist));
      const z = zoomAround(tf.current.x, tf.current.y, tf.current.s, pinch.current.mid.x, pinch.current.mid.y, newS);
      // 缩放后再跟手中点位移
      tf.current.x = z.x + (mid.x - pinch.current.mid.x);
      tf.current.y = z.y + (mid.y - pinch.current.mid.y);
      tf.current.s = newS;
      pinch.current = { mid, dist };
      clampAndApply();
    }
  }

  function onPointerEnd(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* 已释放则忽略 */ }
    if (pointers.current.size === 1) {
      lastPan.current = [...pointers.current.values()][0];
    }
    if (pointers.current.size === 0) {
      pinch.current = null;
      lastPan.current = null;
    }
    setZoom(tf.current.s / sFitRef.current); // 手势结束才同步滑杆
  }

  // ---- 滚轮（原生非被动监听，才能 preventDefault） ----
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      zoomAt(px, py, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- Android 返回键 / Escape / 背景滚动锁定 ----
  useRegisterBackHandler(() => {
    handleCancel();
    return true;
  }, [handleCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleCancel]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleConfirm = () => {
    if (status !== 'ready' || !imgRef.current) return;
    const V = viewportSize();
    if (V <= 0) return;
    const { w, h } = imgSize.current;
    const rect = cropSourceRect(tf.current.x, tf.current.y, tf.current.s, V, w, h);
    onConfirm(renderAvatarToDataURL(imgRef.current, rect));
  };

  const V = viewportSize() || 280;

  return createPortal(
    <div className="av-overlay">
      <div className="av-modal">
        <div className="av-title">裁剪头像</div>

        <div
          className="av-crop-viewport"
          ref={viewportRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <img
            ref={imgRef}
            className="av-crop-img"
            style={{ opacity: status === 'ready' ? 1 : 0 }}
            draggable={false}
            alt=""
          />
          {status === 'loading' && <div className="av-status">加载中…</div>}
          {status === 'error' && <div className="av-status">无法读取图片，请换一张重试</div>}
          {/* 圆形遮罩（视觉提示成品形状） */}
          <div className="av-crop-mask" />
        </div>

        <div className="av-hint">拖动移动 · 双指或滚轮缩放</div>

        <div className="av-controls">
          <button className="btn btn-outline btn-sm" onClick={() => zoomAt(V / 2, V / 2, 1 / 1.25)} aria-label="缩小">−</button>
          <input
            type="range"
            className="score-slider av-zoom-slider"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={Math.min(MAX_ZOOM, Math.max(1, zoom))}
            onChange={e => {
              const target = sFitRef.current * Number(e.target.value);
              zoomAt(V / 2, V / 2, target / tf.current.s);
            }}
            disabled={status !== 'ready'}
          />
          <button className="btn btn-outline btn-sm" onClick={() => zoomAt(V / 2, V / 2, 1.25)} aria-label="放大">+</button>
        </div>

        <div className="av-actions">
          <button className="btn btn-ghost" onClick={handleCancel}>取消</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={status !== 'ready'}>确定</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
