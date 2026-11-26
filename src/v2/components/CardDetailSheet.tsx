import { useMemo, useState } from 'react';
import { Link2, Pencil, X } from 'lucide-react';
import Sheet from './Sheet';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import {
  cardSnippet,
  cardTitle,
  summarizeContents,
  typeMeta,
} from '../utils/cards';
import { cardDateKey, dateGroupLabel } from '../../utils/knowledgeCards';

interface Props {
  open: boolean;
  cardId: string | null;
  onClose: () => void;
}

export default function CardDetailSheet({ open, cardId, onClose }: Props) {
  const { cards, courses } = useData();
  const ui = useUi();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const card = useMemo(() => cards.find(item => item.id === cardId), [cards, cardId]);

  if (!card) return null;
  const meta = typeMeta(card.type);
  const linked = (card.links ?? [])
    .map(id => cards.find(item => item.id === id))
    .filter((item): item is NonNullable<typeof item> => !!item);
  const courseNames = (card.courseIds ?? [])
    .map(id => courses.find(course => course.id === id)?.name)
    .filter((name): name is string => !!name);
  const comments = card.contents.flatMap(content => content.comments ?? []);

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
        <h1 className="v-detail-title">{cardTitle(card)}</h1>
        <div className="v-detail-meta">
          <span className="v-type-dot" style={{ background: meta.color }} />
          <span style={{ color: meta.color }}>{meta.label}</span>
          <span>·</span>
          <span>{dateGroupLabel(cardDateKey(card.createdAt))}</span>
          {!!card.tags?.length && <span>·</span>}
          {card.tags?.map(tag => <span key={tag} className="v-chip v-chip--soft" style={{ height: 22, fontSize: 11 }}>{tag}</span>)}
        </div>

        {!!courseNames.length && (
          <div className="v-row v-row--wrap" style={{ gap: 6, marginBottom: 14 }}>
            {courseNames.map(name => <span key={name} className="v-chip v-chip--course">{name}</span>)}
          </div>
        )}

        {!!card.keywords?.length && (
          <div className="v-row v-row--wrap" style={{ gap: 6, marginBottom: 14 }}>
            <span className="v-tiny" style={{ marginRight: 2 }}>关键词</span>
            {card.keywords.map(keyword => <span key={keyword} className="v-chip v-chip--soft">{keyword}</span>)}
          </div>
        )}

        {card.contents.map(content => {
          if (content.kind === 'text') {
            return content.text.trim() ? <p className="v-detail-text" key={content.id}>{content.text}</p> : null;
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
          <p className="v-detail-text">{cardSnippet(card)}</p>
        )}

        {!!comments.length && (
          <>
            <div className="v-sep" />
            <div className="v-card-title">
              <h3>评论</h3>
              <span>{comments.length} 条</span>
            </div>
            {comments.map(comment => (
              <div key={comment.id} style={{ marginBottom: 10 }}>
                {comment.text && <p className="v-detail-text" style={{ fontSize: 13.5, marginBottom: 6 }}>{comment.text}</p>}
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

        <div className="v-sep" />
        <div className="v-card-title">
          <h3><Link2 size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />已确认关联</h3>
          <span>{linked.length} 张</span>
        </div>
        {linked.length ? (
          <div className="v-type-chips">
            {linked.map(item => {
              const linkedMeta = typeMeta(item.type);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="v-chip"
                  onClick={() => ui.openCardDetail(item.id)}
                >
                  <span className="v-type-dot" style={{ background: linkedMeta.color }} />
                  {cardTitle(item)}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="v-tiny" style={{ margin: '0 2px', lineHeight: 1.6 }}>
            还没有已确认的关联。点「编辑」可以挑选卡片；系统在正文里发现的相关卡片会先进入「关联建议」，确认后才连线。
          </p>
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
