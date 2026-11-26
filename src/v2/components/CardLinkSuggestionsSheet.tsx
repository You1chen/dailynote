import { useEffect, useMemo, useState } from 'react';
import { Check, Link2, RotateCcw, Sparkles, X } from 'lucide-react';
import Sheet from './Sheet';
import { useRegisterBackHandler } from '../../contexts/BackButtonContext';
import {
  confirmCardLink,
  ignoreCardLinkSuggestion,
  removeCardLink,
  restoreCardLinkSuggestion,
  restoreIgnoredCardLinks,
} from '../../db/knowledgeCards';
import type { KnowledgeCard } from '../../types/knowledge';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import { cardTitle } from '../utils/cards';
import {
  suggestionPairKey,
  type CardLinkSuggestion,
  type CardLinkSuggestionKind,
} from '../utils/cardDiscovery';

interface Props {
  open: boolean;
  suggestions: CardLinkSuggestion[];
  /** Optional block-level scope: only suggestions touching this card. */
  focusCardId?: string | null;
  onClearFocus?: () => void;
  onClose: () => void;
}

type Filter = 'all' | CardLinkSuggestionKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'literal', label: '字面' },
  { id: 'semantic', label: '相近' },
];

function kindLabel(kind: CardLinkSuggestionKind): string {
  return kind === 'literal' ? '字面命中' : '内容相近';
}

export default function CardLinkSuggestionsSheet({
  open,
  suggestions,
  focusCardId = null,
  onClearFocus,
  onClose,
}: Props) {
  const { cards, reloadCards } = useData();
  const ui = useUi();
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const cardById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const focusCard = focusCardId ? cardById.get(focusCardId) : undefined;

  // Android back closes the queue before leaving the cards page.
  useRegisterBackHandler(() => {
    if (!open) return false;
    onClose();
    return true;
  }, [open, onClose]);

  useEffect(() => {
    if (open) setFilter('all');
  }, [open, focusCardId]);

  const scoped = useMemo(
    () => (focusCardId
      ? suggestions.filter(item => item.source === focusCardId || item.target === focusCardId)
      : suggestions),
    [suggestions, focusCardId],
  );

  const counts = useMemo(() => ({
    all: scoped.length,
    literal: scoped.filter(item => item.kind === 'literal').length,
    semantic: scoped.filter(item => item.kind === 'semantic').length,
  }), [scoped]);

  const visible = useMemo(
    () => (filter === 'all' ? scoped : scoped.filter(item => item.kind === filter)),
    [scoped, filter],
  );

  const ignoredCount = useMemo(() => {
    const pairs = new Set<string>();
    for (const card of cards) {
      for (const target of card.ignoredLinks ?? []) {
        if (target !== card.id && cardById.has(target)) pairs.add(suggestionPairKey(card.id, target));
      }
    }
    return pairs.size;
  }, [cards, cardById]);

  async function accept(suggestion: CardLinkSuggestion) {
    if (busyId) return;
    setBusyId(suggestion.id);
    try {
      await confirmCardLink(suggestion.source, suggestion.target);
      await reloadCards();
      ui.toast('已建立关联', {
        actionLabel: '撤销',
        duration: 5000,
        onAction: () => {
          void removeCardLink(suggestion.source, suggestion.target)
            .then(() => reloadCards())
            .then(() => ui.toast('已撤销关联'))
            .catch(() => ui.toast('撤销失败，请重试'));
        },
      });
    } catch {
      ui.toast('建立关联失败，请重试');
    } finally {
      setBusyId(null);
    }
  }

  async function ignore(suggestion: CardLinkSuggestion) {
    if (busyId) return;
    setBusyId(suggestion.id);
    try {
      await ignoreCardLinkSuggestion(suggestion.source, suggestion.target);
      await reloadCards();
      ui.toast('已忽略这条建议', {
        actionLabel: '撤销',
        duration: 5000,
        onAction: () => {
          void restoreCardLinkSuggestion(suggestion.source, suggestion.target)
            .then(() => reloadCards())
            .then(() => ui.toast('已恢复建议'))
            .catch(() => ui.toast('恢复失败，请重试'));
        },
      });
    } catch {
      ui.toast('忽略失败，请重试');
    } finally {
      setBusyId(null);
    }
  }

  async function restoreAll() {
    if (restoring || busyId) return;
    const ok = await ui.confirm({
      title: '恢复已忽略的关联建议？',
      message: '之前忽略的建议会重新进入队列。已经确认的关联不会受影响。',
      confirmLabel: '恢复',
    });
    if (!ok) return;
    setRestoring(true);
    try {
      const count = await restoreIgnoredCardLinks();
      await reloadCards();
      ui.toast(count ? `已恢复 ${count} 条建议` : '没有需要恢复的建议');
    } catch {
      ui.toast('恢复失败，请重试');
    } finally {
      setRestoring(false);
    }
  }

  function titleOf(id: string): string {
    const card: KnowledgeCard | undefined = cardById.get(id);
    return card ? cardTitle(card) : '已删除的卡片';
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="关联建议"
      subtitle="系统发现，由你确认；接受后才写入关系网"
      footer={(
        <>
          <span className="v-tiny v-grow">
            {ignoredCount ? `已忽略 ${ignoredCount} 条` : '忽略会记住，避免重复打扰'}
          </span>
          {ignoredCount > 0 && (
            <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => void restoreAll()} disabled={restoring}>
              <RotateCcw size={13} /> {restoring ? '恢复中…' : '恢复'}
            </button>
          )}
          <button type="button" className="v-btn v-btn--primary" onClick={onClose}>完成</button>
        </>
      )}
    >
      {focusCard && (
        <div className="v-suggest-focus">
          <span className="v-tiny">只看</span>
          <span className="v-chip v-chip--soft">{cardTitle(focusCard)}</span>
          {onClearFocus && (
            <button type="button" className="v-iconbtn" aria-label="查看全部建议" onClick={onClearFocus}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div className="v-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div className="v-seg" role="group" aria-label="建议类型">
          {FILTERS.map(item => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {counts[item.id] > 0 && <span className="v-suggest-count">{counts[item.id]}</span>}
            </button>
          ))}
        </div>
        <span className="v-tiny">{counts.all} 条待确认</span>
      </div>

      {visible.length ? (
        <div className="v-suggest-list">
          {visible.map(item => {
            const busy = busyId === item.id;
            const percent = Math.round(item.confidence * 100);
            return (
              <div key={item.id} className={`v-suggest-row${busy ? ' is-busy' : ''}`}>
                <div className="v-suggest-main">
                  <div className="v-suggest-meta">
                    <span className={`v-suggest-kind v-suggest-kind--${item.kind}`}>{kindLabel(item.kind)}</span>
                    <span className="v-suggest-score">{percent}%</span>
                  </div>
                  <div className="v-suggest-pair">
                    <span className="v-suggest-card">{titleOf(item.source)}</span>
                    <Link2 size={12} aria-hidden="true" />
                    <span className="v-suggest-card v-suggest-card--target">{titleOf(item.target)}</span>
                  </div>
                  <p>{item.reason}</p>
                </div>
                <div className="v-suggest-actions">
                  <button
                    type="button"
                    className="v-suggest-accept"
                    aria-label={`接受：${titleOf(item.source)} 与 ${titleOf(item.target)}`}
                    onClick={() => void accept(item)}
                    disabled={!!busyId}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    className="v-suggest-ignore"
                    aria-label={`忽略：${titleOf(item.source)} 与 ${titleOf(item.target)}`}
                    onClick={() => void ignore(item)}
                    disabled={!!busyId}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="v-empty" style={{ padding: '44px 18px' }}>
          <div className="v-empty-icon"><Sparkles size={23} /></div>
          <strong>{focusCard ? '这张卡片暂时没有新建议' : '暂时没有新的关联建议'}</strong>
          <p>
            {focusCard
              ? '写卡片时提到其他卡片标题，或内容逐渐相近，这里就会出现候选。'
              : '写卡片时提到其他卡片的标题、关键词，或内容相近时，会先进入这里等你确认。'}
          </p>
        </div>
      )}

      <p className="v-tiny" style={{ margin: '14px 2px 0', lineHeight: 1.65 }}>
        字面命中来自标题和关键词；内容相近是本地计算，不会上传任何文本。接受后才会写入卡片关联，可随时撤销。
      </p>
    </Sheet>
  );
}
