// Images posées sur une page : lecture d'un fichier choisi, et adresse
// d'affichage pour l'aperçu.
import { ToolError } from '@/core/errors';
import { readJpegInfo } from '@/core/image/jpeg';
import { canvasToBlob } from '@/lib/pdfjs';

export interface PickedImage {
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

const MAX_SIDE = 4096;

const isPng = (bytes: Uint8Array): boolean => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

/**
 * Prépare une image pour le PDF. Un PNG ou un JPEG ordinaire est repris tel
 * quel, sans perte. Les autres formats passent par un canvas et deviennent des
 * PNG ; un JPEG pivoté par son appareil photo (EXIF) est redressé, sinon il
 * apparaîtrait couché dans le PDF.
 */
export async function readImageFile(file: Blob): Promise<PickedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new ToolError('unsupported', 'Image illisible');
  try {
    const jpeg = readJpegInfo(bytes);
    if (isPng(bytes)) return { data: bytes, mime: 'image/png', width: bitmap.width, height: bitmap.height };
    if (jpeg && jpeg.orientation === 1 && jpeg.components !== 4) return { data: bytes, mime: 'image/jpeg', width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const mime = jpeg ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, mime, 0.92);
    const picked: PickedImage = { data: new Uint8Array(await blob.arrayBuffer()), mime, width: canvas.width, height: canvas.height };
    canvas.width = 0;
    return picked;
  } finally {
    bitmap.close();
  }
}

const urls = new WeakMap<Uint8Array, string>();
// L'adresse est libérée quand les octets de l'image ne servent plus à personne.
const registry = typeof FinalizationRegistry === 'undefined' ? null : new FinalizationRegistry<string>((url) => URL.revokeObjectURL(url));

/** Adresse d'affichage d'une image incorporée, créée une seule fois par image. */
export function imageUrl(data: Uint8Array, mime: string): string {
  let url = urls.get(data);
  if (!url) {
    url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    urls.set(data, url);
    registry?.register(data, url);
  }
  return url;
}
