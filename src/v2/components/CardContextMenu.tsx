import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Sparkles, Tag, X, type LucideIcon } from 'lucide-react';
import type { KnowledgeCard } from '../../types/knowledge';
import { cardTitle, typeMeta } from '../utils/cards';

/** Extension point: append menu entries here to add future graph actions. */
export interface CardMenuAction {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  onSelect: (card: KnowledgeCard) => void;
}

interface Props {
  open: boolean;
  card: KnowledgeCard | null;
  x: number;
  y: number;
  extensions?: readonly CardMenuAction[];
  onClose: () => void;
  onSetKeywords: (card: KnowledgeCard) => void;
  /** Block-level discovery entry: open the queue scoped to this card. */
  onOpenSuggestions?: (card: KnowledgeCard) => void;
  suggestionCount?: number;
}

const MENU_WIDTH = 248;
const MENU_HEIGHT = 292;
const EDGE = 10;

export default function CardContextMenu({
  open,
  card,
  x,
  y,
  extensions = [],
  onClose,
  onSetKeywords,
  onOpenSuggestions,
  suggestionCount = 0,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open) return;
    const width = panel.current?.offsetWidth ?? MENU_WIDTH;
    const height = panel.current?.offsetHeight ?? MENU_HEIGHT;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    setPlacement({
      left: Math.max(EDGE, Math.min(x, viewportWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, viewportHeight - height - EDGE)),
    });
  }, [open, x, y, extensions.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !card) return null;
  const meta = typeMeta(card.type);

  return createPortal(
    <>
      <div className="v-graph-menu-backdrop" onClick={onClose} />
      <div
        className="v-graph-menu"
        ref={panel}
        role="menu"
        aria-label="卡片操作"
        style={{ left: placement.left, top: placement.top }}
        onClick={event => event.stopPropagation()}
      >
        <div className="v-graph-menu-head">
          <span className="v-type-dot" style={{ background: meta.color }} />
          <span className="v-graph-menu-title">{cardTitle(card)}</span>
          <button type="button" className="v-iconbtn" aria-label="关闭菜单" onClick={onClose}><X size={14} /></button>
        </div>

        <button
          type="button"
          className="v-graph-menu-item"
          role="menuitem"
          onClick={() => { onClose(); onSetKeywords(card); }}
        >
          <span className="v-graph-menu-icon"><Tag size={16} /></span>
          <span className="v-graph-menu-copy">
            <strong>设置关键词</strong>
            <small>{card.keywords?.length ? `已有 ${card.keywords.length} 个` : '用关键词建立卡片联系'}</small>
          </span>
        </button>

        {onOpenSuggestions && (
          <button
            type="button"
            className="v-graph-menu-item"
            role="menuitem"
            onClick={() => { onClose(); onOpenSuggestions(card); }}
          >
            <span className="v-graph-menu-icon"><Sparkles size={16} /></span>
            <span className="v-graph-menu-copy">
              <strong>查看关联建议</strong>
              <small>{suggestionCount ? `${suggestionCount} 条待确认` : '系统发现，等你确认'}</small>
            </span>
          </button>
        )}

        {extensions.map(action => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              className="v-graph-menu-item"
              role="menuitem"
              onClick={() => { onClose(); action.onSelect(card); }}
            >
              <span className="v-graph-menu-icon"><Icon size={16} /></span>
              <span className="v-graph-menu-copy">
                <strong>{action.label}</strong>
                {action.hint && <small>{action.hint}</small>}
              </span>
            </button>
          );
        })}

        {/* Reserved slot: future actions can be appended above without changing the menu layout. */}
        <div className="v-graph-menu-extension" data-extension-slot="card-graph">
          <Plus size={14} />
          <span>更多功能</span>
          <small>{extensions.length ? `${extensions.length} 个扩展操作` : '预留扩展位'}</small>
        </div>
      </div>
    </>,
    document.body,
  );
}
