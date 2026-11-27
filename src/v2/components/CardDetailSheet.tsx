import { useMemo, useState } from 'react';
import { Link2, Pencil, X } from 'lucide-react';
import Sheet from './Sheet';
import CardRichText from './CardRichText';
import { saveCard } from '../../db/knowledgeCards';
import type { KnowledgeCard } from '../../types/knowledge';
import { KNOWLEDGE_STATUS_LABEL } from '../../utils/knowledgeMap';
import { cardDateKey, dateGroupLabel } from '../../utils/knowledgeCards';
import { buildCardLinkSuggestions } from '../utils/cardDiscovery';
import { resolvedCardReferencePairs, stripCardReferences } from '../utils/cardLinks';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import {
  cardSnippet,
  cardTitle,
  createCard,
  summarizeContents,
  textContent,
  typeMeta,
} from '../utils/cards';

interface Props {
  open: boolean;
  cardId: string | null;
  onClose: () => void;
}

interface Backlink {
  card: KnowledgeCard;
  text: string;
}

export default function CardDetailSheet({ open, cardId, onClose }: Props) {
  const { cards, reloadCards } = useData();
  const ui = useUi();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const card = useMemo(() => cards.find(item => item.id === cardId), [cards, cardId]);

  const referencePairs = useMemo(() => resolvedCardReferencePairs(cards), [cards]);

  const backlinks = useMemo<Backlink[]>(() => {
    if (!card) return [];
    const bySource = new Map<string, Backlink>();
    for (const pair of referencePairs) {
      if (pair.target !== card.id) continue;
      const source = cards.find(item => item.id === pair.source);
      if (!source) continue;
      const text = source.contents.find(content => content.kind === 'text' && content.text.includes(`[[${pair.title}]]`));
      bySource.set(source.id, { card: source, text: text?.kind === 'text' ? text.text : '' });
    }
    for (const source of cards) {
      if (source.id === card.id || !(source.links ?? []).includes(card.id)) continue;
      if (!bySource.has(source.id)) bySource.set(source.id, { card: source, text: '' });
    }
    return [...bySource.values()].sort((left, right) => right.card.updatedAt - left.card.updatedAt);
  }, [card, cards, referencePairs]);

  const unlinked = useMemo(() => {
    if (!card) return [];
    if (!normalizeRef(card.title)) return [];
    return buildCardLinkSuggestions(cards, { semantic: false })
      .filter(item => item.kind === 'literal' && item.target === card.id)
      .slice(0, 6)
      .map(item => cards.find(source => source.id === item.source))
      .filter((source): source is KnowledgeCard => !!source && source.id !== card.id);
  }, [cards, card]);

  if (!card) return null;

  const meta = typeMeta(card.type);
  const comments = card.contents.flatMap(content => content.comments ?? []);
  const statusLabel = card.status ? KNOWLEDGE_STATUS_LABEL[card.status] : '无状态';

  async function openMissing(title: string) {
    const ok = await ui.confirm({
      title: '创建这张卡片？',
      message: `「${title}」还没有卡片，创建后会在这里链接过去。`,
      confirmLabel: '创建',
    });
    if (!ok) return;
    const next = createCard({ title });
    await saveCard(next);
    await reloadCards();
    onClose();
    ui.openCardDetail(next.id);
  }

  async function linkMention(source: KnowledgeCard) {
    const targetTitle = (card?.title ?? '').trim() || '未命名卡片';
    const firstText = source.contents.find(content => content.kind === 'text');
    const contents = firstText
      ? source.contents.map(content => content.id === firstText.id && content.kind === 'text'
        ? { ...content, text: `${content.text.trimEnd()}\n[[${targetTitle}]]`, updatedAt: Date.now() }
        : content)
      : [...source.contents, textContent(`[[${targetTitle}]]`)];
    try {
      await saveCard({ ...source, contents, updatedAt: Date.now() });
      await reloadCards();
      ui.toast('已添加链接');
    } catch {
      ui.toast('添加链接失败，请重试');
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="卡片"
        subtitle={`${dateGroupLabel(cardDateKey(card.createdAt))} · ${summarizeContents(card)}`}
        footer={(
          <>
            <span className="v-grow" />
            <button type="button" className="v-btn v-btn--ghost" onClick={onClose}>关闭</button>
            <button type="button" className="v-btn v-btn--primary" onClick={() => { onClose(); ui.openCardEditor(card, false); }}>
              <Pencil size={15} /> 编辑
            </button>
          </>
        )}
      >
        <h1 className="v-logseq-title">{cardTitle(card)}</h1>
        <div className="v-logseq-meta">
          <span className="v-type-dot" style={{ background: meta.color }} />
          <span style={{ color: meta.color }}>{meta.label}</span>
          <span>·</span>
          <span>{statusLabel}</span>
          <span>·</span>
          <span>{dateGroupLabel(cardDateKey(card.createdAt))}</span>
        </div>

        <div className="v-logseq-body">
          {card.contents.map(content => {
            if (content.kind === 'text') {
              if (!content.text.trim()) return null;
              return (
                <div className="v-logseq-block" key={content.id}>
                  <span className="v-logseq-bullet" aria-hidden="true" />
                  <CardRichText
                    text={content.text}
                    cards={cards}
                    currentId={card.id}
                    onOpenCard={id => ui.openCardDetail(id)}
                    onMissingCard={title => void openMissing(title)}
                  />
                </div>
              );
            }
            if (content.kind === 'image') {
              return (
                <div className="v-detail-images" key={content.id}>
                  <button type="button" onClick={() => setLightbox(content.data)}>
                    <img src={content.data} alt="卡片图片" />
                  </button>
                </div>
              );
            }
            return (
              <div className="v-content-block" key={content.id} style={{ padding: 12, marginBottom: 12 }}>
                <div className="v-tiny" style={{ marginBottom: 6 }}>录音 · {Math.max(1, Math.round(content.durationMs / 1000))} 秒</div>
                <audio controls preload="metadata" src={content.data} style={{ width: '100%' }} />
              </div>
            );
          })}

          {!card.contents.some(content => content.kind === 'text' && content.text.trim()) && cardSnippet(card) && (
            <div className="v-logseq-block">
              <span className="v-logseq-bullet" aria-hidden="true" />
              <span>{cardSnippet(card)}</span>
            </div>
          )}
        </div>

        {!!comments.length && (
          <>
            <div className="v-sep" />
            <div className="v-card-title">
              <h3>评论</h3>
              <span>{comments.length} 条</span>
            </div>
            {comments.map(comment => (
              <div key={comment.id} style={{ marginBottom: 10 }}>
                {comment.text && (
                  <p className="v-detail-text" style={{ fontSize: 13.5, marginBottom: 6 }}>
                    <CardRichText
                      text={comment.text}
                      cards={cards}
                      currentId={card.id}
                      onOpenCard={id => ui.openCardDetail(id)}
                      onMissingCard={title => void openMissing(title)}
                    />
                  </p>
                )}
                {!!comment.images?.length && (
                  <div className="v-detail-images" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 0 }}>
                    {comment.images.map((data, index) => (
                      <button type="button" key={`${comment.id}-${index}`} onClick={() => setLightbox(data)}>
                        <img src={data} alt="评论图片" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {!!backlinks.length && (
          <section className="v-logseq-refs">
            <div className="v-logseq-ref-head">
              <h3><Link2 size={15} /> 关联引用</h3>
              <span>{backlinks.length}</span>
            </div>
            {backlinks.map(item => (
              <button
                key={item.card.id}
                type="button"
                className="v-logseq-ref-row"
                onClick={() => ui.openCardDetail(item.card.id)}
              >
                <span className="v-logseq-ref-date">{dateGroupLabel(cardDateKey(item.card.updatedAt))}</span>
                <span className="v-logseq-ref-title">{cardTitle(item.card)}</span>
                {item.text && (
                  <span className="v-logseq-ref-text">{stripCardReferences(item.text).slice(0, 180)}</span>
                )}
              </button>
            ))}
          </section>
        )}

        {!!unlinked.length && (
          <section className="v-logseq-refs">
            <div className="v-logseq-ref-head">
              <h3>未链接提及</h3>
              <span>{unlinked.length}</span>
            </div>
            {unlinked.map(source => (
              <div className="v-logseq-unlinked" key={source.id}>
                <div>
                  <span className="v-logseq-ref-title">{cardTitle(source)}</span>
                  <span className="v-logseq-ref-text">{cardSnippet(source, 100)}</span>
                </div>
                <button type="button" className="v-btn v-btn--soft v-btn--sm" onClick={() => void linkMention(source)}>
                  链接
                </button>
              </div>
            ))}
          </section>
        )}
      </Sheet>

      {lightbox && (
        <div className="v-lightbox" role="dialog" aria-label="查看图片" onClick={() => setLightbox(null)}>
          <button type="button" aria-label="关闭" onClick={() => setLightbox(null)}><X size={20} /></button>
          <img src={lightbox} alt="卡片图片大图" onClick={event => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}

function normalizeRef(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}
