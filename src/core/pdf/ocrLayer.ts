// OCR : pose le texte reconnu en couche invisible par-dessus les pages. Le
// contenu d'origine n'est ni redessiné ni recompressé : on ajoute seulement du
// texte que l'on peut chercher, sélectionner et copier.
import {
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFOperator,
} from '@cantoo/pdf-lib';
import { loadPdf, savePdf } from './load';
import { inDisplayFrame, toWinAnsi } from './pageFrame';

export interface OcrWord {
  text: string;
  /** Boîte du mot dans l'image de la page : pixels, origine en haut à gauche. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Ordonnée de la ligne de base (pixels), quand le moteur de reconnaissance la donne. */
  baseline?: number;
}

export interface OcrPage {
  /** Numéro de page, à partir de 1. */
  page: number;
  /** Taille de l'image qui a servi à la reconnaissance (la page telle qu'elle s'affiche). */
  width: number;
  height: number;
  words: OcrWord[];
}

// Métriques d'Helvetica, en fraction du corps.
const ASCENT = 0.718;
const X_HEIGHT = 0.523;
const DESCENT = 0.207;
const LOW_ONLY = /^[acegmnopqrsuvwxyz.,:;_-]+$/;
const DESCENDING = /[gjpqyQç,;_()[\]{}|]/;

const round = (v: number): number => Math.round(v * 100) / 100;

/**
 * Ajoute une couche de texte invisible (mode de rendu 3). Chaque mot est écrit
 * en Helvetica, à la taille déduite de sa boîte, puis étiré ou resserré pour
 * occuper exactement sa largeur : la sélection épouse ainsi l'image.
 */
export async function addTextLayer(
  params: { bytes: Uint8Array; pages: OcrPage[] },
  progress?: (ratio: number, label?: string) => void,
): Promise<Uint8Array> {
  const doc = await loadPdf(params.bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  params.pages.forEach((entry, index) => {
    const page = pages[entry.page - 1];
    if (!page || entry.words.length === 0 || entry.width <= 0 || entry.height <= 0) return;
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    // Le repère d'affichage tient compte de la rotation et du rognage de la page.
    inDisplayFrame(page, (frame) => {
      const sx = frame.width / entry.width;
      const sy = frame.height / entry.height;
      const ops: PDFOperator[] = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
      for (const word of entry.words) {
        // Les polices standard n'écrivent que le latin occidental : ligatures défaites, le reste est omis.
        const text = toWinAnsi(word.text.normalize('NFKC'), '').trim();
        const width = (word.x1 - word.x0) * sx;
        const height = (word.y1 - word.y0) * sy;
        if (!text || width <= 0 || height <= 0) continue;
        // La boîte d'un mot va du haut de ses lettres les plus hautes au bas de ses jambages.
        const below = DESCENDING.test(text) ? DESCENT : 0;
        const size = Math.max(1, height / ((LOW_ONLY.test(text) ? X_HEIGHT : ASCENT) + below));
        const baseline = word.baseline !== undefined ? word.baseline * sy : word.y1 * sy - below * size;
        const natural = font.widthOfTextAtSize(text, size);
        ops.push(
          setFontAndSize(fontKey, round(size)),
          setCharacterSqueeze(round(Math.min(1000, Math.max(5, (width / natural) * 100)))),
          setTextMatrix(1, 0, 0, 1, round(word.x0 * sx), round(frame.height - baseline)),
          // L'espace final sépare les mots quand on copie le texte.
          showText(font.encodeText(`${text} `)),
        );
      }
      ops.push(endText());
      page.pushOperators(...ops);
    });
    progress?.((index + 1) / params.pages.length);
  });

  return savePdf(doc);
}
