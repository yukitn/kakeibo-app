// 画像のブラウザ側圧縮: 長辺 800px・JPEG(品質0.7)。EXIFの向きを反映し、位置情報等のメタデータは再エンコードで除去される。
export const MAX_EDGE = 800;
export const QUALITY = 0.7;

async function toBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* フォールバック */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

/** @return {Promise<string>} data:image/jpeg;base64,... */
export async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください');
  const bmp = await toBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), hh = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hh;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';            // 透過PNG等は白背景
  ctx.fillRect(0, 0, w, hh);
  ctx.drawImage(bmp, 0, 0, w, hh);
  if (bmp.close) bmp.close();
  return canvas.toDataURL('image/jpeg', QUALITY);
}

export const stripDataUrl = (dataUrl) => dataUrl.replace(/^data:image\/jpeg;base64,/, '');
