// Éléments posés par-dessus une page : édition, signature, annotations du lecteur.
//
// Coordonnées : normalisées de 0 à 1 dans la page telle qu'elle est AFFICHÉE
// (rotation de la page comprise), origine en haut à gauche, x vers la droite,
// y vers le bas. Tailles (police, épaisseur de trait) en points PDF.

export interface NBox { x: number; y: number; w: number; h: number }

export type OverlayFont = 'sans' | 'serif' | 'mono';

export type Overlay =
  | ({ type: 'text'; text: string; font: OverlayFont; size: number; color: string; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; lineHeight?: number } & NBox)
  | ({ type: 'image'; data: Uint8Array; mime: 'image/png' | 'image/jpeg'; opacity?: number } & NBox)
  | ({ type: 'rect' | 'ellipse'; stroke?: string; fill?: string; strokeWidth: number; opacity?: number } & NBox)
  | { type: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; opacity?: number }
  | { type: 'ink'; /** Traits : chacun est une suite de points [x, y]. */ strokes: number[][][]; color: string; width: number; opacity?: number }
  | { type: 'highlight'; rects: NBox[]; color: string; opacity?: number }
  | { type: 'underline'; rects: NBox[]; color: string; width?: number }
  | ({ type: 'whiteout'; color?: string } & NBox)
  | { type: 'note'; x: number; y: number; text: string; color?: string };

export interface PageOverlays {
  /** Numéro de page, à partir de 1. */
  page: number;
  overlays: Overlay[];
}
