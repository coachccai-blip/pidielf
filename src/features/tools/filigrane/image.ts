// Image choisie comme filigrane : prête à être incorporée (PNG ou JPEG) et
// affichable dans l'aperçu.
import { canvasToBlob } from '@/lib/pdfjs';

export interface WatermarkImage {
  name: string;
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** Adresse locale pour l'aperçu ; à libérer avec URL.revokeObjectURL. */
  url: string;
}

/** Au-delà, l'image est réduite : un filigrane n'a pas besoin de plus, et chaque PDF du lot l'embarque. */
const MAX_SIDE = 2000;

export async function loadWatermarkImage(file: File): Promise<WatermarkImage> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const source = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = source;
    await img.decode();
    const longSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (longSide === 0) throw new Error('image vide');
    if (isPng && longSide <= MAX_SIDE) {
      return { name: file.name, data: new Uint8Array(await file.arrayBuffer()), mime: 'image/png', width: img.naturalWidth, height: img.naturalHeight, url: URL.createObjectURL(file) };
    }
    // Tout le reste passe par un canvas : l'orientation d'une photo y est appliquée (un PDF l'ignorerait),
    // et les formats que le PDF ne connaît pas (WebP, GIF, SVG…) deviennent du PNG, transparence comprise.
    const scale = Math.min(1, MAX_SIDE / longSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const mime = isJpeg ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, mime, 0.92);
    const result = { name: file.name, data: new Uint8Array(await blob.arrayBuffer()), mime, width: canvas.width, height: canvas.height, url: URL.createObjectURL(blob) } as const;
    canvas.width = 0;
    return result;
  } finally {
    URL.revokeObjectURL(source);
  }
}
