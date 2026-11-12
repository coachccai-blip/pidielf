// Fabrication de l'image d'une signature : PNG à fond transparent, rogné au
// plus près de l'encre, à partir d'un dessin, d'un texte ou d'une image importée.
import { alphaBounds, whiteToAlpha } from '@/core/signature/image';
import { defaultStroke, samplesBounds, strokeSamples, type InkPoint, type Sample } from '@/core/signature/stroke';
import { canvasToBlob } from '@/lib/pdfjs';

export interface SignatureImage {
  blob: Blob;
  /** Dimensions en pixels. */
  width: number;
  height: number;
}

/** Les trois encres proposées. */
export const INKS = [
  { value: '#111111', key: 'black' },
  { value: '#1d4ed8', key: 'blue' },
  { value: '#0f1e4d', key: 'navy' },
];

const MAX_SIDE = 1800;

/** Trace un trait d'épaisseur variable : de courts segments à bouts ronds, chacun à sa largeur. */
export function drawSamples(ctx: CanvasRenderingContext2D, samples: Sample[], color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (samples.length === 1) {
    ctx.beginPath();
    ctx.arc(samples[0].x, samples[0].y, samples[0].w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < samples.length; i++) {
    ctx.lineWidth = (samples[i - 1].w + samples[i].w) / 2;
    ctx.beginPath();
    ctx.moveTo(samples[i - 1].x, samples[i - 1].y);
    ctx.lineTo(samples[i].x, samples[i].y);
    ctx.stroke();
  }
}

async function exportCanvas(canvas: HTMLCanvasElement): Promise<SignatureImage> {
  const image = { blob: await canvasToBlob(canvas, 'image/png'), width: canvas.width, height: canvas.height };
  canvas.width = 0;
  return image;
}

/** Dessin → PNG transparent, agrandi pour rester net une fois posé sur la page. */
export async function strokesToPng(strokes: InkPoint[][], color: string): Promise<SignatureImage | null> {
  const samples = strokes.map((stroke) => strokeSamples(stroke, defaultStroke, 1));
  const bounds = samplesBounds(samples);
  if (!bounds) return null;
  const margin = 2;
  const scale = Math.min(4, MAX_SIDE / Math.max(bounds.width, bounds.height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((bounds.width + 2 * margin) * scale);
  canvas.height = Math.ceil((bounds.height + 2 * margin) * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(margin - bounds.x, margin - bounds.y);
  samples.forEach((stroke) => drawSamples(ctx, stroke, color));
  return exportCanvas(canvas);
}

/** Police manuscrite des signatures tapées au clavier. */
export const SCRIPT_FONT = 'Caveat, "Segoe Script", "Brush Script MT", cursive';

/** Texte en écriture manuscrite → PNG transparent. Attend que la police soit chargée. */
export async function textToPng(text: string, color: string, bold: boolean): Promise<SignatureImage | null> {
  const content = text.trim();
  if (!content) return null;
  const weight = bold ? 700 : 400;
  try {
    await document.fonts.load(`${weight} 96px Caveat`, content);
  } catch {
    /* police indisponible : le navigateur prendra son écriture cursive */
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  let size = 180;
  const measure = () => {
    ctx.font = `${weight} ${size}px ${SCRIPT_FONT}`;
    return ctx.measureText(content);
  };
  let metrics = measure();
  const inkWidth = () => metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  if (inkWidth() > MAX_SIDE) {
    size = Math.floor((size * MAX_SIDE) / inkWidth());
    metrics = measure();
  }
  const margin = Math.ceil(size / 20);
  canvas.width = Math.ceil(inkWidth()) + 2 * margin;
  canvas.height = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 2 * margin;
  // Changer la taille du canvas remet son contexte à zéro.
  ctx.font = `${weight} ${size}px ${SCRIPT_FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(content, margin + metrics.actualBoundingBoxLeft, margin + metrics.actualBoundingBoxAscent);
  return exportCanvas(canvas);
}

/** Décode une image choisie et la ramène à une taille raisonnable. */
export async function decodeImage(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/**
 * Image importée → PNG. Avec `transparent`, le fond clair disparaît (photo
 * d'une signature sur papier) et l'image est rognée autour de l'encre.
 * Renvoie `null` s'il ne reste rien de visible.
 */
export async function importedToPng(source: HTMLCanvasElement, transparent: boolean): Promise<SignatureImage | null> {
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, source.width, source.height);
  if (transparent) whiteToAlpha(pixels.data);
  const bounds = alphaBounds(pixels.data, source.width, source.height);
  if (!bounds) return null;
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  canvas.getContext('2d')!.putImageData(pixels, -bounds.x, -bounds.y);
  return exportCanvas(canvas);
}
