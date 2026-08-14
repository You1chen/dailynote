import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Plus, Trash2, CalendarClock, X } from 'lucide-react';
import { getAllDdls, saveDdl, deleteDdl } from '../db';
import type { DdlItem } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { minutesUntilDeadline, ddlRemainText } from '../utils/ddl';
import { fileToCompressedDataURL } from '../utils/avatarCrop';
import './DdlPage.css';

/** 备注图片上限（压缩后单条约 ≤3MB） */
const MAX_IMAGES = 9;

interface DdlForm {
  name: string;
  deadlineDate: string;
  deadlineTime: string;
  notes: string;
  images: string[];
}

export default function DdlPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DdlItem[]>([]);
  const [loading, setLoading] = useState(true);
  // 弹窗：undefined=关闭，null=新建，DdlItem=编辑
  const [editing, setEditing] = useState<DdlItem | null | undefined>(undefined);
  const [form, setForm] = useState<DdlForm | null>(null);
  const [error, setError] = useState('');
  const [busyImages, setBusyImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setItems(await getAllDdls());
  }, []);

  useEffect(() => {
    (async () => { await reload(); setLoading(false); })();
  }, [reload]);

  const closeModal = useCallback(() => {
    setEditing(undefined);
    setForm(null);
    setError('');
  }, []);

  // Android 返回键：先关弹窗，再退出页面
  useRegisterBackHandler(() => {
    if (editing !== undefined) { closeModal(); return true; }
    navigate(-1);
    return true;
  }, [editing, closeModal]);

  const openCreate = () => {
    setForm({ name: '', deadlineDate: '', deadlineTime: '', notes: '', images: [] });
    setEditing(null);
  };

  const openEdit = (item: DdlItem) => {
    setForm({
      name: item.name,
      deadlineDate: item.deadlineDate,
      deadlineTime: item.deadlineTime,
      notes: item.notes,
      images: [...item.images],
    });
    setEditing(item);
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
    if (!form.deadlineTime) { setError('请填写截止时间'); return; }
    const payload: DdlItem = {
      id: editing?.id,
      name: form.name.trim(),
      deadlineDate: form.deadlineDate,
      deadlineTime: form.deadlineTime,
      notes: form.notes,
      images: form.images,
      createdAt: editing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await saveDdl(payload);
    closeModal();
    await reload();
  };

  const handleDelete = async (item: DdlItem) => {
    if (!confirm(`确定删除 DDL「${item.name}」？删除后可在回收站恢复。`)) return;
    await deleteDdl(item.id!);
    await reload();
  };

  const badge = (item: DdlItem) => {
    const m = minutesUntilDeadline(item);
    if (m == null) return <span className="ddl-badge">—</span>;
    return (
      <span className={`ddl-badge ${m <= 0 ? 'ddl-badge--expired' : ''}`}>
        {ddlRemainText(m)}
      </span>
    );
  };

  return (
    <div className="app-container">
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={22} />
        </button>
        <h1 className="page-title">DDL</h1>
        <span style={{ width: 36 }} />
      </div>

      <div className="ddl-section-header">
        <span className="ddl-section-count">
          {loading ? '' : `共 ${items.length} 个截止事项`}
        </span>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <Plus size={16} /> 添加 DDL
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>加载中...</p></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <CalendarClock size={36} className="icon" />
          <p>还没有 DDL</p>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
            点击「添加 DDL」收录带截止时间的事项
          </span>
        </div>
      ) : (
        <div className="ddl-list">
          {items.map(item => (
            <div key={item.id} className="ddl-card" onClick={() => openEdit(item)}>
              <div className="ddl-name">
                {item.name}
                {item.images.length > 0 && (
                  <span className="ddl-img-badge">🖼{item.images.length}</span>
                )}
              </div>
              <div className="ddl-deadline-row">
                <span className="ddl-deadline">
                  {format(new Date(item.deadlineDate + 'T00:00:00'), 'yyyy年M月d日')} {item.deadlineTime}
                </span>
                {badge(item)}
              </div>
              {item.notes.trim() && (
                <p className="ddl-notes-preview">{item.notes}</p>
              )}
              <button
                className="btn btn-ghost btn-icon ddl-card-del"
                title="删除"
                onClick={e => { e.stopPropagation(); handleDelete(item); }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      {editing !== undefined && form && (
        <div className="modal-overlay" onClick={() => !busyImages && closeModal()}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editing ? '编辑 DDL' : '添加 DDL'}</h3>

            <div className="ddl-field">
              <label className="ddl-field-label">事件名称</label>
              <input
                className="input"
                value={form.name}
                maxLength={30}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="事件名称"
              />
            </div>

            <div className="ddl-field">
              <label className="ddl-field-label">截止时间（精确到分钟）</label>
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
              <label className="ddl-field-label">备注</label>
              <textarea
                className="input textarea"
                rows={5}
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="备注说明"
              />
            </div>

            <div className="ddl-field">
              <label className="ddl-field-label">
                备注图片（{form.images.length}/{MAX_IMAGES}）
              </label>
              <div className="ddl-thumbs">
                {form.images.map((url, i) => (
                  <div key={i} className="ddl-thumb-wrap">
                    <img className="ddl-thumb" src={url} alt={`备注图 ${i + 1}`} />
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
    </div>
  );
}
