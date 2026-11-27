import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useRegisterBackHandler } from '../../contexts/BackButtonContext';
import {
  DEFAULT_CARD_TYPES,
  deleteCard,
  getCards,
  getCustomCardTypes,
  saveCard,
} from '../../db/knowledgeCards';
import { fileToCompressedDataURL } from '../../utils/avatarCrop';
import { exportCardData } from '../../utils/knowledgeCards';
import { KNOWLEDGE_STATUS_LABEL } from '../../utils/knowledgeMap';
import type { KnowledgeCard, KnowledgeCardContent, KnowledgeStatus } from '../../types/knowledge';
import { useData, effectiveCourseIds } from '../state/DataProvider';
import { useUi } from '../state/ui';
import {
  cardSnippet,
  cardTitle,
  imageContent,
  normalizeCard,
  textContent,
} from '../utils/cards';
import { normalizeCardRef, replaceCardReferenceTitle } from '../utils/cardLinks';

interface Props {
  open: boolean;
  card: KnowledgeCard | null;
  isNew: boolean;
  onClose: () => void;
  onSaved?: (card: KnowledgeCard) => void;
}

interface RefPickerState {
  contentId: string;
  start: number;
  end: number;
  query: string;
}

const STATUS_OPTIONS: Array<{ value: '' | KnowledgeStatus; label: string }> = [
  { value: '', label: '无状态' },
  ...(['todo', 'debt', 'learned'] as KnowledgeStatus[]).map(value => ({ value, label: KNOWLEDGE_STATUS_LABEL[value] })),
];

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

/** Minimal full-screen card editor modelled on the pre-redesign page. */
export default function CardEditorSheet({ open, card, isNew, onClose, onSaved }: Props) {
  const ui = useUi();
  const { cards, legacyCardCourses, reloadCards } = useData();
  const [draftState, setDraft] = useState<KnowledgeCard | null>(null);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refPicker, setRefPicker] = useState<RefPickerState | null>(null);
  const initial = useRef('');
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !card) return;
    const next = cloneCard(card);
    next.courseIds = effectiveCourseIds(card, legacyCardCourses);
    setDraft(next);
    initial.current = JSON.stringify(next);
    setCurrentIndex(next.contents.length ? 0 : -1);
    setBusy(false);
    setError('');
    setLightbox(null);
    setMenuOpen(false);
    setRefPicker(null);
  }, [open, card, isNew, legacyCardCourses]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getCustomCardTypes()
      .then(list => { if (alive) setCustomTypes(list); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const types = useMemo(() => {
    const set = new Set<string>([...DEFAULT_CARD_TYPES, ...customTypes]);
    for (const item of cards) if (item.type) set.add(item.type);
    if (draftState?.type) set.add(draftState.type);
    return [...set];
  }, [cards, customTypes, draftState?.type]);

  const dirty = !!draftState && !!open && JSON.stringify(draftState) !== initial.current;

  function requestClose() {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    void ui.confirm({
      title: '放弃这次修改？',
      message: '卡片还没有保存。',
      confirmLabel: '放弃',
      cancelLabel: '继续编辑',
      danger: true,
    }).then(ok => { if (ok) onClose(); });
  }

  useRegisterBackHandler(() => {
    if (!open) return false;
    if (document.querySelector('.v-sheet')) return false;
    requestClose();
    return true;
  }, [open, dirty, busy, onClose], 'overlay');

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      if (refPicker) {
        setRefPicker(null);
        return;
      }
      if (document.querySelector('.v-sheet')) return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, menuOpen, refPicker, dirty, busy, onClose]);

  const refMatches = useMemo(() => {
    if (!refPicker || !draftState) return [];
    const query = normalizeCardRef(refPicker.query);
    return cards
      .filter(item => item.id !== draftState.id)
      .filter(item => {
        if (!query) return true;
        return [item.title, ...(item.keywords ?? []), ...(item.tags ?? [])]
          .some(value => normalizeCardRef(value).includes(query));
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 6);
  }, [refPicker, cards, draftState]);

  if (!open || !draftState) return null;
  const draft = draftState;

  const count = draft.contents.length;
  const safeIndex = count ? Math.min(Math.max(currentIndex, 0), count - 1) : -1;
  const current: KnowledgeCardContent | undefined = safeIndex >= 0 ? draft.contents[safeIndex] : undefined;

  function patch(changes: Partial<KnowledgeCard>) {
    setDraft(currentDraft => currentDraft ? { ...currentDraft, ...changes } : currentDraft);
  }

  function patchContent(id: string, text: string) {
    patch({
      contents: draft.contents.map(content => content.id === id && content.kind === 'text'
        ? { ...content, text, updatedAt: Date.now() }
        : content),
    });
  }

  function selectIndex(next: number) {
    setCurrentIndex(next);
    setRefPicker(null);
  }

  function addText() {
    const block = textContent('');
    patch({ contents: [...draft.contents, block] });
    selectIndex(draft.contents.length);
    window.setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 80);
  }

  async function addImages(files: File[]) {
    if (!files.length) return;
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
      if (additions.length) {
        const start = draft.contents.length;
        patch({ contents: [...draft.contents, ...additions] });
        selectIndex(start);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加图片失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  function removeCurrent() {
    if (!current) return;
    const contents = draft.contents.filter(content => content.id !== current.id);
    patch({ contents });
    selectIndex(Math.min(safeIndex, contents.length - 1));
  }

  function updateRefPicker(textarea: HTMLTextAreaElement, contentId: string) {
    const caret = textarea.selectionStart ?? 0;
    const before = textarea.value.slice(0, caret);
    const match = /\[\[([^\[\]\n]{0,60})$/.exec(before);
    if (!match) {
      setRefPicker(null);
      return;
    }
    const start = caret - match[0].length;
    setRefPicker({ contentId, start, end: caret, query: match[1] });
  }

  function chooseRef(title: string) {
    if (!refPicker) return;
    const block = draft.contents.find(content => content.id === refPicker.contentId);
    if (!block || block.kind !== 'text') return;
    const insertion = `[[${title}]]`;
    const next = block.text.slice(0, refPicker.start) + insertion + block.text.slice(refPicker.end);
    const caret = refPicker.start + insertion.length;
    patchContent(block.id, next);
    setRefPicker(null);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(caret, caret);
    });
  }

  async function save() {
    if (busy) return;
    const oldTitle = (card?.title ?? '').trim();
    const contents = draft.contents.filter(content => content.kind !== 'text' || content.text.trim());
    const title = draft.title.trim()
      || contents.find(content => content.kind === 'text')?.text.trim().slice(0, 40)
      || '未命名卡片';
    const next = normalizeCard({ ...draft, title, contents, updatedAt: Date.now() });
    setBusy(true);
    setError('');
    try {
      await saveCard(next);
      // Renaming a page in Logseq updates its inline references. Keep that
      // promise here so links never silently rot when a card title changes.
      if (!isNew && oldTitle && oldTitle !== title) {
        const fresh = await getCards();
        for (const other of fresh) {
          if (other.id === next.id) continue;
          let changed = false;
          const nextContents = other.contents.map(content => {
            if (content.kind !== 'text') return content;
            const text = replaceCardReferenceTitle(content.text, oldTitle, title);
            if (text === content.text) return content;
            changed = true;
            return { ...content, text, updatedAt: Date.now() };
          });
          if (changed) await saveCard({ ...other, contents: nextContents, updatedAt: Date.now() });
        }
      }
      await reloadCards();
      ui.toast(isNew ? '卡片已创建' : '卡片已保存');
      onSaved?.(next);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
      setBusy(false);
    }
  }

  async function exportCurrent() {
    setMenuOpen(false);
    try {
      const result = await exportCardData(draft);
      ui.toast(result.native ? `已导出到 ${result.path}` : '卡片已导出');
    } catch (cause) {
      ui.toast(cause instanceof Error ? cause.message : '导出失败，请重试');
    }
  }

  async function removeCard() {
    setMenuOpen(false);
    if (isNew) return;
    const ok = await ui.confirm({
      title: '删除这张卡片？',
      message: '卡片内容、图片以及关系网里的连线会一起删除，无法恢复。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCard(draft.id);
      await reloadCards();
      ui.toast('卡片已删除');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试。');
      setBusy(false);
    }
  }

  const contentNode = current ? (
    current.kind === 'text' ? (
      <textarea
        ref={textareaRef}
        className="v-editor-textarea"
        value={current.text}
        onChange={event => {
          patchContent(current.id, event.target.value);
          updateRefPicker(event.target, current.id);
        }}
        onClick={event => updateRefPicker(event.currentTarget, current.id)}
        onKeyUp={event => updateRefPicker(event.currentTarget, current.id)}
        onSelect={event => updateRefPicker(event.currentTarget, current.id)}
        placeholder="写点什么… 输入 [[ 可以链接另一张卡片"
        aria-label="卡片正文"
        spellCheck={false}
      />
    ) : current.kind === 'image' ? (
      <div className="v-editor-image-page">
        <button type="button" className="v-editor-image-open" onClick={() => setLightbox(current.data)} aria-label="查看图片">
          <img src={current.data} alt="卡片图片" />
        </button>
      </div>
    ) : (
      <div className="v-editor-audio-page">
        <div className="v-tiny">录音 · {Math.max(1, Math.round(current.durationMs / 1000))} 秒</div>
        <audio controls preload="metadata" src={current.data} />
      </div>
    )
  ) : (
    <button type="button" className="v-editor-empty" onClick={addText} aria-label="添加文字内容">
      <Plus size={38} />
    </button>
  );

  const page = (
    <div className="v-card-editor" role="dialog" aria-modal="true" aria-label={isNew ? '新建卡片' : '编辑卡片'}>
      <header className="v-editor-bar">
        <button type="button" className="v-editor-icon" aria-label="返回" onClick={requestClose} disabled={busy}>
          <ArrowLeft size={22} />
        </button>
        <h1>卡片</h1>
        <div className="v-editor-bar-right">
          <label className="v-editor-type">
            <select
              value={draft.type?.trim() || '知识'}
              onChange={event => patch({ type: event.target.value })}
              aria-label="卡片类型"
            >
              {types.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </label>
          <button type="button" className="v-editor-icon" aria-label="导出或删除" onClick={() => setMenuOpen(value => !value)}>
            <Download size={19} />
          </button>
          <button type="button" className="v-editor-save" onClick={() => void save()} disabled={busy}>
            {busy ? '保存中' : '保存'}
          </button>
        </div>
      </header>

      <main className="v-editor-main">
        <div className="v-editor-title-row">
          <input
            ref={titleRef}
            className="v-editor-title"
            value={draft.title}
            onChange={event => patch({ title: event.target.value })}
            placeholder="卡片名称"
            maxLength={80}
            aria-label="卡片名称"
          />
          <label className="v-editor-status">
            <select
              value={draft.status ?? ''}
              onChange={event => patch({ status: (event.target.value || undefined) as KnowledgeStatus | undefined })}
              aria-label="卡片状态"
            >
              {STATUS_OPTIONS.map(option => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        </div>

        <div className={`v-editor-content${current ? '' : ' is-empty'}`}>
          {contentNode}
        </div>

        {refPicker && (
          <div className="v-ref-picker" role="listbox" aria-label="链接卡片">
            <div className="v-ref-picker-head">{refPicker.query ? '链接到卡片' : '选择一张卡片'}</div>
            {refMatches.length ? refMatches.map(item => (
              <button
                key={item.id}
                type="button"
                className="v-ref-picker-row"
                onMouseDown={event => event.preventDefault()}
                onClick={() => chooseRef(cardTitle(item))}
              >
                <span className="v-ref-picker-title">{cardTitle(item)}</span>
                <span className="v-ref-picker-sub">{cardSnippet(item, 28) || '空白卡片'}</span>
              </button>
            )) : (
              <div className="v-ref-picker-empty">没有匹配的卡片，仍然可以保留为未链接引用</div>
            )}
          </div>
        )}

        {!!error && <p className="v-editor-error" role="alert">{error}</p>}
        {current?.kind === 'text' && !current.text && !refPicker && (
          <p className="v-editor-hint">输入 [[ 可以链接另一张卡片</p>
        )}
      </main>

      <div className="v-editor-pager">
        <button
          type="button"
          aria-label="上一项"
          disabled={safeIndex <= 0}
          onClick={() => selectIndex(safeIndex - 1)}
        >
          <ChevronLeft size={20} />
        </button>
        <span>{count ? `${safeIndex + 1} / ${count}` : '暂无内容'}</span>
        <button
          type="button"
          aria-label="下一项"
          disabled={safeIndex < 0 || safeIndex >= count - 1}
          onClick={() => selectIndex(safeIndex + 1)}
        >
          <ChevronRight size={20} />
        </button>
        <span className="v-editor-pager-gap" />
        <button type="button" aria-label="删除当前内容" disabled={!current || busy} onClick={removeCurrent}>
          <Trash2 size={18} />
        </button>
      </div>

      <div className="v-editor-actions">
        <button type="button" className="v-editor-add-text" onClick={addText} disabled={busy}>
          <Plus size={19} /> 文字
        </button>
        <button type="button" className="v-editor-add-image" onClick={() => fileRef.current?.click()} disabled={busy}>
          <ImageIcon size={19} /> 图片
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

      {menuOpen && (
        <>
          <button type="button" className="v-editor-menu-backdrop" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />
          <div className="v-editor-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => void exportCurrent()}>
              <Download size={15} /> 导出卡片
            </button>
            {!isNew && (
              <button type="button" role="menuitem" className="is-danger" onClick={() => void removeCard()}>
                <Trash2 size={15} /> 删除卡片
              </button>
            )}
          </div>
        </>
      )}

      {lightbox && (
        <div className="v-lightbox" role="dialog" aria-label="查看图片" onClick={() => setLightbox(null)}>
          <button type="button" aria-label="关闭" onClick={() => setLightbox(null)}><X size={20} /></button>
          <img src={lightbox} alt="卡片图片" onClick={event => event.stopPropagation()} />
        </div>
      )}
    </div>
  );

  return createPortal(page, document.body);
}
