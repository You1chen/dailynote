import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Image as ImageIcon,
  Link2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import Sheet from './Sheet';
import CardLinkPicker from './CardLinkPicker';
import {
  DEFAULT_CARD_TYPES,
  deleteCard,
  getCards,
  getCustomCardTypes,
  saveCard,
} from '../../db/knowledgeCards';
import { fileToCompressedDataURL } from '../../utils/avatarCrop';
import type { KnowledgeCard, KnowledgeCardContent } from '../../types/knowledge';
import { useData, effectiveCourseIds } from '../state/DataProvider';
import { useUi } from '../state/ui';
import {
  cardTitle,
  imageContent,
  normalizeCard,
  summarizeContents,
  textContent,
  typeMeta,
} from '../utils/cards';
import { cardDateKey, dateGroupLabel } from '../../utils/knowledgeCards';

interface Props {
  open: boolean;
  card: KnowledgeCard | null;
  isNew: boolean;
  onClose: () => void;
  onSaved?: (card: KnowledgeCard) => void;
}

function cloneCard(card: KnowledgeCard): KnowledgeCard {
  return {
    ...card,
    tags: [...(card.tags ?? [])],
    keywords: [...(card.keywords ?? [])],
    courseIds: [...(card.courseIds ?? [])],
    links: [...(card.links ?? [])],
    ignoredLinks: [...(card.ignoredLinks ?? [])],
    contents: card.contents.map(content => ({ ...content })),
  };
}

function parseTags(value: string): string[] {
  return value
    .split(/[,，、\n]/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default function CardEditorSheet({ open, card, isNew, onClose, onSaved }: Props) {
  const ui = useUi();
  const { cards, courses, legacyCardCourses, reloadCards } = useData();
  const [draft, setDraft] = useState<KnowledgeCard | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !card) return;
    const next = cloneCard(card);
    next.courseIds = effectiveCourseIds(card, legacyCardCourses);
    if (isNew && !next.contents.length) next.contents = [textContent('')];
    setDraft(next);
    setTagInput('');
    setError('');
    setLinkOpen(false);
    setLightbox(null);
  }, [open, card, isNew, legacyCardCourses]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getCustomCardTypes()
      .then(list => { if (alive) setCustomTypes(list); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [open]);

  const types = useMemo(() => {
    const set = new Set<string>([...DEFAULT_CARD_TYPES, ...customTypes]);
    for (const item of cards) if (item.type) set.add(item.type);
    if (draft?.type) set.add(draft.type);
    return [...set];
  }, [cards, customTypes, draft?.type]);

  const linkedCards = useMemo(() => {
    if (!draft) return [];
    return (draft.links ?? [])
      .map(id => cards.find(item => item.id === id))
      .filter((item): item is KnowledgeCard => !!item);
  }, [draft, cards]);

  if (!draft) return null;

  function patch(changes: Partial<KnowledgeCard>) {
    setDraft(current => current ? { ...current, ...changes } : current);
  }

  function patchContent(id: string, text: string) {
    setDraft(current => current ? {
      ...current,
      contents: current.contents.map(content => content.id === id && content.kind === 'text'
        ? { ...content, text, updatedAt: Date.now() }
        : content),
    } : current);
  }

  function removeContent(id: string) {
    setDraft(current => current ? { ...current, contents: current.contents.filter(content => content.id !== id) } : current);
  }

  function addText() {
    setDraft(current => current ? { ...current, contents: [...current.contents, textContent('')] } : current);
  }

  async function addImages(files: File[]) {
    if (!files.length || !draft) return;
    const existing = draft.contents.filter(content => content.kind === 'image').length;
    const room = Math.max(0, 9 - existing);
    if (!room) {
      setError('一张卡片最多放 9 张图片。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const additions: KnowledgeCardContent[] = [];
      for (const file of files.slice(0, room)) {
        if (!file.type.startsWith('image/')) continue;
        const data = await fileToCompressedDataURL(file, 1600, 0.84);
        if (data) additions.push(imageContent(data));
      }
      setDraft(current => current ? { ...current, contents: [...current.contents, ...additions] } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加图片失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  function commitTags() {
    const additions = parseTags(tagInput);
    if (!additions.length) {
      setTagInput('');
      return;
    }
    setDraft(current => current
      ? { ...current, tags: [...new Set([...(current.tags ?? []), ...additions])].slice(0, 12) }
      : current);
    setTagInput('');
  }

  async function save() {
    if (!draft || busy) return;
    commitTags();
    const pendingTags = parseTags(tagInput);
    const contents = draft.contents.filter(content => content.kind !== 'text' || content.text.trim());
    const title = draft.title.trim()
      || contents.find(content => content.kind === 'text')?.text.trim().slice(0, 40)
      || '未命名卡片';
    const next = normalizeCard({
      ...draft,
      title,
      contents,
      tags: [...new Set([...(draft.tags ?? []), ...pendingTags])],
      updatedAt: Date.now(),
    });
    // A card the writer linked manually is no longer a rejected suggestion.
    const linkedIds = new Set(next.links ?? []);
    next.ignoredLinks = (next.ignoredLinks ?? []).filter(id => !linkedIds.has(id));
    setBusy(true);
    setError('');
    try {
      await saveCard(next);
      // Keep manual links symmetric so either side can remove the relation.
      const fresh = await getCards();
      const nextLinks = new Set(next.links ?? []);
      for (const other of fresh) {
        if (other.id === next.id) continue;
        const has = (other.links ?? []).includes(next.id);
        const should = nextLinks.has(other.id);
        const wasIgnored = (other.ignoredLinks ?? []).includes(next.id);
        if (has === should && (!should || !wasIgnored)) continue;
        const links = should
          ? [...new Set([...(other.links ?? []), next.id])]
          : (other.links ?? []).filter(id => id !== next.id);
        const ignoredLinks = should
          ? (other.ignoredLinks ?? []).filter(id => id !== next.id)
          : other.ignoredLinks;
        await saveCard({ ...other, links, ignoredLinks });
      }
      await reloadCards();
      ui.toast(isNew ? '卡片已创建' : '卡片已保存');
      onSaved?.(next);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const id = draft?.id;
    if (!id || busy) return;
    const ok = await ui.confirm({
      title: '删除这张卡片？',
      message: '卡片内容、图片以及关系网里的连线会一起删除，无法恢复。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCard(id);
      await reloadCards();
      ui.toast('卡片已删除');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试。');
      setBusy(false);
    }
  }

  const textBlocks = draft.contents.filter(content => content.kind === 'text');
  const imageBlocks = draft.contents.filter(content => content.kind === 'image');
  const audioBlocks = draft.contents.filter(content => content.kind === 'audio');
  const meta = typeMeta(draft.type);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        busy={busy}
        title={isNew ? '新建卡片' : '编辑卡片'}
        subtitle={`${dateGroupLabel(cardDateKey(draft.createdAt))} · ${summarizeContents(draft)}`}
        footer={(
          <>
            {!isNew && (
              <button type="button" className="v-btn v-btn--ghost" onClick={() => void remove()} disabled={busy}>
                <Trash2 size={15} /> 删除
              </button>
            )}
            <span className="v-grow" />
            <button type="button" className="v-btn v-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
            <button type="button" className="v-btn v-btn--primary" onClick={() => void save()} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </>
        )}
      >
        <input
          className="v-card-editor-title"
          value={draft.title}
          onChange={event => patch({ title: event.target.value })}
          placeholder="卡片标题"
          maxLength={80}
          aria-label="卡片标题"
        />
        <div className="v-editor-meta">
          <span>{dateGroupLabel(cardDateKey(draft.createdAt))}</span>
          <span>·</span>
          <span style={{ color: meta.color }}>{meta.label}</span>
          <span>·</span>
          <span>{draft.contents.length} 条内容</span>
        </div>

        <div className="v-form-group">
          <span className="v-label">类型</span>
          <div className="v-type-chips">
            {types.map(type => (
              <button
                key={type}
                type="button"
                className={`v-chip ${draft.type === type || (!draft.type && type === '知识') ? 'v-chip--on' : ''}`}
                onClick={() => patch({ type })}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="v-form-group">
          <span className="v-label">标签</span>
          <div className="v-tag-input">
            {(draft.tags ?? []).map(tag => (
              <span key={tag} className="v-chip v-chip--soft">
                {tag}
                <button
                  type="button"
                  className="v-chip-x"
                  aria-label={`移除标签 ${tag}`}
                  onClick={() => patch({ tags: (draft.tags ?? []).filter(item => item !== tag) })}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={event => setTagInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                  event.preventDefault();
                  commitTags();
                }
              }}
              onBlur={commitTags}
              placeholder={draft.tags?.length ? '再加一个…' : '如：线代、旅行、灵感'}
              aria-label="添加标签"
            />
          </div>
          <p className="v-tiny" style={{ margin: '5px 2px 0' }}>共享标签会直接连成确认连线。</p>
        </div>

        {!!courses.length && (
          <div className="v-form-group">
            <span className="v-label">关联课程</span>
            <div className="v-type-chips">
              {courses.map(course => {
                const id = course.id ?? -1;
                const on = (draft.courseIds ?? []).includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`v-chip ${on ? 'v-chip--course' : ''}`}
                    onClick={() => patch({
                      courseIds: on
                        ? (draft.courseIds ?? []).filter(item => item !== id)
                        : [...(draft.courseIds ?? []), id],
                    })}
                  >
                    {on && <Check size={12} />}
                    {course.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="v-form-group">
          <span className="v-label">内容</span>
          {textBlocks.map(content => (
            <div className="v-content-block" key={content.id}>
              <textarea
                className="v-textarea"
                value={content.text}
                onChange={event => patchContent(content.id, event.target.value)}
                placeholder="写一点内容…"
                rows={4}
              />
              {textBlocks.length + imageBlocks.length > 1 && (
                <button type="button" className="v-content-block-remove" aria-label="删除这段文字" onClick={() => removeContent(content.id)}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}

          {!!imageBlocks.length && (
            <div
              className={`v-content-images${imageBlocks.length === 1 ? ' v-content-images--single' : ''}`}
              style={{ padding: 0, marginBottom: 10 }}
            >
              {imageBlocks.map(content => content.kind === 'image' ? (
                <div className="v-content-image" key={content.id}>
                  <button type="button" className="v-content-image-open" aria-label="查看图片" onClick={() => setLightbox(content.data)}>
                    <img src={content.data} alt="卡片图片" />
                  </button>
                  <button type="button" className="v-content-image-x" aria-label="删除图片" onClick={() => removeContent(content.id)}>
                    <X size={12} />
                  </button>
                </div>
              ) : null)}
            </div>
          )}

          {!textBlocks.length && !!imageBlocks.length && (
            <p className="v-tiny" style={{ margin: '0 2px 10px' }}>
              图片已保存；点下面的「文字」就能补一段备注。
            </p>
          )}

          {audioBlocks.map(content => content.kind === 'audio' ? (
            <div className="v-content-block" key={content.id} style={{ padding: 12, marginBottom: 10 }}>
              <div className="v-tiny" style={{ marginBottom: 6 }}>录音 · {Math.max(1, Math.round(content.durationMs / 1000))} 秒</div>
              <audio controls preload="metadata" src={content.data} style={{ width: '100%' }} />
            </div>
          ) : null)}

          <div className="v-add-bar">
            <button type="button" className="v-btn" onClick={addText} disabled={busy}>
              <Plus size={15} /> 文字
            </button>
            <button type="button" className="v-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              <ImageIcon size={15} /> 图片
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={event => {
                void addImages(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
          </div>
        </div>

        <div className="v-form-group">
          <span className="v-label">关联卡片</span>
          {linkedCards.length ? (
            <div className="v-type-chips" style={{ marginBottom: 8 }}>
              {linkedCards.map(linked => (
                <span key={linked.id} className="v-chip v-chip--soft">
                  {cardTitle(linked)}
                  <button
                    type="button"
                    className="v-chip-x"
                    aria-label={`取消关联 ${cardTitle(linked)}`}
                    onClick={() => patch({ links: (draft.links ?? []).filter(id => id !== linked.id) })}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="v-tiny" style={{ margin: '0 2px 8px' }}>还没有已确认关联的卡片。</p>
          )}
          <button type="button" className="v-btn v-btn--soft v-btn--sm" onClick={() => setLinkOpen(true)}>
            <Link2 size={14} /> 选择关联卡片
          </button>
        </div>

        {error && <p role="alert" style={{ margin: '2px 0 10px', color: 'var(--v-red)', fontSize: 12.5 }}>{error}</p>}
        <p className="v-tiny" style={{ margin: '4px 2px 0', lineHeight: 1.6 }}>
          相同关键词或标签会直接连成实线；系统在正文里发现的相关卡片，会先进入「关联建议」，确认后才写入关联。
        </p>
      </Sheet>

      <CardLinkPicker
        open={linkOpen}
        currentId={draft.id}
        selected={draft.links ?? []}
        onClose={() => setLinkOpen(false)}
        onConfirm={ids => {
          patch({ links: ids });
          setLinkOpen(false);
        }}
      />

      {lightbox && (
        <div className="v-lightbox" role="dialog" aria-label="查看图片" onClick={() => setLightbox(null)}>
          <button type="button" aria-label="关闭" onClick={() => setLightbox(null)}><X size={20} /></button>
          <img src={lightbox} alt="卡片图片大图" onClick={event => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}
