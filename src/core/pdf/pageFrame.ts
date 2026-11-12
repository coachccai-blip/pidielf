// Dessiner sur une page « telle qu'elle est affichée ».
//
// Une page PDF peut porter une rotation (/Rotate) et une boîte de rognage
// décalée. Pour qu'un filigrane, un numéro ou une signature tombe là où
// l'utilisateur l'a placé à l'écran, on dessine dans un repère d'affichage :
// origine en bas à gauche de la page affichée, x vers la droite, y vers le
// haut, unités en points PDF.
import { concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb, type PDFPage, type RGB } from '@cantoo/pdf-lib';
import { normAngle } from './load';

export interface DisplayFrame {
  /** Largeur de la page affichée, en points. */
  width: number;
  /** Hauteur de la page affichée, en points. */
  height: number;
  /** Rotation de la page : 0, 90, 180 ou 270. */
  rotation: number;
}

export function displayFrame(page: PDFPage): DisplayFrame {
  const box = page.getCropBox();
  const rotation = normAngle(page.getRotation().angle);
  const quarter = rotation === 90 || rotation === 270;
  return { width: quarter ? box.height : box.width, height: quarter ? box.width : box.height, rotation };
}

/** Matrice [a b c d e f] qui envoie le repère d'affichage vers l'espace utilisateur de la page. */
export function displayMatrix(page: PDFPage): [number, number, number, number, number, number] {
  const { x, y, width, height } = page.getCropBox();
  switch (normAngle(page.getRotation().angle)) {
    case 90:
      return [0, 1, -1, 0, x + width, y];
    case 180:
      return [-1, 0, 0, -1, x + width, y + height];
    case 270:
      return [0, -1, 1, 0, x, y + height];
    default:
      return [1, 0, 0, 1, x, y];
  }
}

/**
 * Exécute `draw` dans le repère d'affichage. À l'intérieur, on utilise les
 * méthodes habituelles de pdf-lib (drawText, drawImage, drawRectangle…) avec
 * des coordonnées d'affichage ; `frame` donne la taille de la page affichée.
 */
export function inDisplayFrame(page: PDFPage, draw: (frame: DisplayFrame) => void): void {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...displayMatrix(page)));
  try {
    draw(displayFrame(page));
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

/** Convertit un point normalisé (0 à 1, origine en haut à gauche) en coordonnées d'affichage. */
export function fromNormalized(frame: DisplayFrame, nx: number, ny: number): { x: number; y: number } {
  return { x: nx * frame.width, y: (1 - ny) * frame.height };
}

/** « #rrggbb » → couleur pdf-lib. */
export function hexColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

// Les polices standard de pdf-lib n'encodent que le jeu WinAnsi (latin occidental).
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** Remplace les caractères que les polices standard ne savent pas écrire. */
export function toWinAnsi(text: string, replacement = '?'): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (ch === '\n' || ch === '\t') out += ch === '\t' ? '    ' : '\n';
    else if (code === 0x202f || code === 0x2009 || code === 0x00a0) out += ' ';
    else out += replacement;
  }
  return out;
}
