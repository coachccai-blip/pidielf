// Images en PDF : une image par page, placée entière (jamais rognée) et centrée.
import { PDFDocument, type PDFImage } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { savePdf } from './load';
import { layoutImage, type PageSetup, type PdfImage } from './imagesLayout';

export * from './imagesLayout';

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
