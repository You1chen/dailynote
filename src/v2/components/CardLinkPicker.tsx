import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import Sheet from './Sheet';
import { useData } from '../state/DataProvider';
import { cardDateKey, dateGroupLabel } from '../../utils/knowledgeCards';
import { cardTitle, typeMeta, cardSnippet } from '../utils/cards';

interface Props {
  open: boolean;
  currentId: string;
  selected: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}

export default function CardLinkPicker({ open, currentId, selected, onClose, onConfirm }: Props) {
  const { cards } = useData();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(selected);

  useEffect(() => {
    if (open) {
      setPicked(selected);
      setQuery('');
    }
  }, [open, selected]);

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards
      .filter(card => card.id !== currentId)
      .filter(card => !needle || `${cardTitle(card)} ${cardSnippet(card, 400)}`.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [cards, currentId, query]);

  function toggle(id: string) {
    setPicked(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="关联卡片"
      subtitle="确认后写入卡片，关系网里显示为实线"
      footer={(
        <>
          <span className="v-tiny v-grow">已选 {picked.length} 张</span>
          <button type="button" className="v-btn v-btn--ghost" onClick={onClose}>取消</button>
          <button type="button" className="v-btn v-btn--primary" onClick={() => onConfirm(picked)}>完成</button>
        </>
      )}
    >
      <div className="v-search" style={{ maxWidth: 'none', marginBottom: 12 }}>
        <Search size={15} />
        <input
          className="v-field"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索卡片"
          aria-label="搜索卡片"
        />
      </div>
      {options.length ? (
        <div className="v-link-list">
          {options.map(card => {
            const meta = typeMeta(card.type);
            const on = picked.includes(card.id);
            return (
              <button key={card.id} type="button" className="v-link-row" onClick={() => toggle(card.id)}>
                <span className={`v-checkbox ${on ? 'v-checkbox--on' : ''}`} aria-hidden="true">
                  {on && <Check size={12} />}
                </span>
                <span className="v-link-row-title">{cardTitle(card)}</span>
                <span className="v-type-dot" style={{ background: meta.color }} />
                <span className="v-link-row-date">{dateGroupLabel(cardDateKey(card.createdAt))}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="v-empty">
          <div className="v-empty-icon"><Search size={22} /></div>
          <strong>{cards.length <= 1 ? '还没有其他卡片' : '没有匹配的卡片'}</strong>
          <p>{cards.length <= 1 ? '再记一张卡片，就可以把它们关联起来。' : '换个关键词试试。'}</p>
        </div>
      )}
    </Sheet>
  );
}
