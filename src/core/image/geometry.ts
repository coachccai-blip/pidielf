// Géométrie du scanner : quadrilatère d'une page photographiée et homographie
// qui le ramène à un rectangle.

export interface Point { x: number; y: number }

/** Quatre coins dans l'ordre : haut-gauche, haut-droite, bas-droite, bas-gauche. */
export type Quad = [Point, Point, Point, Point];

/** Image brute : quatre octets (R, V, B, A) par pixel, ligne par ligne. */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Coins de départ, en coordonnées normalisées (0 – 1), légèrement en retrait des bords. */
export function defaultQuad(inset = 0.04): Quad {
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: 1 - inset, y: 1 - inset },
    { x: inset, y: 1 - inset },
  ];
}

export function scaleQuad(quad: Quad, sx: number, sy: number): Quad {
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}

/**
 * Suit une rotation de l'image de 90° dans le sens horaire (coordonnées
 * normalisées). Les coins sont renommés pour que le premier reste « en haut à
 * gauche » de l'image tournée.
 */
export function rotateQuad90(quad: Quad): Quad {
  const turn = (p: Point): Point => ({ x: 1 - p.y, y: p.x });
  return [turn(quad[3]), turn(quad[0]), turn(quad[1]), turn(quad[2])];
}

/**
 * Vrai si les coins forment un quadrilatère convexe parcouru dans le bon sens
 * (ni croisé, ni retourné) et d'une surface suffisante pour être redressé.
 */
export function isValidQuad(quad: Quad, minArea = 1e-4): boolean {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    // Axe y vers le bas : un parcours horaire donne des produits vectoriels positifs.
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2 >= minArea;
}

/**
 * Homographie (matrice 3 × 3, ligne par ligne) qui envoie chaque point de
 * `from` sur le point correspondant de `to`. Renvoie null si les points sont
 * alignés : le système à huit inconnues n'a alors pas de solution unique.
 */
export function solveHomography(from: Quad, to: Quad): Float64Array | null {
  const n = 8;
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Élimination de Gauss avec pivot partiel.
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) < 1e-10) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = col + 1; row < n; row++) {
      const f = m[row][col] / m[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) m[row][k] -= f * m[col][k];
    }
  }
  const h = new Float64Array(9);
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row][n];
    for (let k = row + 1; k < n; k++) sum -= m[row][k] * h[k];
    h[row] = sum / m[row][row];
  }
  h[8] = 1;
  return h;
}

export function applyHomography(h: Float64Array, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Taille de l'image redressée, estimée d'après la longueur des côtés du
 * quadrilatère (en pixels) et plafonnée : le plus grand côté ne dépasse pas `maxSide`.
 */
export function quadOutputSize(quad: Quad, maxSide: number): { width: number; height: number } {
  const w = Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2]));
  const h = Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2]));
  const scale = Math.min(1, maxSide / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
