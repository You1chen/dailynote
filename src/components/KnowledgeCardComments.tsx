import { useRef, useState } from 'react';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { Image as ImageIcon, Pencil, Trash2, X } from 'lucide-react';
import type { KnowledgeCardContent, KnowledgeComment } from '../types/knowledge';
import { fileToCompressedDataURL } from '../utils/avatarCrop';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';
import './KnowledgeCardComments.css';

interface Props {
  content: KnowledgeCardContent;
  onUpdate: (comments: KnowledgeComment[]) => void;
  onClose: () => void;
}

const makeId = () => `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const MAX_IMAGES = 6;

export default function KnowledgeCardComments({ content, onUpdate, onClose }: Props) {
  const [comments, setComments] = useState<KnowledgeComment[]>(() => content.comments ?? []);
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sheetDrag = useSheetDrag(onClose, !busy && !confirmSave && !deleteId && !lightbox);

  function closeTopLayer() {
    if (confirmSave) setConfirmSave(false);
    else if (deleteId) setDeleteId(null);
    else if (lightbox) setLightbox(null);
    else onClose();
  }

  useRegisterBackHandler(() => {
    closeTopLayer();
    return true;
  }, [confirmSave, deleteId, lightbox, onClose]);

  function publish(next: KnowledgeComment[]) {
    setComments(next);
    onUpdate(next);
  }
  function resetForm() {
    setText('');
    setImages([]);
    setEditingId(null);
    setError('');
  }
  function startEdit(comment: KnowledgeComment) {
    setEditingId(comment.id);
    setText(comment.text);
    setImages([...comment.images]);
    setError('');
  }
  async function addImages(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      const next: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');
        const data = await fileToCompressedDataURL(file, 1600, 0.82);
        if (data) next.push(data);
      }
      setImages(current => [...current, ...next].slice(0, MAX_IMAGES));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  function requestSave() {
    if (busy) return;
    if (!text.trim() && !images.length) {
      setError('写点内容或加张图片。');
      return;
    }
    setError('');
    setConfirmSave(true);
  }
  function save() {
    const clean = text.trim();
    const now = Date.now();
    if (editingId) {
      publish(comments.map(comment => comment.id === editingId ? { ...comment, text: clean, images, updatedAt: now } : comment));
    } else {
      publish([...comments, { id: makeId(), text: clean, images, createdAt: now, updatedAt: now }]);
    }
    setConfirmSave(false);
    resetForm();
  }
  function remove(id: string) {
    publish(comments.filter(comment => comment.id !== id));
    setDeleteId(null);
    if (editingId === id) resetForm();
  }

  return <div className="kce-comments" role="dialog" aria-modal="true" aria-label="评论">
    <section className="kce-comments-sheet" style={sheetDrag.style}>
      <header className="kce-comments-header">
        <div className="kce-comments-grip" {...sheetDrag.handlers} aria-label="下拉关闭评论"><span/></div>
        <div><span>评论</span><strong>{comments.length}</strong></div>
        <button type="button" onClick={closeTopLayer} aria-label="关闭评论"><X size={20} /></button>
      </header>
      <div className="kce-comments-list">
        {!comments.length && <p className="kce-comments-empty">还没有评论</p>}
        {[...comments].sort((a, b) => b.createdAt - a.createdAt).map(comment => <article key={comment.id} className="kce-comment">
          <p>{comment.text}</p>
          <div className="kce-comment-timestamps">
            <time dateTime={new Date(comment.createdAt).toISOString()}>创建于 {new Date(comment.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
            {comment.updatedAt !== comment.createdAt && <time dateTime={new Date(comment.updatedAt).toISOString()}>编辑于 {new Date(comment.updatedAt).toLocaleString('zh-CN', { hour12: false })}</time>}
          </div>
          {!!comment.images.length && <div className="kce-comment-images">{comment.images.map((image, index) => <button type="button" key={index} onClick={() => setLightbox(image)} aria-label={`查看评论图片 ${index + 1}`}><img src={image} alt={`评论图片 ${index + 1}`} /></button>)}</div>}
          <div className="kce-comment-actions">
            <button type="button" onClick={() => startEdit(comment)} aria-label="编辑评论"><Pencil size={14} /> 编辑</button>
            <button type="button" onClick={() => setDeleteId(comment.id)} aria-label="删除评论"><Trash2 size={14} /> 删除</button>
          </div>
        </article>)}
      </div>
      <div className="kce-comment-form">
        {editingId && <div className="kce-comment-editing"><span>正在编辑评论</span><button type="button" onClick={resetForm}>取消</button></div>}
        <textarea aria-label="评论内容" placeholder="写评论…" value={text} onChange={event => setText(event.target.value)} rows={3} />
        {!!images.length && <div className="kce-comment-drafts">{images.map((image, index) => <div key={index}><img src={image} alt={`待发布图片 ${index + 1}`} /><button type="button" aria-label={`移除图片 ${index + 1}`} onClick={() => setImages(current => current.filter((_, i) => i !== index))}><X size={12} /></button></div>)}</div>}
        {error && <p className="kce-error" role="alert">{error}</p>}
        <div className="kce-comment-tools">
          <button type="button" className="kce-comment-image" disabled={busy || images.length >= MAX_IMAGES} onClick={() => fileInput.current?.click()}><ImageIcon size={17} /> 图片</button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={event => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            void addImages(files);
          }} />
          <button type="button" className="kce-comment-send" disabled={busy} onClick={requestSave}>{editingId ? '保存修改' : '发表评论'}</button>
        </div>
      </div>
    </section>
    {lightbox && <div className="kce-fullscreen" role="dialog" aria-modal="true" aria-label="评论图片"><button type="button" onClick={() => setLightbox(null)} aria-label="关闭图片"><X size={25} /></button><img src={lightbox} alt="评论图片全屏预览" /></div>}
    <ConfirmDialog open={confirmSave} message={editingId ? '保存这条评论的修改？' : '发表这条评论？'} confirmText={editingId ? '保存修改' : '发表'} onCancel={() => setConfirmSave(false)} onConfirm={save} />
    <ConfirmDialog open={!!deleteId} message="删除这条评论？" confirmText="删除" onCancel={() => setDeleteId(null)} onConfirm={() => deleteId && remove(deleteId)} />
  </div>;
}
