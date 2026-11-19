import { Capacitor } from '@capacitor/core';
import type { KnowledgeCard, KnowledgeCardContent, KnowledgeCardLibrary } from '../types/knowledge';
export const DEFAULT_AUDIO_EXPORT_PATH = 'Music/DailyNote';
export const cardHasContent = (card: KnowledgeCard) => !!card.title.trim() || card.contents.some(item => item.kind === 'text' ? !!item.text.trim() : !!item.data);
export function cardSearchText(card: KnowledgeCard): string {
  return [
    card.title,
    ...card.contents.flatMap(item => [
      item.kind === 'text' ? item.text : item.kind === 'audio' ? item.fileName : '',
      ...(item.comments ?? []).map(comment => comment.text),
    ]),
  ].filter(Boolean).join(' ');
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
export function cardDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dateGroupLabel(dateKey: string): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const todayKey = cardDateKey(today.getTime());
  const yesterdayKey = cardDateKey(yesterday.getTime());
  if (dateKey === todayKey) return '今天';
  if (dateKey === yesterdayKey) return '昨天';
  const [year, month, day] = dateKey.split('-').map(Number);
  return year === today.getFullYear() ? `${month} 月 ${day} 日` : `${year} 年 ${month} 月 ${day} 日`;
}

export function groupCardsByDate(cards: KnowledgeCard[], ascending = false): { date: string; cards: KnowledgeCard[] }[] {
  const ordered = [...cards].sort((a, b) => ascending ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
  const groups = new Map<string, KnowledgeCard[]>();
  for (const card of ordered) {
    const key = cardDateKey(card.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return [...groups.entries()].map(([date, items]) => ({ date, cards: items }));
}

export function cardDataJSON(card: KnowledgeCard): string {
  return JSON.stringify({
    format: 'dailynote-card',
    version: 1,
    exportedAt: new Date().toISOString(),
    card,
  }, null, 2);
}

/** Export a complete card as a portable JSON file. Image content stays inside `contents[].data`. */
export async function exportCardData(card: KnowledgeCard, folder = 'DailyNote/cards'): Promise<{ native: boolean; path?: string }> {
  const safeName = `${(card.title.trim() || '未命名卡片').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}-${cardDateKey(card.createdAt)}.json`;
  const json = cardDataJSON(card);
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const cleanFolder = folder.replace(/^Documents[\\/]/, '').replace(/\/+$/, '');
    await Filesystem.writeFile({ path: `${cleanFolder}/${safeName}`, data: json, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    return { native: true, path: `${folder}/${safeName}` };
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { native: false };
}

export async function exportImageBlob(dataUrl: string, folder = 'Pictures/DailyNote', filename = 'card-image'): Promise<{ native: boolean; path?: string }> {
  const mime = /data:([^;]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
  const extension = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const safeName = `${filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 90) || 'card-image'}.${extension}`;
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: `${folder.replace(/\/+$/g, '')}/${safeName}`,
      data: dataUrl.split(',')[1] ?? '',
      directory: Directory.ExternalStorage,
      recursive: true,
    });
    return { native: true, path: `${folder}/${safeName}` };
  }
  const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { native: false };
}

export async function copyImageBlob(dataUrl: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前环境不支持复制图片');
  await navigator.clipboard.write([new ClipboardItem({ [dataUrlToBlob(dataUrl).type]: dataUrlToBlob(dataUrl) })]);
}

export function describeContent(content: KnowledgeCardContent): { kind: KnowledgeCardContent['kind']; label: string } {
  if (content.kind === 'text') return { kind: content.kind, label: content.text.slice(0, 80) || '文字内容' };
  if (content.kind === 'image') return { kind: content.kind, label: '图片' };
  return { kind: content.kind, label: `录音 · ${Math.max(1, Math.round(content.durationMs / 1000))}秒` };
}
