// Numérotation : ce qui s'écrit sur chaque page, et où. Fonctions pures
// (sans pdf-lib), partagées par le traitement et l'aperçu.
import type { Size } from './watermarkLayout';

/** « 3 », « 3 / 12 » ou « Page 3 ». */
export type NumberFormat = 'n' | 'n-total' | 'prefix-n';
export type NumberSide = 'left' | 'center' | 'right';
export type NumberEdge = 'top' | 'bottom';

export function formatPageNumber(format: NumberFormat, n: number, total: number, prefix = ''): string {
  if (format === 'n-total') return `${n} / ${total}`;
  if (format === 'prefix-n') return `${prefix.trim()} ${n}`.trim();
  return String(n);
}

export interface NumberingOptions {
  /** Numéro porté par la première page numérotée. */
  start: number;
  format: NumberFormat;
  /** Mot placé devant le numéro (« Page »), pour le format « prefix-n ». */
  prefix?: string;
  /** Pages laissées sans numéro (à partir de 1). */
  exclude?: number[];
  /** Vrai : les pages exclues comptent quand même dans la suite des numéros. */
  countExcluded?: boolean;
  side: NumberSide;
  /** Marges miroir : le côté choisi vaut pour les pages impaires et s'inverse sur les pages paires. */
  mirror?: boolean;
}

/** Côté réel du numéro sur une page donnée (la parité est celle de la feuille, pas du numéro affiché). */
export function sideForPage(side: NumberSide, mirror: boolean, page: number): NumberSide {
  if (!mirror || side === 'center' || page % 2 === 1) return side;
  return side === 'left' ? 'right' : 'left';
}

export interface PageLabel { text: string; side: NumberSide }

/** Le numéro de chaque page du document, ou null pour une page sans numéro. */
export function numberingPlan(pageCount: number, options: NumberingOptions): Array<PageLabel | null> {
  const excluded = new Set(options.exclude ?? []);
  const numbered = Array.from({ length: pageCount }, (_, i) => !excluded.has(i + 1));
  const counted = options.countExcluded ? pageCount : numbered.filter(Boolean).length;
  const total = options.start + counted - 1;
  let rank = 0;
  return numbered.map((keep, i) => {
    const n = options.start + (options.countExcluded ? i : rank);
    if (!keep) return null;
    rank++;
    return { text: formatPageNumber(options.format, n, total, options.prefix), side: sideForPage(options.side, !!options.mirror, i + 1) };
  });
}

/** Hauteur des chiffres, en fraction du corps : sert à aligner le haut du numéro sur la marge. */
const DIGIT_HEIGHT = 0.72;

/**
 * Point d'ancrage du numéro dans le repère d'affichage (origine en bas à
 * gauche) : `x` est le bord gauche, le milieu ou le bord droit du texte selon
 * le côté ; `y` est la ligne de base.
 */
export function numberAnchor(page: Size, edge: NumberEdge, side: NumberSide, margin: number, size: number): { x: number; y: number } {
  const m = Math.max(0, Math.min(margin, Math.min(page.width, page.height) / 2));
  const x = side === 'left' ? m : side === 'right' ? page.width - m : page.width / 2;
  const y = edge === 'bottom' ? m : page.height - m - DIGIT_HEIGHT * size;
  return { x, y };
}
