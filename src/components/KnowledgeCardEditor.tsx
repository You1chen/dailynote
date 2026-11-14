import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Image as ImageIcon, MessageCircle, Mic, Plus, Square, Trash2, X } from 'lucide-react';
import type { KnowledgeCard, KnowledgeCardContent, KnowledgeStatus } from '../types/knowledge';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { fileToCompressedDataURL } from '../utils/avatarCrop';
import { DEFAULT_AUDIO_EXPORT_PATH, exportAudioBlob } from '../utils/knowledgeCards';
import ConfirmDialog from './ConfirmDialog';
import KnowledgeCardComments from './KnowledgeCardComments';
import './KnowledgeCardEditor.css';

export interface KnowledgeCardEditorProps {
  card: KnowledgeCard;
  onSave: (card: KnowledgeCard) => Promise<void>;
  onClose: () => void;
  audioExportPath?: string;
}

type RecordingPhase = 'idle' | 'permission' | 'recording' | 'processing';
type RecordingSession = {
  recorder: MediaRecorder;
  stream: MediaStream;
  done: Promise<void>;
  finish: () => void;
  cancelled: boolean;
};
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('无法读取录音，请重试。'));
  reader.onabort = () => reject(new Error('录音读取已取消。'));
  reader.readAsDataURL(blob);
});

export function KnowledgeCardEditor({ card, onSave, onClose, audioExportPath = DEFAULT_AUDIO_EXPORT_PATH }: KnowledgeCardEditorProps) {
  const [draft, setDraft] = useState<KnowledgeCard>(() => ({ ...card, contents: card.contents.map(item => ({ ...item })) }));
  const draftRef = useRef(draft);
  const [index, setIndex] = useState(0);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const phaseRef = useRef<RecordingPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [commentContentId, setCommentContentId] = useState<string | null>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const permissionToken = useRef(0);
  const session = useRef<RecordingSession | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const current = draft.contents[Math.min(index, Math.max(0, draft.contents.length - 1))];
  const commentContent = draft.contents.find(item => item.id === commentContentId) ?? null;

  function updatePhase(next: RecordingPhase) {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }
  function patch(changes: Partial<KnowledgeCard>) {
    const next = { ...draftRef.current, ...changes, updatedAt: Date.now() };
    draftRef.current = next;
    if (mounted.current) setDraft(next);
  }
  function append(contents: KnowledgeCardContent[]) {
    const previous = draftRef.current.contents;
    patch({ contents: [...previous, ...contents] });
    setIndex(previous.length);
  }
  function clearPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }
  function cancelPermission() {
    permissionToken.current += 1;
    updatePhase('idle');
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      permissionToken.current += 1;
      if (pressTimer.current) clearTimeout(pressTimer.current);
      const active = session.current;
      if (active) {
        active.cancelled = true;
        active.recorder.ondataavailable = null;
        active.recorder.onstop = null;
        active.recorder.onerror = null;
        if (active.recorder.state !== 'inactive') {
          try { active.recorder.stop(); } catch { /* Tracks are still stopped below. */ }
        }
        active.stream.getTracks().forEach(track => track.stop());
        active.finish();
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => clearInterval(timer);
  }, [phase]);

  async function startRecording() {
    if (operation.current || phaseRef.current !== 'idle') return;
    setError('');
    setNotice('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前环境不支持录音。');
      return;
    }
    const token = ++permissionToken.current;
    updatePhase('permission');
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || token !== permissionToken.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(type => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      let resolveDone!: () => void;
      const done = new Promise<void>(resolve => { resolveDone = resolve; });
      const active: RecordingSession = { recorder, stream, done, finish: resolveDone, cancelled: false };
      session.current = active;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        active.cancelled = true;
        if (mounted.current) setError('录音中断，请检查麦克风后重试。');
        active.stream.getTracks().forEach(track => track.stop());
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { /* Finish the session even if stop fails. */ }
        }
        if (session.current === active) session.current = null;
        updatePhase('idle');
        active.finish();
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAt;
        active.stream.getTracks().forEach(track => track.stop());
        if (!active.cancelled && mounted.current) updatePhase('processing');
        void (async () => {
          try {
            if (active.cancelled || !mounted.current) return;
            const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
            const blob = new Blob(chunks, { type: mimeType });
            if (!blob.size) throw new Error('没有录到声音，请重试。');
            const data = await blobDataUrl(blob);
            if (!mounted.current || active.cancelled) return;
            const now = Date.now();
            append([{ id: makeId(), kind: 'audio', data, mimeType, durationMs, fileName: `录音-${now}`, createdAt: now, updatedAt: now }]);
          } catch (cause) {
            if (mounted.current) setError(errorText(cause));
          } finally {
            if (session.current === active) {
              session.current = null;
              updatePhase('idle');
            }
            active.finish();
          }
        })();
      };
      recorder.start();
      updatePhase('recording');
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop());
      const active = session.current;
      if (active && active.stream === stream) {
        active.finish();
        session.current = null;
      }
      if (mounted.current && token === permissionToken.current) {
        updatePhase('idle');
        setError(`无法开始录音，请检查麦克风权限。${errorText(cause)}`);
      }
    }
  }

  async function stopRecording() {
    const active = session.current;
    if (!active) return;
    if (active.recorder.state !== 'inactive') {
      updatePhase('processing');
      try { active.recorder.stop(); }
      catch (cause) {
        active.cancelled = true;
        active.stream.getTracks().forEach(track => track.stop());
        session.current = null;
        updatePhase('idle');
        setError(`无法结束录音：${errorText(cause)}`);
        active.finish();
      }
    }
    await active.done;
  }

  async function saveAndClose(explicit: boolean) {
    if (operation.current) return;
    if (explicit && !draftRef.current.title.trim()) {
      setError('请先填写卡片名称，再保存。');
      titleInput.current?.focus();
      return;
    }
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      clearPress();
      if (phaseRef.current === 'permission') cancelPermission();
      if (session.current) await stopRecording();
      if (!mounted.current) return;
      const latest = draftRef.current;
      const contents = latest.contents.filter(item => item.kind === 'text' ? !!item.text.trim() : !!item.data);
      if (!latest.title.trim() && !contents.length) { onClose(); return; }
      const saved: KnowledgeCard = {
        ...latest, contents, title: latest.title.trim() || '未命名卡片', updatedAt: Date.now(),
      };
      await onSave(saved);
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current) setError(`保存失败，草稿已保留。${errorText(cause)}`);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useRegisterBackHandler(() => {
    if (commentContentId) { setCommentContentId(null); return true; }
    if (confirmDelete) { setConfirmDelete(false); return true; }
    if (fullscreenImage) setFullscreenImage(null);
    else if (phaseRef.current === 'permission') cancelPermission();
    else if (phaseRef.current !== 'idle') void stopRecording();
    else void saveAndClose(false);
    return true;
  }, [commentContentId, confirmDelete, fullscreenImage, onSave, onClose]);

  function addText() {
    if (operation.current || phaseRef.current !== 'idle') return;
    const now = Date.now();
    append([{ id: makeId(), kind: 'text', text: '', createdAt: now, updatedAt: now }]);
    requestAnimationFrame(() => { if (mounted.current) textInput.current?.focus(); });
  }

  async function addImages(files: File[]) {
    if (!files.length || operation.current || phaseRef.current !== 'idle') return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const additions: KnowledgeCardContent[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');
        const data = await fileToCompressedDataURL(file, 1600, 0.82);
        if (!data) throw new Error('图片压缩失败，请重试。');
        const now = Date.now();
        additions.push({ id: makeId(), kind: 'image', data, createdAt: now, updatedAt: now });
      }
      if (mounted.current) append(additions);
    } catch (cause) {
      if (mounted.current) setError(`添加图片失败：${errorText(cause)}`);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function exportAudio(content: Extract<KnowledgeCardContent, { kind: 'audio' }>) {
    if (exporting) return;
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const result = await exportAudioBlob(content.data, audioExportPath, content.fileName, content.mimeType);
      if (mounted.current) setNotice(result.path ? `录音已导出至 ${result.path}` : '已开始下载录音');
    } catch (cause) {
      if (mounted.current) setError(`录音导出失败：${errorText(cause)}`);
    } finally { if (mounted.current) setExporting(false); }
  }

  const locked = busy || phase !== 'idle';
  return <section className="kce" role="dialog" aria-modal="true" aria-label="编辑知识卡片" aria-busy={busy}>
    <header className="kce-header">
      <button type="button" onClick={() => void saveAndClose(false)} disabled={busy} aria-label="保存草稿并返回"><ArrowLeft size={21} /></button>
      <span>知识卡片</span>
      <button type="button" className="kce-save" disabled={locked} onClick={() => void saveAndClose(true)}>{busy ? '处理中…' : '保存'}</button>
    </header>
    <div className="kce-meta">
      <input ref={titleInput} aria-label="卡片名称" placeholder="卡片名称" value={draft.title} disabled={locked} onChange={event => patch({ title: event.target.value })} />
      <select aria-label="学习状态" value={draft.status ?? ''} disabled={locked} onChange={event => patch({ status: (event.target.value || undefined) as KnowledgeStatus | undefined })}>
        <option value="">无状态</option><option value="todo">待学习</option><option value="debt">待补充</option><option value="learned">已掌握</option>
      </select>
    </div>
    <main className="kce-viewport" onTouchStart={event => {
      const target = event.target as HTMLElement;
      swipe.current = null;
      if (target.closest('textarea, input, audio, select') || (target.closest('button') && !target.closest('.kce-image'))) return;
      const touch = event.touches[0];
      swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    }} onTouchCancel={() => { swipe.current = null; }} onTouchEnd={event => {
      const start = swipe.current;
      swipe.current = null;
      const end = event.changedTouches[0];
      if (!start || !end || locked) return;
      const dx = end.clientX - start.x;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(end.clientY - start.y) * 1.3) setIndex(value => Math.max(0, Math.min(draft.contents.length - 1, value + (dx < 0 ? 1 : -1))));
    }}>
      {!current && <div className="kce-empty"><Plus size={32} /></div>}
      {current?.kind === 'text' && <textarea key={current.id} ref={textInput} className="kce-text" aria-label={`第 ${index + 1} 条文字内容`} placeholder="写一点内容…" value={current.text} disabled={locked} onChange={event => {
        const text = event.target.value;
        patch({ contents: draftRef.current.contents.map(item => item.id === current.id && item.kind === 'text' ? { ...item, text, updatedAt: Date.now() } : item) });
      }} />}
      {current?.kind === 'image' && <button type="button" className="kce-image" aria-label="全屏查看图片" onClick={() => setFullscreenImage(current.data)}><img src={current.data} alt={`卡片图片 ${index + 1}`} draggable={false} /></button>}
      {current && <button type="button" className="kce-comments-bubble" aria-label={`评论 ${current.comments?.length ?? 0}`} onClick={() => setCommentContentId(current.id)}><MessageCircle size={17} /><span>{current.comments?.length ?? 0}</span></button>}
      {current?.kind === 'audio' && <div className="kce-audio"><Mic size={36} /><strong>{current.fileName}</strong><audio key={current.id} controls preload="metadata" src={current.data} /><small>{Math.max(1, Math.round(current.durationMs / 1000))} 秒</small><button type="button" disabled={exporting} onClick={() => void exportAudio(current)}><Download size={17} />{exporting ? '正在导出…' : '导出录音'}</button></div>}
    </main>
    <nav className="kce-navigation" aria-label="内容翻页">
      <button type="button" disabled={locked || index <= 0} onClick={() => setIndex(value => Math.max(0, value - 1))} aria-label="上一条"><ChevronLeft size={22} /></button>
      <span aria-live="polite">{draft.contents.length ? `${index + 1} / ${draft.contents.length}` : '暂无内容'}</span>
      <button type="button" disabled={locked || index >= draft.contents.length - 1} onClick={() => setIndex(value => Math.min(draft.contents.length - 1, value + 1))} aria-label="下一条"><ChevronRight size={22} /></button>
      <button type="button" className="kce-delete" aria-label="删除当前内容" disabled={locked || !current} onClick={() => setConfirmDelete(true)}><Trash2 size={17} /></button>
    </nav>
    {error && <p className="kce-message kce-error" role="alert">{error}</p>}
    {notice && <p className="kce-message" role="status">{notice}</p>}
    <footer className="kce-toolbar">
      <button type="button" className="kce-add" disabled={locked} aria-label="添加文字；长按开始录音" onContextMenu={event => event.preventDefault()} onPointerDown={event => {
        if (event.button !== 0) return;
        clearPress();
        longPressed.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
        pressTimer.current = setTimeout(() => { longPressed.current = true; pressTimer.current = null; void startRecording(); }, 500);
      }} onPointerUp={clearPress} onPointerCancel={() => { clearPress(); longPressed.current = true; }} onLostPointerCapture={clearPress} onClick={() => {
        if (longPressed.current) { longPressed.current = false; return; }
        addText();
      }}><Plus size={25} /><span>文字</span></button>
      <button type="button" disabled={locked} onClick={() => fileInput.current?.click()}><ImageIcon size={22} /><span>图片</span></button>
      <input ref={fileInput} className="kce-file" type="file" accept="image/*" multiple onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        void addImages(files);
      }} />
    </footer>
    {phase !== 'idle' && <div className="kce-recording" role="dialog" aria-modal="true" aria-label="录音">
      <div className="kce-recording-panel">
        <Mic size={36} className={phase === 'recording' ? 'kce-live' : ''} />
        <strong>{phase === 'permission' ? '正在请求麦克风权限…' : phase === 'processing' ? '正在保存录音…' : '正在录音'}</strong>
        {phase === 'recording' && <span>{Math.floor(elapsed / 60000).toString().padStart(2, '0')}:{Math.floor(elapsed / 1000 % 60).toString().padStart(2, '0')}</span>}
        {phase === 'permission' && <button type="button" onClick={cancelPermission}>取消</button>}
        {phase === 'recording' && <button type="button" className="kce-stop" onClick={() => void stopRecording()}><Square size={18} />结束录音</button>}
      </div>
    </div>}
    {commentContent && <KnowledgeCardComments content={commentContent} onUpdate={comments => patch({ contents: draftRef.current.contents.map(item => item.id === commentContent.id ? { ...item, comments, updatedAt: Date.now() } : item) })} onClose={() => setCommentContentId(null)} />}
    {fullscreenImage && <div className="kce-fullscreen" role="dialog" aria-modal="true" aria-label="全屏图片"><button type="button" onClick={() => setFullscreenImage(null)} aria-label="关闭全屏图片"><X size={25} /></button><img src={fullscreenImage} alt="卡片图片全屏预览" /></div>}
    <ConfirmDialog open={confirmDelete} message="删除这条内容？" confirmText="删除" onCancel={() => setConfirmDelete(false)} onConfirm={() => {
      const target = current;
      if (!target) { setConfirmDelete(false); return; }
      const remaining = draftRef.current.contents.filter(item => item.id !== target.id);
      patch({ contents: remaining });
      if (commentContentId === target.id) setCommentContentId(null);
      setIndex(value => Math.min(value, Math.max(0, remaining.length - 1)));
      setConfirmDelete(false);
    }} />
  </section>;
}

export default KnowledgeCardEditor;
