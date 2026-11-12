// Filigrane : un texte ou une image posés par-dessus le contenu des pages
// choisies, à une position de la grille ou répétés en mosaïque.
import { clip, degrees, drawImage, drawText, endPath, rectangle, type PDFFont, type PDFImage, type StandardFonts } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { loadPdf, savePdf } from './load';
import { hexColor, inDisplayFrame, toWinAnsi } from './pageFrame';
import { stampText, standardFontName, TEXT_BASELINE, watermarkCentres, type StampFont, type WatermarkLayout } from './watermarkLayout';

export type WatermarkContent =
  | { kind: 'text'; text: string; font: StampFont; bold: boolean; /** Corps en points. */ size: number; /** « #rrggbb » */ color: string }
  | { kind: 'image'; data: Uint8Array; mime: 'image/png' | 'image/jpeg'; /** Largeur, en fraction de la largeur de la page (0 à 1). */ width: number };

export interface WatermarkParams extends WatermarkLayout {
  bytes: Uint8Array;
  content: WatermarkContent;
  /** De 0 (invisible) à 1 (opaque). */
  opacity: number;
  /** Pages concernées (à partir de 1). Toutes si absent. */
  pages?: number[];
}

export async function watermarkPdf(params: WatermarkParams, progress?: Progress): Promise<Uint8Array> {
  const doc = await loadPdf(params.bytes);
  const all = doc.getPages();
  const targets = [...new Set(params.pages ?? all.map((_, i) => i + 1))].filter((p) => all[p - 1]);
  if (targets.length === 0) throw new ToolError('empty');

  const { content } = params;
  let font: PDFFont | undefined;
  let image: PDFImage | undefined;
  const text = content.kind === 'text' ? toWinAnsi(stampText(content.text)) : '';
  if (content.kind === 'text') {
    if (!text) throw new ToolError('empty');
    font = await doc.embedFont(standardFontName(content.font, content.bold) as StandardFonts);
  } else {
    try {
      image = content.mime === 'image/png' ? await doc.embedPng(content.data) : await doc.embedJpg(content.data);
    } catch (err) {
      throw new ToolError('damaged', (err as Error).message);
    }
  }

  // Un seul état graphique pour tout le document : chaque page y fait référence.
  const opacity = Math.min(1, Math.max(0.01, params.opacity));
  const graphicsState = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }));
  const rotate = degrees(params.rotation);
  const angle = (params.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  targets.forEach((number, done) => {
    const page = all[number - 1];
    inDisplayFrame(page, (frame) => {
      const box =
        content.kind === 'text'
          ? { width: font!.widthOfTextAtSize(text, content.size), height: content.size }
          : { width: content.width * frame.width, height: (content.width * frame.width * image!.height) / image!.width };
      // Décalage du centre de la copie vers son origine de dessin (ligne de base ou coin bas gauche).
      const dx = -box.width / 2;
      const dy = content.kind === 'text' ? -TEXT_BASELINE * content.size : -box.height / 2;
      const gs = page.node.newExtGState('GS', graphicsState);
      const key = font ? page.node.newFontDictionary(font.name, font.ref) : page.node.newXObject('Image', image!.ref);
      // Rien ne dépasse de la page affichée, même si la boîte de rognage est plus petite que le support.
      page.pushOperators(rectangle(0, 0, frame.width, frame.height), clip(), endPath());
      for (const centre of watermarkCentres(frame, box, params)) {
        // pdf-lib tourne autour de l'origine de dessin : on la place pour que la copie tourne autour de son centre.
        const x = centre.x + dx * cos - dy * sin;
        const y = centre.y + dx * sin + dy * cos;
        const skew = degrees(0);
        page.pushOperators(
          ...(content.kind === 'text'
            ? drawText(font!.encodeText(text), { x, y, size: content.size, font: key, color: hexColor(content.color), rotate, xSkew: skew, ySkew: skew, graphicsState: gs })
            : drawImage(key, { x, y, width: box.width, height: box.height, rotate, xSkew: skew, ySkew: skew, graphicsState: gs })),
        );
      }
    });
    progress?.((done + 1) / targets.length);
  });
  return savePdf(doc);
}
