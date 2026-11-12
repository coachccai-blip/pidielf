// Surligneur du lecteur : géométrie du trait.

/**
 * Un trait de surligneur presque droit est redressé : on surligne une ligne de
 * texte d'un geste, sans avoir la main parfaitement sûre.
 */
export function straighten(stroke: number[][], size: { width: number; height: number } | undefined, width: number): number[][] {
  if (!size || stroke.length < 3) return stroke;
  const xs = stroke.map((p) => p[0] * size.width);
  const ys = stroke.map((p) => p[1] * size.height);
  const span = (v: number[]) => Math.max(...v) - Math.min(...v);
  const middle = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const dx = span(xs);
  const dy = span(ys);
  if (dx > width * 2 && dy < Math.max(width * 0.9, dx * 0.06)) {
    const y = middle(ys) / size.height;
    return [[Math.min(...xs) / size.width, y], [Math.max(...xs) / size.width, y]];
  }
  if (dy > width * 2 && dx < Math.max(width * 0.9, dy * 0.06)) {
    const x = middle(xs) / size.width;
    return [[x, Math.min(...ys) / size.height], [x, Math.max(...ys) / size.height]];
  }
  return stroke;
}
