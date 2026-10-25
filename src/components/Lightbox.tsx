import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import './Lightbox.css';

interface Props {
  images: string[];
  index: number;
  onClose: () => void;
}

/** 图片查看器：点缩略图打开大图，多图可左右切换 */
export default function Lightbox({ images, index, onClose }: Props) {
  const [cur, setCur] = useState(index);

  useEffect(() => {
    setCur(index);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setCur(c => Math.max(0, c - 1));
      if (e.key === 'ArrowRight') setCur(c => Math.min(images.length - 1, c + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images.length, onClose]);

  if (images.length === 0) return null;
  const src = images[Math.min(cur, images.length - 1)];

  return (
    <div className="lb-mask" onClick={onClose}>
      <button className="lb-close" onClick={onClose} aria-label="关闭">
        <X size={22} />
      </button>

      <img className="lb-img" src={src} alt="图片" onClick={e => e.stopPropagation()} />

      {images.length > 1 && (
        <>
          <button
            className="lb-nav lb-nav--prev"
            disabled={cur <= 0}
            onClick={e => { e.stopPropagation(); setCur(c => Math.max(0, c - 1)); }}
            aria-label="上一张"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            className="lb-nav lb-nav--next"
            disabled={cur >= images.length - 1}
            onClick={e => { e.stopPropagation(); setCur(c => Math.min(images.length - 1, c + 1)); }}
            aria-label="下一张"
          >
            <ChevronRight size={24} />
          </button>
          <div className="lb-count">{cur + 1} / {images.length}</div>
        </>
      )}
    </div>
  );
}
