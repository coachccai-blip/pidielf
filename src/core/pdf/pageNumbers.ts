// Numéros de page : écrit le numéro dans la marge de chaque page, là où
// l'utilisateur le voit (pages pivotées comprises).
import type { StandardFonts } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { loadPdf, savePdf } from './load';
import { hexColor, inDisplayFrame, toWinAnsi } from './pageFrame';
import { numberAnchor, numberingPlan, type NumberEdge, type NumberingOptions } from './pageNumbersLayout';
import { stampText, standardFontName, type StampFont } from './watermarkLayout';

export interface NumberPagesParams extends NumberingOptions {
  bytes: Uint8Array;
  edge: NumberEdge;
  /** Distance au bord de la page, en points. */
  margin: number;
  font: StampFont;
  bold?: boolean;
  /** Corps en points. */
  size: number;
  /** « #rrggbb » */
  color: string;
}

export async function numberPages(params: NumberPagesParams, progress?: Progress): Promise<Uint8Array> {
  const doc = await loadPdf(params.bytes);
  const pages = doc.getPages();
  const plan = numberingPlan(pages.length, { ...params, prefix: stampText(params.prefix ?? '') });
  if (plan.every((label) => label === null)) throw new ToolError('empty');

  const font = await doc.embedFont(standardFontName(params.font, params.bold) as StandardFonts);
  const color = hexColor(params.color);
  pages.forEach((page, i) => {
    const label = plan[i];
    if (label) {
      inDisplayFrame(page, (frame) => {
        const text = toWinAnsi(label.text);
        const width = font.widthOfTextAtSize(text, params.size);
        const anchor = numberAnchor(frame, params.edge, label.side, params.margin, params.size);
        const x = label.side === 'left' ? anchor.x : label.side === 'right' ? anchor.x - width : anchor.x - width / 2;
        page.drawText(text, { x, y: anchor.y, size: params.size, font, color });
      });
    }
    progress?.((i + 1) / pages.length);
  });
  return savePdf(doc);
}
