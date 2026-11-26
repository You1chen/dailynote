import { useMemo, useState } from 'react';
import { Layers, Network, Plus, Search, Sparkles } from 'lucide-react';
import CardGraphView from '../components/CardGraphView';
import CardContextMenu, { type CardMenuAction } from '../components/CardContextMenu';
import CardKeywordSheet from '../components/CardKeywordSheet';
import CardLinkSuggestionsSheet from '../components/CardLinkSuggestionsSheet';
import { buildCardGraph } from '../utils/cardGraph';
import { buildCardLinkSuggestions } from '../utils/cardDiscovery';
import { cardSnippet, cardTitle, createCard, summarizeContents, typeMeta, cardCover } from '../utils/cards';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import { cardDateKey, dateGroupLabel } from '../../utils/knowledgeCards';
import type { KnowledgeCard } from '../../types/knowledge';

/**
 * Graph context-menu extension point.
 * Future actions (e.g. merge cards, pin node, create card) can be appended
 * here; CardContextMenu renders them before the reserved extension slot.
 */
const GRAPH_MENU_EXTENSIONS: CardMenuAction[] = [];

type View = 'graph' | 'library';
type Range = 'all' | '7' | '30' | 'year';

const RANGES: { id: Range; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: '7', label: '近 7 天' },
  { id: '30', label: '近 30 天' },
  { id: 'year', label: '今年' },
];

function cutoff(range: Range): number {
  if (range === 'all') return 0;
  if (range === '7') return Date.now() - 7 * 86400000;
  if (range === '30') return Date.now() - 30 * 86400000;
  return new Date(new Date().getFullYear(), 0, 1).getTime();
}

function CardTile({ card, onOpen }: { card: KnowledgeCard; onOpen: () => void }) {
  const meta = typeMeta(card.type);
  const cover = cardCover(card);
  return (
    <button type="button" className="v-card-tile" onClick={onOpen}>
      <span className="v-card-tile-top">
        <span className="v-type-dot" style={{ background: meta.color }} />
        {meta.label}
        <span style={{ marginLeft: 'auto' }}>{dateGroupLabel(cardDateKey(card.createdAt))}</span>
      </span>
      <h3>{cardTitle(card)}</h3>
      {cardSnippet(card) && <p className="v-card-tile-snippet">{cardSnippet(card)}</p>}
      <span className="v-card-tile-meta">
        {cover && <img src={cover} alt="" style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover' }} />}
        <span>{summarizeContents(card)}</span>
        {!!card.tags?.length && <span>· {card.tags.slice(0, 2).join('、')}</span>}
        {!!card.links?.length && <span>· {card.links.length} 关联</span>}
      </span>
    </button>
  );
}

export default function CardsPage() {
  const ui = useUi();
  const { cards, loadingCards } = useData();
  const [view, setView] = useState<View>('graph');
  const [range, setRange] = useState<Range>('all');
  const [type, setType] = useState('全部');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ cardId: string; x: number; y: number } | null>(null);
  const [keywordCardId, setKeywordCardId] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionFocus, setSuggestionFocus] = useState<string | null>(null);

  const availableTypes = useMemo(() => {
    const present = new Set<string>();
    for (const card of cards) present.add(card.type?.trim() || '知识');
    return ['全部', ...[...present].sort((a, b) => a.localeCompare(b, 'zh'))];
  }, [cards]);

  const effectiveType = availableTypes.includes(type) ? type : '全部';
  const from = cutoff(range);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...cards]
      .filter(card => card.createdAt >= from)
      .filter(card => effectiveType === '全部' || (card.type?.trim() || '知识') === effectiveType)
      .filter(card => {
        if (!needle) return true;
        const haystack = `${cardTitle(card)} ${cardSnippet(card, 1200)} ${(card.tags ?? []).join(' ')}`.toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [cards, effectiveType, from, query]);

  const graph = useMemo(() => buildCardGraph(filtered), [filtered]);
  const suggestions = useMemo(() => buildCardLinkSuggestions(filtered), [filtered]);
  const suggestionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of suggestions) {
      map.set(item.source, (map.get(item.source) ?? 0) + 1);
      map.set(item.target, (map.get(item.target) ?? 0) + 1);
    }
    return map;
  }, [suggestions]);

  const totalCards = cards.length;
  const empty = !loadingCards && cards.length === 0;
  const noResults = !loadingCards && cards.length > 0 && !filtered.length;

  return (
    <div className="v-page">
      <header className="v-cards-head">
        <div>
          <p className="v-page-eyebrow">过去与现在的想法</p>
          <h1 className="v-page-title">卡片</h1>
          <p className="v-page-sub">
            {totalCards ? `${totalCards} 张卡片 · ${graph.edges.length} 条确认关系` : '把一闪而过的想法留下来'}
          </p>
        </div>
        <button type="button" className="v-btn v-btn--primary v-btn--lg" onClick={() => ui.openCardEditor(createCard(), true)}>
          <Plus size={18} /> 新建卡片
        </button>
      </header>

      <div className="v-cards-toolbar">
        <div className="v-seg" role="group" aria-label="卡片视图">
          <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>
            <Network size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            关系网
          </button>
          <button type="button" aria-pressed={view === 'library'} onClick={() => setView('library')}>
            <Layers size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            卡片库
          </button>
        </div>
        <label className="v-search">
          <Search size={15} />
          <input
            className="v-field"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索标题、内容或标签"
            aria-label="搜索卡片"
          />
        </label>
        <div className="v-filter-row">
          {RANGES.map(item => (
            <button
              key={item.id}
              type="button"
              className={`v-pill ${range === item.id ? 'v-pill--on' : ''}`}
              aria-pressed={range === item.id}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {availableTypes.length > 2 && (
        <div className="v-filter-row" style={{ paddingBottom: 12, marginTop: -4 }}>
          {availableTypes.map(item => (
            <button
              key={item}
              type="button"
              className={`v-pill ${effectiveType === item ? 'v-pill--accent' : ''}`}
              aria-pressed={effectiveType === item}
              onClick={() => setType(item)}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <div className="v-card" style={{ padding: 0 }}>
          <div className="v-empty" style={{ padding: '70px 24px' }}>
            <div className="v-empty-icon"><Layers size={26} /></div>
            <strong>还没有卡片</strong>
            <p>记下今天的一个想法。以后它们会在关系网里慢慢连起来。</p>
            <button type="button" className="v-btn v-btn--primary" style={{ marginTop: 6 }} onClick={() => ui.openCardEditor(createCard(), true)}>
              <Plus size={16} /> 新建第一张卡片
            </button>
          </div>
        </div>
      ) : noResults ? (
        <div className="v-card" style={{ padding: 0 }}>
          <div className="v-empty" style={{ padding: '58px 24px' }}>
            <div className="v-empty-icon"><Search size={22} /></div>
            <strong>没有匹配的卡片</strong>
            <p>换一个关键词或时间范围试试。</p>
            <button
              type="button"
              className="v-btn v-btn--soft"
              style={{ marginTop: 4 }}
              onClick={() => { setQuery(''); setRange('all'); setType('全部'); }}
            >
              清除筛选
            </button>
          </div>
        </div>
      ) : view === 'graph' ? (
        <>
          <div className="v-graph-status">
            <span className="v-tiny">
              {filtered.length} 张卡片 · {graph.edges.length} 条确认连线
            </span>
            <button
              type="button"
              className="v-btn v-btn--soft v-btn--sm"
              onClick={() => { setSuggestionFocus(null); setSuggestionsOpen(true); }}
            >
              <Sparkles size={14} /> 关联建议 {suggestions.length}
            </button>
          </div>
          <CardGraphView
            nodes={graph.nodes}
            edges={graph.edges}
            suggestions={suggestions}
            onOpen={id => ui.openCardDetail(id)}
            onLongPress={(id, x, y) => setMenu({ cardId: id, x, y })}
          />
        </>
      ) : (
        <>
          <div className="v-row" style={{ justifyContent: 'space-between', margin: '0 2px 8px' }}>
            <span className="v-tiny">共 {filtered.length} 张</span>
            <span className="v-tiny">按时间从新到旧</span>
          </div>
          <div className="v-cards-grid">
            {filtered.map(card => (
              <CardTile key={card.id} card={card} onOpen={() => ui.openCardDetail(card.id)} />
            ))}
          </div>
        </>
      )}

      <CardContextMenu
        open={!!menu}
        card={menu ? cards.find(card => card.id === menu.cardId) ?? null : null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        extensions={GRAPH_MENU_EXTENSIONS}
        suggestionCount={menu ? suggestionCounts.get(menu.cardId) ?? 0 : 0}
        onOpenSuggestions={card => {
          setSuggestionFocus(card.id);
          setSuggestionsOpen(true);
        }}
        onClose={() => setMenu(null)}
        onSetKeywords={card => {
          setKeywordCardId(card.id);
        }}
      />
      <CardKeywordSheet
        open={!!keywordCardId}
        card={keywordCardId ? cards.find(card => card.id === keywordCardId) ?? null : null}
        onClose={() => setKeywordCardId(null)}
      />
      <CardLinkSuggestionsSheet
        open={suggestionsOpen}
        suggestions={suggestions}
        focusCardId={suggestionFocus}
        onClearFocus={() => setSuggestionFocus(null)}
        onClose={() => { setSuggestionsOpen(false); setSuggestionFocus(null); }}
      />
    </div>
  );
}
