import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouteBack } from '../hooks/useRouteBack';
import { format } from 'date-fns';
import { ArrowLeft, Plus, Trash2, X, MapPin, ScanText, ShieldCheck, RotateCcw, type LucideIcon } from 'lucide-react';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { minutesUntilDeadline, ddlRemainText, splitDeadlineItems, splitDismissed } from '../utils/ddl';
import { renderMarkdown } from '../utils/markdown';
import {
  extractFromText,
  buildNotes,
  planExtraction,
  collectApplied,
  mergeExtractions,
  type MergedExtraction,
  type PlannedRow,
} from '../utils/extract';
import { linkIcon, linkKey, linkText, normalizeLinks } from '../utils/ddlLinks';
import { fileToCompressedDataURL } from '../utils/imageCompression';
import { recognizeImage, ocrAvailable } from '../services/ocr';
import ConfirmDialog from './ConfirmDialog';
import Lightbox from './Lightbox';
import LinkPicker from './LinkPicker';
import type { DdlLink } from '../types';
import './DeadlineListPage.css';

/** 备注图片上限（压缩后单条约 ≤3MB） */
const MAX_IMAGES = 9;

export interface DeadlineBase {
  id?: number;
  name: string;
  deadlineDate: string;
  deadlineTime: string;
  location: string;
  notes: string;
  images: string[];
  links?: DdlLink[];
  dismissedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface Form {
  name: string;
  deadlineDate: string;
  deadlineTime: string;
  location: string;
  notes: string;
  images: string[];
  links: DdlLink[];
}

/** 识别结果的一行：直接复用抽取层的 PlannedRow，避免两处字段定义漂移 */
type ReviewRow = PlannedRow;

export interface DeadlineListProps<T extends DeadlineBase> {
  title: string;
  addLabel: string;
  nameLabel: string;
  namePlaceholder: string;
  emptyTitle: string;
  emptyHint: string;
  countText: (n: number) => string;
  /** 过期超过多少分钟就收起来（不传 = 全部显示） */
  hideAfterMinutes?: number;
  /** 是否提供「解除威胁」（重要的事不需要） */
  allowDismiss?: boolean;
  /** 是否允许「关联内容」（课程 / 自定义分组）。只有 DDL 用，重要的事传 false */
  allowLinks?: boolean;
  icon: LucideIcon;
  api: {
    getAll: () => Promise<T[]>;
    save: (item: T) => Promise<number>;
    remove: (id: number) => Promise<void>;
  };
}

/**
 * 「带截止时间的事项」列表页：DDL 与「重要的事」共用同一套结构与样式，
 * 只有页面标题、按钮与空状态文案不同（避免两页各写一遍）。
 */
export default function DeadlineListPage<T extends DeadlineBase>({
  title,
  addLabel,
  nameLabel,
  namePlaceholder,
  emptyTitle,
  emptyHint,
  countText,
  hideAfterMinutes,
  allowLinks = false,
  allowDismiss = true,
  icon: Icon,
  api,
}: DeadlineListProps<T>) {
  const routeBack = useRouteBack();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  // 弹窗：undefined=关闭，null=新建，T=编辑
  const [editing, setEditing] = useState<T | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [busyImages, setBusyImages] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<T | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // 备注：编辑 / 预览
  const [notePreview, setNotePreview] = useState(false);
  // 图片查看器
  const [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(null);
  // 图片识别（全部备注图片）
  const [ocrBusy, setOcrBusy] = useState(false);
  const [recog, setRecog] = useState<ReviewRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 关联内容选择器（仅 allowLinks 时可用）
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setItems(await api.getAll());
  }, [api]);

  useEffect(() => {
    (async () => { await reload(); setLoading(false); })();
  }, [reload]);

  const closeModal = useCallback(() => {
    setEditing(undefined);
    setForm(null);
    setError('');
    setNotePreview(false);
    setRecog(null);
    setPickerOpen(false);
  }, []);

  const formSheet = useSheetDrag(closeModal, editing !== undefined && !busyImages && !viewer && !recog && !pickerOpen);

  // Android 返回键：先关查看器/弹窗，再退出页面
  useRegisterBackHandler(() => {
    if (viewer) { setViewer(null); return true; }
    if (recog) { setRecog(null); return true; }
    if (editing !== undefined) { closeModal(); return true; }
    routeBack();
    return true;
  }, [editing, closeModal, viewer, recog, routeBack]);

  const openCreate = () => {
    setForm({ name: '', deadlineDate: '', deadlineTime: '', location: '', notes: '', images: [], links: [] });
    setEditing(null);
    setNotePreview(false);
    setRecog(null);
    setPickerOpen(false);
  };

  const openEdit = (item: T) => {
    setForm({
      name: item.name,
      deadlineDate: item.deadlineDate,
      deadlineTime: item.deadlineTime ?? '',
      location: item.location ?? '',
      notes: item.notes,
      images: [...item.images],
      links: allowLinks ? [...(item.links ?? [])] : [],
    });
    setEditing(item);
    setNotePreview(false);
    setRecog(null);
    setPickerOpen(false);
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 立即重置，允许再次选择同一文件
    if (!form || files.length === 0) return;
    const room = MAX_IMAGES - form.images.length;
    if (room <= 0) return;
    setBusyImages(true);
    const added: string[] = [];
    for (const f of files.slice(0, room)) {
      try {
        const url = await fileToCompressedDataURL(f);
        if (url) added.push(url);
      } catch {
        // 跳过无法解码的坏图
      }
    }
    setForm(prev => (prev ? { ...prev, images: [...prev.images, ...added] } : prev));
    setBusyImages(false);
  };

  const handleSave = async () => {
    if (!form) return;
    if (!form.name.trim()) { setError('请输入名称'); return; }
    if (!form.deadlineDate) { setError('请填写截止日期'); return; }
    const payload = {
      id: editing?.id,
      name: form.name.trim(),
      deadlineDate: form.deadlineDate,
      deadlineTime: form.deadlineTime,
      location: form.location.trim(),
      notes: form.notes,
      images: form.images,
      links: form.links,
      dismissedAt: editing?.dismissedAt ?? 0,
      // 「重要的事」不写关联字段（共用组件，按 allowLinks 关闭）
      ...(allowLinks ? { links: normalizeLinks(form.links) } : {}),
      createdAt: editing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    } as T;
    await api.save(payload);
    closeModal();
    await reload();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    await api.remove(target.id!);
    await reload();
  };

  // ============ 图片识别 ============

  /** 识别结果与现有内容比对（一样跳过、不同待取舍、空直接填） */
  const buildRows = (merged: MergedExtraction, f: Form): ReviewRow[] =>
    planExtraction(
      merged.info,
      {
        name: f.name,
        deadlineDate: f.deadlineDate,
        deadlineTime: f.deadlineTime,
        location: f.location,
        notes: f.notes,
      },
      merged.candidates,
    );
  /** 识别全部备注图片，文本合并后再抽取 */
  const handleOcr = async () => {
    if (!form) return;
    if (!ocrAvailable()) {
      setNotice('图片识别只在 Android 版可用');
      return;
    }
    if (form.images.length === 0) {
      setNotice('先添加备注图片');
      return;
    }
    setOcrBusy(true);
    try {
      const infos = [];
      for (const img of form.images) {
        try {
          const res = await recognizeImage(img);
          infos.push(extractFromText(res.text));
        } catch {
          // 单张失败不影响其它图
        }
      }
      const merged = mergeExtractions(infos);
      const { info } = merged;
      const hasCandidates = Object.keys(merged.candidates).length > 0;
      if (!info.title && !info.date && !info.time && !info.location && !info.notes && !hasCandidates) {
        setNotice('这几张图里没找到可用信息');
        return;
      }
      setRecog(buildRows(merged, form));
    } catch {
      setNotice('识别失败，换张图试试');
    } finally {
      setOcrBusy(false);
    }
  };

  const applyRecog = (rows: ReviewRow[]) => {
    if (!form) return;
    const { fields, requirements, emails } = collectApplied(rows);

    const next = { ...form };
    if (fields.name) next.name = fields.name.slice(0, 30);
    if (fields.deadlineDate) next.deadlineDate = fields.deadlineDate;
    if (fields.deadlineTime) next.deadlineTime = fields.deadlineTime;
    if (fields.location) next.location = fields.location;

    const added = buildNotes(requirements, emails);
    if (added) next.notes = next.notes.trim() ? `${next.notes.trim()}\n\n${added}` : added;

    setForm(next);
    setRecog(null);
  };

  const patchRow = (id: string, patch: Partial<ReviewRow>) => {
    setRecog(rows => rows?.map(r => (r.id === id ? { ...r, ...patch } : r)) ?? null);
  };

  const removeRow = (id: string) => {
    setRecog(rows => rows?.filter(r => r.id !== id) ?? null);
  };

  // 解除后 30 秒要隐藏，只有存在「刚解除」的条目时才开秒表
  const hasDismissing = items.some(i => {
    const at = (i as { dismissedAt?: number }).dismissedAt ?? 0;
    return at > 0 && now - at < 30_000;
  });

  useEffect(() => {
    if (!hasDismissing) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasDismissing]);

  /** 解除威胁：褪色 + 显示「危机解除」，30 秒后隐藏 */
  const dismissItem = async (item: T) => {
    await api.save({ ...item, dismissedAt: Date.now() } as T);
    setNow(Date.now());
    await reload();
  };

  /** 撤销解除，重新显示 */
  const restoreItem = async (item: T) => {
    await api.save({ ...item, dismissedAt: 0 } as T);
    await reload();
  };
  const badge = (item: T) => {
    if ((item.dismissedAt ?? 0) > 0) {
      return <span className="ddl-badge ddl-badge--resolved">危机解除</span>;
    }
    const m = minutesUntilDeadline(item);
    if (m == null) return <span className="ddl-badge">—</span>;
    return (
      <span className={`ddl-badge ${m <= 0 ? 'ddl-badge--expired' : ''}`}>
        {ddlRemainText(m)}
      </span>
    );
  };

  // 先按「解除」状态分组，再对未解除的应用过期收起
  const dismiss = splitDismissed(items, now);
  const { visible, hidden } = splitDeadlineItems(
    dismiss.active.concat(dismiss.dismissing),
    new Date(),
    hideAfterMinutes,
  );

  const renderCard = (item: T) => (
    <div
      key={item.id}
      className={`ddl-card${(item.dismissedAt ?? 0) > 0 ? ' ddl-card--dismissed' : ''}`}
      onClick={() => openEdit(item)}
    >
      <div className="ddl-name">{item.name}</div>

      <div className="ddl-deadline-row">
        <span className="ddl-deadline">
          {format(new Date(item.deadlineDate + 'T00:00:00'), 'yyyy年M月d日')}
          {item.deadlineTime ? ` ${item.deadlineTime}` : ''}
        </span>
        {badge(item)}
        {item.location?.trim() && (
          <span className="ddl-loc"><MapPin size={11} /> {item.location}</span>
        )}
      </div>

      {(item.links?.length ?? 0) > 0 && (
        <div className="ddl-card-links">
          {item.links!.map(l => (
            <span key={linkKey(l)} className="ddl-card-link">{linkIcon(l)} {linkText(l)}</span>
          ))}
        </div>
      )}

      {item.notes.trim() && (
        <div
          className="ddl-notes-preview md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.notes) }}
        />
      )}

      {item.images.length > 0 && (
        <button
          className="ddl-img-strip"
          onClick={e => { e.stopPropagation(); setViewer({ images: item.images, index: 0 }); }}
        >
          {item.images.slice(0, 3).map((url, i) => (
            <img key={i} src={url} alt="" className="ddl-img-thumb" />
          ))}
          <span className="ddl-img-count">🖼{item.images.length}</span>
        </button>
      )}

      <div className="ddl-card-actions">
        {!allowDismiss ? null : ((item as { dismissedAt?: number }).dismissedAt ?? 0) > 0 ? (
          <button
            className="btn btn-ghost btn-icon ddl-card-restore"
            title="恢复显示"
            onClick={e => { e.stopPropagation(); restoreItem(item); }}
          >
            <RotateCcw size={16} />
          </button>
        ) : (
          <button
            className="btn btn-ghost btn-icon ddl-card-dismiss"
            title="解除威胁"
            onClick={e => { e.stopPropagation(); dismissItem(item); }}
          >
            <ShieldCheck size={16} />
          </button>
        )}

        <button
          className="btn btn-ghost btn-icon ddl-card-del"
          title="删除"
          onClick={e => { e.stopPropagation(); setPendingDelete(item); }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );

  const conflictCount = recog?.filter(r => r.action === 'conflict' && r.useValue).length ?? 0;

  return (
    <div className="app-container">
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" aria-label="返回" onClick={routeBack}>
          <ArrowLeft size={22} />
        </button>
        <h1 className="page-title">{title}</h1>
        <span style={{ width: 36 }} />
      </div>

      <div className="ddl-section-header">
        <span className="ddl-section-count">{loading ? '' : countText(items.length)}</span>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <Plus size={16} /> {addLabel}
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>加载中...</p></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Icon size={36} className="icon" />
          <p>{emptyTitle}</p>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
            {emptyHint}
          </span>
        </div>
      ) : (
        <>
          <div className="ddl-list">{visible.map(renderCard)}</div>

          {hidden.length > 0 && (
            <div className="ddl-hidden">
              <button className="ddl-hidden-toggle" onClick={() => setShowHidden(v => !v)}>
                已过期 {hidden.length} 件 · {showHidden ? '收起' : '展开'}
              </button>
              {showHidden && <div className="ddl-list">{hidden.map(renderCard)}</div>}
            </div>
          )}
          {dismiss.dismissed.length > 0 && (
            <div className="ddl-hidden">
              <button className="ddl-hidden-toggle" onClick={() => setShowDismissed(v => !v)}>
                已解除 {dismiss.dismissed.length} 件 · {showDismissed ? '收起' : '展开'}
              </button>
              {showDismissed && <div className="ddl-list">{dismiss.dismissed.map(renderCard)}</div>}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        message={pendingDelete ? `删除「${pendingDelete.name}」？删除后可在回收站恢复。` : ''}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      {/* 新建/编辑弹窗 */}
      {editing !== undefined && form && (
        <div className="modal-overlay" onClick={() => !busyImages && closeModal()}>
          <div className="modal" style={formSheet.style} onClick={e => e.stopPropagation()}>
            <div className="sheet-grip" {...formSheet.handlers} aria-hidden="true" />
            <h3 className="modal-title">{editing ? '编辑' : addLabel}</h3>

            <div className="ddl-field">
              <label className="ddl-field-label">{nameLabel}</label>
              <input
                className="input"
                value={form.name}
                maxLength={30}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={namePlaceholder}
              />
            </div>

            <div className="ddl-field">
              <label className="ddl-field-label">截止时间</label>
              <div className="ddl-row">
                <input
                  className="input"
                  type="date"
                  value={form.deadlineDate}
                  onChange={e => setForm({ ...form, deadlineDate: e.target.value })}
                />
                <input
                  className="input"
                  type="time"
                  value={form.deadlineTime}
                  onChange={e => setForm({ ...form, deadlineTime: e.target.value })}
                />
              </div>
            </div>

            <div className="ddl-field">
              <label className="ddl-field-label">地点</label>
              <input
                className="input"
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                placeholder="地点"
              />
            </div>

            {allowLinks && (
              <div className="ddl-field">
                <div className="ddl-field-head">
                  <label className="ddl-field-label">关联</label>
                  <button className="ddl-link-add" onClick={() => setPickerOpen(true)}>
                    <Plus size={13} /> 关联
                  </button>
                </div>
                {form.links.length > 0 ? (
                  <div className="ddl-link-chips">
                    {form.links.map(l => (
                      <span key={linkKey(l)} className={`ddl-link-chip ddl-link-chip--${l.kind}`}>
                        <span className="ddl-link-chip-text">{linkIcon(l)} {linkText(l)}</span>
                        <button
                          className="ddl-link-chip-x"
                          title="取消关联"
                          onClick={() => setForm({
                            ...form,
                            links: form.links.filter(x => linkKey(x) !== linkKey(l)),
                          })}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            <div className="ddl-field">
              <div className="ddl-field-head">
                <label className="ddl-field-label">备注</label>
                <span className="ddl-note-tabs">
                  <button
                    className={notePreview ? '' : 'ddl-note-tab--on'}
                    onClick={() => setNotePreview(false)}
                  >编辑</button>
                  <button
                    className={notePreview ? 'ddl-note-tab--on' : ''}
                    onClick={() => setNotePreview(true)}
                  >预览</button>
                </span>
              </div>
              {notePreview ? (
                <div
                  className="ddl-note-preview md"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(form.notes) || '<p class="ddl-note-empty">还没有内容</p>',
                  }}
                />
              ) : (
                <textarea
                  className="input textarea"
                  rows={6}
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="支持 Markdown"
                />
              )}
            </div>

            <div className="ddl-field">
              <div className="ddl-field-head">
                <label className="ddl-field-label">
                  备注图片 {form.images.length}/{MAX_IMAGES}
                </label>
                <button
                  className="ddl-ocr-btn"
                  onClick={handleOcr}
                  disabled={ocrBusy || busyImages || form.images.length === 0}
                >
                  <ScanText size={13} /> {ocrBusy ? '识别中...' : '识别'}
                </button>
              </div>
              <div className="ddl-thumbs">
                {form.images.map((url, i) => (
                  <div key={i} className="ddl-thumb-wrap">
                    <img
                      className="ddl-thumb"
                      src={url}
                      alt={`备注图 ${i + 1}`}
                      onClick={() => setViewer({ images: form.images, index: i })}
                    />
                    <button
                      className="ddl-thumb-del"
                      title="移除图片"
                      onClick={() => setForm({
                        ...form,
                        images: form.images.filter((_, j) => j !== i),
                      })}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  className="ddl-add-thumb"
                  disabled={busyImages || form.images.length >= MAX_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                  title="添加图片"
                >
                  <Plus size={18} />
                </button>
              </div>
              {busyImages && <p className="ddl-hint">图片处理中...</p>}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleFiles}
              />
            </div>

            {error && <p className="ddl-error">{error}</p>}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={closeModal} disabled={busyImages}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={busyImages}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 关联选择器：放在弹窗外面，避免被弹窗的层叠/裁剪影响 */}
      {allowLinks && (
        <LinkPicker
          open={pickerOpen}
          links={form?.links ?? []}
          onChange={next => setForm(prev => (prev ? { ...prev, links: next } : prev))}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* 识别结果：逐行可改可删，冲突行由用户取舍 */}
      {recog && (
        <div className="modal-overlay" onClick={() => setRecog(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">识别结果</h3>

            <div className="ddl-recog-list">
              {recog.length === 0 && <p className="ddl-note-empty">没有可用信息</p>}

              {recog.map(row => (
                <div key={row.id} className={`ddl-recog-row ${row.action === 'skip' ? 'ddl-recog-row--skip' : ''}`}>
                  <span className="ddl-recog-label">{row.label}</span>

                  <div className="ddl-recog-main">
                    <input
                      className="ddl-recog-input"
                      value={row.value}
                      onChange={e => patchRow(row.id, { value: e.target.value })}
                    />

                    {row.candidates && row.candidates.length > 1 && (
                      <div className="ddl-recog-cands">
                        <span className="ddl-recog-cands-label">图与图不同</span>
                        {row.candidates.map(c => (
                          <button
                            key={c}
                            className={c === row.value ? 'ddl-recog-cand--on' : ''}
                            onClick={() => patchRow(row.id, { value: c })}
                          >{c}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {row.action === 'skip' && <span className="ddl-recog-state">已存在</span>}

                  {row.action === 'conflict' && (
                    <span className="ddl-recog-choose">
                      <button
                        className={row.useValue ? '' : 'ddl-recog-choose--on'}
                        onClick={() => patchRow(row.id, { useValue: false })}
                      >保留原值</button>
                      <button
                        className={row.useValue ? 'ddl-recog-choose--on' : ''}
                        onClick={() => patchRow(row.id, { useValue: true })}
                      >用识别值</button>
                    </span>
                  )}

                  <button className="ddl-recog-del" title="删除这一行" onClick={() => removeRow(row.id)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>

            {conflictCount > 0 && (
              <p className="ddl-hint">{conflictCount} 处内容不同，已保留原值。</p>
            )}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRecog(null)}>取消</button>
              <button className="btn btn-primary" onClick={() => applyRecog(recog)}>填入</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={notice !== null}
        message={notice ?? ''}
        onCancel={() => setNotice(null)}
      />

      {viewer && (
        <Lightbox
          images={viewer.images}
          index={viewer.index}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
