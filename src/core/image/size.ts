// Dimensions de rendu : convertir des points PDF en pixels sans dépasser ce
// qu'un canvas de navigateur (surtout sur téléphone) peut supporter.

export interface CanvasLimits {
  /** Surface maximale, en pixels. */
  maxArea: number;
  /** Côté maximal, en pixels. */
  maxSide: number;
}

export interface RenderPlan {
  /** Échelle à appliquer aux points PDF (1 = 72 ppp). */
  scale: number;
  width: number;
  height: number;
  /** Résolution réellement obtenue, en points par pouce. */
  dpi: number;
  /** Vrai si la résolution demandée a dû être abaissée. */
  reduced: boolean;
}

/** Prévoit le rendu d'une page de `widthPt` × `heightPt` points à `dpi` points par pouce. */
export function planRender(widthPt: number, heightPt: number, dpi: number, limits: CanvasLimits): RenderPlan {
  const wanted = dpi / 72;
  const byArea = Math.sqrt(limits.maxArea / (widthPt * heightPt));
  const bySide = limits.maxSide / Math.max(widthPt, heightPt);
  const scale = Math.min(wanted, byArea, bySide);
  return {
    scale,
    width: Math.max(1, Math.floor(widthPt * scale)),
    height: Math.max(1, Math.floor(heightPt * scale)),
    dpi: Math.round(scale * 72),
    reduced: scale < wanted - 1e-9,
  };
}

/** Réduit des dimensions (sans jamais agrandir) pour respecter les limites d'un canvas. */
export function fitWithin(width: number, height: number, limits: Partial<CanvasLimits>): { width: number; height: number; scale: number } {
  const scale = Math.min(
    1,
    limits.maxSide ? limits.maxSide / Math.max(width, height) : 1,
    limits.maxArea ? Math.sqrt(limits.maxArea / (width * height)) : 1,
  );
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}
