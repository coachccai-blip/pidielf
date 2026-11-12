// Géométrie des traits, partagée par l'aperçu à l'écran et par l'incrustation
// dans le PDF : les deux dessinent exactement la même courbe.

export type PathCommand = ['M', number, number] | ['L', number, number] | ['Q', number, number, number, number];

/**
 * Courbe lisse passant par une suite de points : chaque point sert de point de
 * contrôle d'une courbe quadratique tendue entre les milieux des segments
 * voisins. Les angles du tracé au doigt disparaissent sans décaler le trait.
 */
export function smoothPath(points: number[][]): PathCommand[] {
  if (points.length === 0) return [];
  const [x0, y0] = points[0];
  const path: PathCommand[] = [['M', x0, y0]];
  if (points.length === 1) {
    // Un simple appui : un segment nul, que les extrémités rondes transforment en point.
    path.push(['L', x0, y0]);
    return path;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    path.push(['Q', cx, cy, (cx + nx) / 2, (cy + ny) / 2]);
  }
  const [lx, ly] = points[points.length - 1];
  path.push(['L', lx, ly]);
  return path;
}

/** Même courbe, au format de l'attribut `d` d'un chemin SVG. */
export function svgPath(points: number[][]): string {
  return smoothPath(points)
    .map((c) => `${c[0]}${c.slice(1).map((n) => round2(n as number)).join(' ')}`)
    .join('');
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ArrowHead {
  /** Fin de la tige, au pied de la pointe. */
  base: [number, number];
  tip: [number, number];
  left: [number, number];
  right: [number, number];
}

/**
 * Pointe d'une flèche allant de (x1, y1) à (x2, y2), proportionnée à
 * l'épaisseur du trait et jamais plus longue que les deux tiers de la flèche.
 */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): ArrowHead {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0) return { base: [x2, y2], tip: [x2, y2], left: [x2, y2], right: [x2, y2] };
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const head = Math.min(Math.max(strokeWidth * 4.5, 7), length * 0.66);
  const half = head * 0.42;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  return {
    base: [bx, by],
    tip: [x2, y2],
    left: [bx - uy * half, by + ux * half],
    right: [bx + uy * half, by - ux * half],
  };
}
