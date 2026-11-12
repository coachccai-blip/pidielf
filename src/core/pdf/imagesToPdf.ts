// Images en PDF : une image par page, placée entière (jamais rognée) et centrée.
import { PDFDocument, type PDFImage } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { savePdf } from './load';

export type PageFormat = 'a4' | 'letter' | 'fit';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';
export type PageMargin = 'none' | 'small' | 'large';

export interface PageSetup {
  format: PageFormat;
  /** Sans effet pour le format « ajusté à l'image ». */
  orientation: PageOrientation;
  margin: PageMargin;
}

export interface PdfImage {
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  /** Dimensions en pixels, telles que l'image s'affiche. */
  width: number;
  height: number;
}

/** Emplacement d'une image sur sa page, en points (origine en bas à gauche). */
export interface ImageLayout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Formats de papier en points, en portrait. */
const PAPER: Record<Exclude<PageFormat, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Marges en points : aucune, 1 cm, 2 cm. */
export const MARGINS: Record<PageMargin, number> = { none: 0, small: 28.35, large: 56.69 };

/** Un pixel d'écran vaut 0,75 point (96 pixels par pouce). */
const PX_TO_PT = 0.75;
/** Une page « ajustée » ne dépasse pas la hauteur d'un A4, pour rester imprimable. */
const FIT_MAX_SIDE = PAPER.a4[1];

/** Calcule la page et l'emplacement d'une image de `width` × `height` pixels. */
export function layoutImage(width: number, height: number, page: PageSetup): ImageLayout {
  const margin = MARGINS[page.margin];
  if (page.format === 'fit') {
    const scale = Math.min(PX_TO_PT, FIT_MAX_SIDE / Math.max(width, height));
    const w = width * scale;
    const h = height * scale;
    return { pageWidth: w + 2 * margin, pageHeight: h + 2 * margin, x: margin, y: margin, width: w, height: h };
  }
  const [short, long] = PAPER[page.format];
  const landscape = page.orientation === 'landscape' || (page.orientation === 'auto' && width > height);
  const pageWidth = landscape ? long : short;
  const pageHeight = landscape ? short : long;
  const scale = Math.min((pageWidth - 2 * margin) / width, (pageHeight - 2 * margin) / height);
  const w = width * scale;
  const h = height * scale;
  return { pageWidth, pageHeight, x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h };
}

async function embed(doc: PDFDocument, image: PdfImage): Promise<PDFImage> {
  try {
    // Un JPEG est repris tel quel (aucune recompression) ; un PNG est recodé sans perte.
    return image.mime === 'image/jpeg' ? await doc.embedJpg(image.data) : await doc.embedPng(image.data);
  } catch (err) {
    throw new ToolError('damaged', (err as Error).message);
  }
}

export async function imagesToPdf(params: { images: PdfImage[]; page: PageSetup }, progress?: Progress): Promise<Uint8Array> {
  const { images, page } = params;
  if (images.length === 0) throw new ToolError('empty');
  const doc = await PDFDocument.create();
  for (const [i, image] of images.entries()) {
    const layout = layoutImage(image.width, image.height, page);
    const embedded = await embed(doc, image);
    doc.addPage([layout.pageWidth, layout.pageHeight]).drawImage(embedded, { x: layout.x, y: layout.y, width: layout.width, height: layout.height });
    progress?.((i + 1) / images.length);
  }
  return savePdf(doc);
}
