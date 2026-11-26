import { Capacitor } from '@capacitor/core';
import { ocrAvailable, recognizeImage } from '../../services/ocr';

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrResult {
  text: string;
  engine: 'mlkit' | 'tesseract';
}

const isNative = () => Capacitor.isNativePlatform();

// ---------------------------------------------------------------------------
// Web OCR: Tesseract.js with locally bundled worker / core / Chinese data.
// First use unzips the ~2.5 MB model inside the worker; later uses are cached
// by tesseract.js and the PWA precache, so recognition works offline.
// ---------------------------------------------------------------------------

type WebWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

let webWorker: Promise<WebWorker> | null = null;
let progressSink: ((update: OcrProgress) => void) | null = null;

const STATUS_TEXT: Record<string, string> = {
  'loading tesseract core': '正在加载识别引擎',
  'initializing tesseract': '正在初始化识别引擎',
  'loading language traineddata': '正在加载中文模型',
  'initializing api': '正在准备中文识别',
  'recognizing text': '正在识别文字',
};

function describe(status: string): string {
  return STATUS_TEXT[status] ?? '正在识别';
}

async function getWebWorker(): Promise<WebWorker> {
  if (!webWorker) {
    webWorker = (async () => {
      const Tesseract = await import('tesseract.js');
      const base = import.meta.env.BASE_URL || '/';
      return Tesseract.createWorker('chi_sim', Tesseract.OEM.LSTM_ONLY, {
        workerPath: `${base}tesseract/worker.min.js`,
        corePath: `${base}tesseract`,
        langPath: `${base}tessdata`,
        gzip: false,
        cacheMethod: 'write',
        logger: message => {
          progressSink?.({
            status: describe(message.status),
            progress: typeof message.progress === 'number' ? message.progress : 0,
          });
        },
      });
    })().catch(error => {
      webWorker = null;
      throw error;
    });
  }
  return webWorker;
}

/** Drop spaces the OCR engine may insert between CJK glyphs, keep line breaks. */
export function tidyOcrText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line
      .replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function friendlyWebError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|Failed to load|404|load/i.test(message)) {
    return new Error('识别资源未能加载。请检查网络后重试，或使用 Android App 的本地识别。');
  }
  return new Error(`图片识别失败：${message || '未知错误'}`);
}

export function ocrSupported(): boolean {
  return isNative() ? ocrAvailable() : typeof Worker !== 'undefined';
}

/**
 * Recognize Chinese (plus Latin/digits) text in an image data URL.
 * Native builds use the bundled ML Kit model; the browser uses Tesseract.js.
 */
export async function recognizeText(
  dataUrl: string,
  onProgress?: (update: OcrProgress) => void,
): Promise<OcrResult> {
  if (isNative()) {
    if (!ocrAvailable()) throw new Error('当前设备不支持图片识别。');
    onProgress?.({ status: '正在使用本地模型识别', progress: 0.4 });
    const result = await recognizeImage(dataUrl);
    return { text: tidyOcrText(result.text), engine: 'mlkit' };
  }

  onProgress?.({ status: '正在加载识别引擎', progress: 0.02 });
  progressSink = onProgress ?? null;
  try {
    const worker = await getWebWorker();
    const result = await worker.recognize(dataUrl);
    return { text: tidyOcrText(result.data.text ?? ''), engine: 'tesseract' };
  } catch (error) {
    console.error('Web OCR failed:', error);
    throw friendlyWebError(error);
  } finally {
    progressSink = null;
  }
}

export function disposeOcr(): void {
  if (webWorker) {
    void webWorker.then(worker => worker.terminate()).catch(() => undefined);
    webWorker = null;
  }
}
