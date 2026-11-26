import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarPlus,
  Camera,
  Check,
  Image as ImageIcon,
  Layers,
  Loader2,
  ScanText,
} from 'lucide-react';
import Sheet from './Sheet';
import { fileToCompressedDataURL } from '../../utils/avatarCrop';
import { createCard, imageContent, textContent } from '../utils/cards';
import { minutesToTime, todayKey } from '../utils/dates';
import { ocrSupported, recognizeText, type OcrProgress } from '../services/ocr';
import { useUi } from '../state/ui';

type Stage = 'pick' | 'preview' | 'working' | 'card-options';
type Pending = 'schedule' | 'card';

interface Props {
  open: boolean;
  onClose: () => void;
}

function nextSlot(): { start: string; end: string } {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = Math.min(22 * 60, Math.ceil((minutes + 1) / 15) * 15);
  return { start: minutesToTime(start), end: minutesToTime(Math.min(1439, start + 60)) };
}

function firstLine(text: string): string {
  return text.split('\n').map(line => line.trim()).find(Boolean) ?? '';
}

export default function CameraSheet({ open, onClose }: Props) {
  const ui = useUi();
  const [stage, setStage] = useState<Stage>('pick');
  const [image, setImage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>('schedule');
  const [recognizeCardText, setRecognizeCardText] = useState(true);
  const [progress, setProgress] = useState<OcrProgress>({ status: '', progress: 0 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    setStage('pick');
    setImage(null);
    setError('');
    setBusy(false);
    setProgress({ status: '', progress: 0 });
    setRecognizeCardText(true);
    runId.current += 1;
  }, [open]);

  function close() {
    runId.current += 1;
    onClose();
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await fileToCompressedDataURL(file, 2000, 0.9);
      if (!mounted.current || !data) return;
      setImage(data);
      setStage('preview');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片读取失败，请重试。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function openCard(dataUrl: string, text = '') {
    const clean = text.trim();
    const card = createCard({
      title: clean ? firstLine(clean).slice(0, 40) : '',
      type: '知识',
      contents: [
        ...(clean ? [textContent(clean)] : []),
        imageContent(dataUrl),
      ],
      keywords: [],
    });
    close();
    ui.openCardEditor(card, true);
  }

  async function recognizeThen(destination: Pending) {
    if (!image || busy) return;
    if (!ocrSupported()) {
      setError('当前环境不支持文字识别。可以关闭「识别文字」后只保存为图片卡片。');
      return;
    }
    const id = ++runId.current;
    setPending(destination);
    setError('');
    setStage('working');
    setProgress({ status: '准备识别', progress: 0.01 });
    try {
      const result = await recognizeText(image, update => {
        if (mounted.current && runId.current === id) setProgress(update);
      });
      if (!mounted.current || runId.current !== id) return;
      if (!result.text.trim()) {
        if (destination === 'card') {
          setStage('card-options');
          setError('没有识别到文字。可以关闭「识别文字」，只保存图片后补备注。');
        } else {
          setStage('preview');
          setError('没有识别到文字，换一张更清晰的课程表或书页照片试试。');
        }
        return;
      }
      if (destination === 'card') {
        openCard(image, result.text);
      } else {
        const slot = nextSlot();
        close();
        ui.openSchedule({
          date: todayKey(),
          startTime: slot.start,
          endTime: slot.end,
          title: firstLine(result.text).slice(0, 60),
          content: result.text,
        });
      }
    } catch (cause) {
      if (!mounted.current || runId.current !== id) return;
      setStage(destination === 'card' ? 'card-options' : 'preview');
      setError(cause instanceof Error ? cause.message : '识别失败，请重试。');
    }
  }

  function saveCard() {
    if (!image) return;
    if (!recognizeCardText) {
      openCard(image);
      return;
    }
    void recognizeThen('card');
  }

  const subtitle =
    stage === 'card-options'
      ? '选择是否把照片里的文字一起存进卡片'
      : stage === 'working'
        ? '正在本机识别，图片不会上传'
        : stage === 'preview'
          ? '照片已经准备好，接下来要做什么？'
          : '拍一张照片，识别成日程，或保存为卡片';

  return (
    <Sheet
      open={open}
      onClose={close}
      title="拍照"
      subtitle={subtitle}
      busy={busy}
      footer={stage === 'card-options' ? (
        <>
          <button type="button" className="v-btn v-btn--ghost" onClick={() => setStage('preview')} disabled={busy}>
            <ArrowLeft size={15} /> 返回
          </button>
          <span className="v-grow" />
          <button type="button" className="v-btn v-btn--primary" onClick={saveCard} disabled={busy}>
            {busy ? '处理中…' : '保存为卡片'}
          </button>
        </>
      ) : undefined}
    >
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={event => { void pickFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        hidden
        onChange={event => { void pickFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
      />

      {stage === 'pick' && (
        <div className="v-camera-stage">
          <div className="v-camera-orbit">
            <div><Camera size={36} /></div>
          </div>
          <div className="v-camera-copy">
            <strong>拍一张照片</strong>
            <p>拍课程表、板书、书页或笔记。拍完可以选择：识别成日程，或保存为卡片。</p>
          </div>
          <div className="v-camera-actions">
            <button type="button" className="v-btn v-btn--primary" onClick={() => cameraRef.current?.click()} disabled={busy}>
              <Camera size={18} /> 拍照
            </button>
            <button type="button" className="v-btn" onClick={() => galleryRef.current?.click()} disabled={busy}>
              <ImageIcon size={18} /> 相册
            </button>
          </div>
          {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--v-red)', textAlign: 'center' }}>{error}</p>}
          <p className="v-tiny" style={{ textAlign: 'center', lineHeight: 1.6, maxWidth: 360 }}>
            Android 用系统本地识别；网页版首次识别会加载中文模型，之后可离线使用。
          </p>
        </div>
      )}

      {stage === 'preview' && image && (
        <div className="v-camera-stage">
          <div className="v-camera-preview">
            <img src={image} alt="刚拍的照片" />
          </div>
          <div className="v-camera-choices">
            <button
              type="button"
              className="v-camera-choice"
              onClick={() => void recognizeThen('schedule')}
              disabled={busy}
            >
              <span className="v-camera-choice-icon"><CalendarPlus size={21} /></span>
              <span>
                <strong>识别成日程</strong>
                <small>识别文字，填进今天的时间轴</small>
              </span>
            </button>
            <button
              type="button"
              className="v-camera-choice"
              onClick={() => { setStage('card-options'); setError(''); }}
              disabled={busy}
            >
              <span className="v-camera-choice-icon"><Layers size={21} /></span>
              <span>
                <strong>保存为卡片</strong>
                <small>只留图片，或同时提取文字</small>
              </span>
            </button>
          </div>
          <div className="v-row" style={{ gap: 8 }}>
            <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => cameraRef.current?.click()}>
              <Camera size={14} /> 重拍
            </button>
            <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => galleryRef.current?.click()}>
              <ImageIcon size={14} /> 换图
            </button>
          </div>
          {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--v-red)', textAlign: 'center' }}>{error}</p>}
        </div>
      )}

      {stage === 'working' && (
        <div className="v-camera-stage">
          {image && (
            <div className="v-camera-preview" style={{ maxWidth: 340 }}>
              <img src={image} alt="正在识别的照片" style={{ maxHeight: 210, opacity: 0.7 }} />
            </div>
          )}
          <div className="v-camera-status">
            <div className="v-camera-status-row">
              <Loader2 size={16} className="v-spin" style={{ color: 'var(--v-accent)' }} />
              <span>{progress.status || '正在识别'}</span>
              <span style={{ marginLeft: 'auto' }} className="v-tnum">{Math.round((progress.progress || 0) * 100)}%</span>
            </div>
            <div className="v-progress"><span style={{ width: `${Math.max(4, (progress.progress || 0) * 100)}%` }} /></div>
          </div>
          <p className="v-tiny" style={{ textAlign: 'center', maxWidth: 330, lineHeight: 1.6 }}>
            第一次识别需要加载中文模型，请保持页面打开。完成后会直接进入{pending === 'schedule' ? '日程编辑' : '卡片编辑'}。
          </p>
        </div>
      )}

      {stage === 'card-options' && image && (
        <div className="v-camera-stage" style={{ alignItems: 'stretch' }}>
          <div className="v-camera-preview" style={{ maxWidth: 380, margin: '0 auto' }}>
            <img src={image} alt="保存为卡片的照片" style={{ maxHeight: 260 }} />
          </div>
          <div className="v-camera-option-row">
            <span className="v-camera-option-icon"><ScanText size={19} /></span>
            <span className="v-grow">
              <strong>识别文字</strong>
              <small>
                {recognizeCardText
                  ? '把照片里的文字一起写入卡片，之后可以编辑'
                  : '不识别文字，只保存这张图片，之后可以在卡片里补备注'}
              </small>
            </span>
            <button
              type="button"
              className="v-switch"
              aria-checked={recognizeCardText}
              aria-label="识别文字"
              onClick={() => setRecognizeCardText(value => !value)}
            />
          </div>
          <div className="v-camera-card-hint">
            <Check size={15} />
            <span>原图会保存在卡片里；关闭识别后，卡片只包含图片。</span>
          </div>
          {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--v-red)', textAlign: 'center' }}>{error}</p>}
          {!recognizeCardText && (
            <p className="v-tiny" style={{ textAlign: 'center', lineHeight: 1.6 }}>
              保存后打开卡片编辑器，可以在图片下面添加备注。
            </p>
          )}
        </div>
      )}

    </Sheet>
  );
}
