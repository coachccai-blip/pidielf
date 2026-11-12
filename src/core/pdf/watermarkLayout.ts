// Géométrie du filigrane et polices standard, partagées par le traitement
// (worker) et l'aperçu : les deux placent les copies exactement au même
// endroit. Ce module ne dépend pas de pdf-lib, l'interface peut l'importer.

export type StampFont = 'sans' | 'serif' | 'mono';

const STANDARD_FONTS: Record<StampFont, [regular: string, bold: string]> = {
  sans: ['Helvetica', 'Helvetica-Bold'],
  serif: ['Times-Roman', 'Times-Bold'],
  mono: ['Courier', 'Courier-Bold'],
};

/** Nom de la police standard PDF (les valeurs de `StandardFonts` dans pdf-lib). */
export const standardFontName = (font: StampFont, bold = false): string => (STANDARD_FONTS[font] ?? STANDARD_FONTS.sans)[bold ? 1 : 0];

/** Polices d'écran de mêmes largeurs que les polices standard, pour l'aperçu. */
export const FONT_CSS: Record<StampFont, string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: 'Times, "Times New Roman", "Liberation Serif", serif',
  mono: 'Courier, "Courier New", "Liberation Mono", monospace',
};

// Même jeu de caractères que `toWinAnsi` (pageFrame.ts), mais sans dépendre de
// pdf-lib : l'aperçu montre ainsi exactement ce qui sera écrit dans le PDF.
const NOT_WIN_ANSI = /[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/gu;

/** Texte tel qu'il sera écrit : une seule ligne, caractères inconnus des polices standard remplacés par « ? ». */
export const stampText = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ').trim().replace(NOT_WIN_ANSI, '?');

/** Position sur une grille 3 × 3 : (t)op, (m)iddle, (b)ottom × (l)eft, (c)enter, (r)ight. */
export type WatermarkAnchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

export interface WatermarkLayout {
  position: WatermarkAnchor;
  /** Angle en degrés, sens inverse des aiguilles d'une montre. */
  rotation: number;
  /** Répétition en mosaïque sur toute la page. */
  tile: boolean;
  /** Espace entre deux copies de la mosaïque, en points. */
  gap: number;
}

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

/** Un texte est centré sur sa hauteur d'œil : la ligne de base passe 0,35 corps sous le centre. */
export const TEXT_BASELINE = 0.35;
/** Marge entre le filigrane et le bord de la page, en fraction du petit côté. */
const EDGE_MARGIN = 0.04;
/** Au-delà, la mosaïque est desserrée : des milliers de copies alourdiraient le fichier sans rien apporter. */
const MAX_TILES = 600;

/**
 * Centres des copies du filigrane dans le repère d'affichage (origine en bas à
 * gauche, y vers le haut). `box` est la taille d'une copie avant rotation.
 */
export function watermarkCentres(page: Size, box: Size, layout: WatermarkLayout): Point[] {
  const angle = (layout.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Encombrement de la copie une fois tournée.
  const bw = Math.abs(box.width * cos) + Math.abs(box.height * sin);
  const bh = Math.abs(box.width * sin) + Math.abs(box.height * cos);

  if (!layout.tile) {
    const margin = EDGE_MARGIN * Math.min(page.width, page.height);
    const near = (size: number, extent: number) => Math.min(margin + extent / 2, size / 2);
    const [row, col] = layout.position;
    const x = col === 'l' ? near(page.width, bw) : col === 'r' ? page.width - near(page.width, bw) : page.width / 2;
    const y = row === 'b' ? near(page.height, bh) : row === 't' ? page.height - near(page.height, bh) : page.height / 2;
    return [{ x, y }];
  }

  // Quadrillage en quinconce, tourné autour du centre de la page.
  const diagonal = Math.hypot(page.width, page.height);
  let stepX = Math.max(1, box.width + layout.gap);
  let stepY = Math.max(1, box.height + layout.gap);
  const estimate = (diagonal / stepX) * (diagonal / stepY);
  if (estimate > MAX_TILES) {
    const loosen = Math.sqrt(estimate / MAX_TILES);
    stepX *= loosen;
    stepY *= loosen;
  }
  const cols = Math.ceil(diagonal / 2 / stepX) + 1;
  const rows = Math.ceil(diagonal / 2 / stepY) + 1;
  const out: Point[] = [];
  for (let j = -rows; j <= rows; j++) {
    for (let i = -cols; i <= cols; i++) {
      const lx = i * stepX + (j % 2 !== 0 ? stepX / 2 : 0);
      const ly = j * stepY;
      const x = page.width / 2 + lx * cos - ly * sin;
      const y = page.height / 2 + lx * sin + ly * cos;
      // Les copies entièrement hors de la page ne sont pas dessinées.
      if (x + bw / 2 > 0 && x - bw / 2 < page.width && y + bh / 2 > 0 && y - bh / 2 < page.height) out.push({ x, y });
    }
  }
  return out;
}
