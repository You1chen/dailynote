/**
 * 备注图片压缩（DDL、卡片与地图共用）。
 * 巨图（>4096px）先降采样，再等比压成 JPEG dataURL，避免 WebView 解码内存溢出。
 * 注意：不要在模块顶层访问 DOM，保证 node 环境可 import。
 */

/** 巨图（>4096px）一次性降采样，防 WebView 解码/渲染内存溢出 */
export function downscaleImage(img: HTMLImageElement, maxDim = 4096): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    if (k === 1) {
      resolve(img);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const small = new Image();
    small.onload = () => resolve(small);
    small.onerror = () => reject(new Error('图片降采样失败'));
    small.src = canvas.toDataURL('image/jpeg', 0.92);
  });
}

/**
 * 等比缩放（fit，保持原始长宽比，非方形）压缩为 JPEG dataURL。
 * 9 张 × 约 100-300KB ≈ 单条 DDL 最多约 3MB 写入 ddls.json（可接受）。
 */
export function compressImageToDataURL(
  img: HTMLImageElement | HTMLCanvasElement,
  maxDim = 1280,
  quality = 0.8,
): string {
  const w = img instanceof HTMLCanvasElement ? img.width : img.naturalWidth;
  const h = img instanceof HTMLCanvasElement ? img.height : img.naturalHeight;
  const k = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** File → 压缩 dataURL：FileReader → Image →（巨图先 downscaleImage）→ compressImageToDataURL */
export function fileToCompressedDataURL(
  file: File,
  maxDim = 1280,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        try {
          const safe = img.naturalWidth > 4096 || img.naturalHeight > 4096
            ? await downscaleImage(img)
            : img;
          resolve(compressImageToDataURL(safe, maxDim, quality));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
