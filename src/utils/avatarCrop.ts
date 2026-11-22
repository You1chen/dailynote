/**
 * 头像裁剪纯函数
 *
 * 坐标约定（左上角系）：
 *   (x, y) = 图片左上角在视口内的偏移；图片渲染尺寸 rw = imgW*scale。
 *   居中 = x = (viewport - imgW*scale) / 2；cover 下钳制区间为 [viewport - rw, 0]。
 *   裁剪矩形 = { sx: -x/scale, sy: -y/scale, sw: viewport/scale, sh: viewport/scale }。
 *
 * 本模块前四个函数为纯函数（vitest 单测对象）；renderAvatarToDataURL /
 * downscaleImage 依赖 canvas，仅浏览器环境可用（由端到端验证覆盖）。
 * 注意：不要在模块顶层访问 DOM，保证 node 环境可 import。
 */

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** 最小缩放使图片铺满视口（cover，无留白） */
export function fitCoverScale(viewport: number, imgW: number, imgH: number): number {
  return Math.max(viewport / imgW, viewport / imgH);
}

/**
 * 平移钳制：图片边缘不露进视口内。
 * 图片渲染尺寸小于视口的维度（理论上不会发生，cover 保证）则钳制区间坍缩为 0。
 */
export function clampPan(
  x: number, y: number, scale: number,
  viewport: number, imgW: number, imgH: number,
): { x: number; y: number } {
  const minX = Math.min(0, viewport - imgW * scale);
  const minY = Math.min(0, viewport - imgH * scale);
  return {
    x: Math.min(0, Math.max(minX, x)),
    y: Math.min(0, Math.max(minY, y)),
  };
}

/** 围绕视口点 (px, py) 缩放：该点下的图像像素保持不动 */
export function zoomAround(
  x: number, y: number, scale: number,
  px: number, py: number, newScale: number,
): { x: number; y: number } {
  const k = newScale / scale;
  return { x: px - (px - x) * k, y: py - (py - y) * k };
}

/** 视口裁剪区域 → 原图像素坐标（cover + 钳制下恒落在原图内） */
export function cropSourceRect(
  x: number, y: number, scale: number,
  viewport: number, imgW: number, imgH: number,
): CropRect {
  return { sx: -x / scale, sy: -y / scale, sw: viewport / scale, sh: viewport / scale };
}

/** 裁剪并输出方形头像 dataURL（白底 JPEG，质量 0.85） */
export function renderAvatarToDataURL(
  img: HTMLImageElement | HTMLCanvasElement,
  rect: CropRect,
  outSize = 256,
  quality = 0.85,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outSize, outSize);
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outSize, outSize);
  return canvas.toDataURL('image/jpeg', quality);
}

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

// ============ 备注图片压缩（DDL 用） ============

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
