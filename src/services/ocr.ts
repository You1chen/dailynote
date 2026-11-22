import { registerPlugin } from '@capacitor/core';
import { isCapacitor } from './store';

export interface OcrLine {
  text: string;
  top: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

interface MlkitOcrPlugin {
  recognize(options: { base64: string }): Promise<OcrResult>;
}

const MlkitOcr = registerPlugin<MlkitOcrPlugin>('MlkitOcr');

/** 当前平台是否支持图片识别（只有 Android 原生包有 ML Kit） */
export function ocrAvailable(): boolean {
  return isCapacitor();
}

/** 对 data URL 做中文文字识别；Web 端直接报错，由调用方转成提示 */
export async function recognizeImage(dataUrl: string): Promise<OcrResult> {
  if (!ocrAvailable()) throw new Error('not-native');
  const res = await MlkitOcr.recognize({ base64: dataUrl });
  return { text: res?.text ?? '', lines: res?.lines ?? [] };
}
