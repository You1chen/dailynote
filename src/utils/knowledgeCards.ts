import { Capacitor } from '@capacitor/core';
import type { KnowledgeCard, KnowledgeCardContent, KnowledgeCardLibrary } from '../types/knowledge';
export const DEFAULT_AUDIO_EXPORT_PATH = 'Music/DailyNote';
export const cardHasContent = (card: KnowledgeCard) => !!card.title.trim() || card.contents.some(item => item.kind === 'text' ? !!item.text.trim() : !!item.data);
export function cardSearchText(card: KnowledgeCard): string {
  return [card.title, ...card.contents.map(item => item.kind === 'text' ? item.text : item.kind === 'audio' ? item.fileName : '')].filter(Boolean).join(' ');
}
export function upsertCardRecord(library: KnowledgeCardLibrary, card: KnowledgeCard): KnowledgeCardLibrary {
  const timestamp = Date.now();
  return { ...library, records: library.records.some(record => record.id === card.id)
    ? library.records.map(record => record.id === card.id ? { ...record, card, updatedAt: timestamp } : record)
    : [...library.records, { id: card.id, card, createdAt: card.createdAt, updatedAt: timestamp }], updatedAt: timestamp };
}
export function normalizeAudioPath(value: string): string {
  const clean = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || DEFAULT_AUDIO_EXPORT_PATH;
  if (clean.split('/').some(part => part === '..' || part === '.') || /[:<>"|?*]/.test(clean)) throw new Error('请选择公共存储下的相对目录，例如 Music/DailyNote');
  return clean;
}
export function audioFileName(baseName: string, mimeType: string): string {
  const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  return `${baseName.replace(/\.(webm|m4a|mp4|ogg)$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 90) || 'recording'}.${extension}`;
}
export function audioBytesFromDataUrl(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.split(',')[1] ?? '');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function dataUrlToBlob(dataUrl: string): Blob {
  return new Blob([audioBytesFromDataUrl(dataUrl).buffer as ArrayBuffer], { type: /data:([^;]+)/.exec(dataUrl)?.[1] ?? 'audio/webm' });
}
export async function exportAudioBlob(dataUrl: string, folder: string, filename: string, mimeType: string): Promise<{ native: boolean; path?: string }> {
  const safeName = audioFileName(filename, mimeType);
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const path = `${normalizeAudioPath(folder)}/${safeName}`;
    // Filesystem decodes Base64 into binary when encoding is omitted.
    await Filesystem.writeFile({ path, data: dataUrl.split(',')[1] ?? '', directory: Directory.ExternalStorage, recursive: true });
    return { native: true, path };
  }
  const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeName; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { native: false };
}
export function describeContent(content: KnowledgeCardContent): { kind: KnowledgeCardContent['kind']; label: string } {
  if (content.kind === 'text') return { kind: content.kind, label: content.text.slice(0, 80) || '文字内容' };
  if (content.kind === 'image') return { kind: content.kind, label: '图片' };
  return { kind: content.kind, label: `录音 · ${Math.max(1, Math.round(content.durationMs / 1000))}秒` };
}
