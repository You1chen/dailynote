import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { searchEverything } from '../db';
import type { SearchHit } from '../utils/search';
import './SearchOverlay.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 全局内容搜索：只搜用户录入的内容，结果带位置并可跳转 */
export default function SearchOverlay({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const text = q.trim();
    if (!text) { setHits([]); setBusy(false); return undefined; }
    setBusy(true);
    searchEverything(text)
      .then(r => { if (alive) setHits(r); })
      .catch(() => { if (alive) setHits([]); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [q, open]);

  if (!open) return null;

  function openHit(hit: SearchHit) {
    onClose();
    navigate(hit.route);
    if (hit.onOpen === 'tasks') {
      setTimeout(() => window.dispatchEvent(new Event('dailynote-open-tasks')), 80);
    }
  }

  return (
    <div className="sr-overlay" onClick={onClose}>
      <div className="sr-panel" onClick={e => e.stopPropagation()}>
        <div className="sr-head">
          <Search size={18} className="sr-icon" />
          <input
            ref={inputRef}
            className="sr-input"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索内容"
            onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
          />
          <button className="sr-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="sr-body">
          {!q.trim() ? (
            <div className="sr-empty">输入要查找的内容</div>
          ) : busy && hits.length === 0 ? (
            <div className="sr-empty">搜索中...</div>
          ) : hits.length === 0 ? (
            <div className="sr-empty">没有找到</div>
          ) : (
            hits.map(hit => (
              <button key={hit.key} className="sr-item" onClick={() => openHit(hit)}>
                <span className="sr-item-main">
                  <span className="sr-item-title">{hit.title}</span>
                  <span className="sr-item-snippet">{hit.snippet}</span>
                </span>
                <span className="sr-item-where">{hit.where}</span>
              </button>
            ))
          )}
        </div>

        <div className="sr-foot">{hits.length > 0 ? `${hits.length} 条` : ''}</div>
      </div>
    </div>
  );
}
