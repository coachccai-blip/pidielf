// Trait de signature : filtrage des points, épaisseur selon la vitesse (ou la
// pression quand le stylet la mesure) et lissage. Fonctions pures : le dessin
// sur canvas se contente de relier les échantillons produits ici.
import { smoothPath } from './path';

export interface InkPoint {
  x: number;
  y: number;
  /** Instant du point, en millisecondes. */
  t: number;
  /** Pression de 0 à 1, quand l'appareil la mesure. */
  pressure?: number;
}

export interface StrokeOptions {
  /** Épaisseur du trait le plus rapide. */
  minWidth: number;
  /** Épaisseur du trait le plus lent. */
  maxWidth: number;
  /** Vitesse (unités par milliseconde) à partir de laquelle le trait est au plus fin. */
  fastSpeed: number;
  /** Distance minimale entre deux points retenus. */
  minDistance: number;
  /** Inertie de l'épaisseur, de 0 (aucune) à 1 : évite les à-coups. */
  inertia: number;
}

export const defaultStroke: StrokeOptions = { minWidth: 1.1, maxWidth: 4.2, fastSpeed: 2.4, minDistance: 1.5, inertia: 0.65 };

/** Un point trop proche du précédent n'apporte que du bruit (tremblement, capteur bavard). */
export function keepPoint(previous: InkPoint | undefined, next: InkPoint, minDistance: number): boolean {
  if (!previous) return true;
  return Math.hypot(next.x - previous.x, next.y - previous.y) >= minDistance;
}

/** Trait lent : épais ; trait rapide : fin, comme une plume. */
export function widthFromSpeed(speed: number, options: StrokeOptions): number {
  const ratio = Math.min(1, Math.max(0, speed / options.fastSpeed));
  return options.maxWidth - (options.maxWidth - options.minWidth) * ratio;
}

export function widthFromPressure(pressure: number, options: StrokeOptions): number {
  const ratio = Math.min(1, Math.max(0, pressure));
  return options.minWidth + (options.maxWidth - options.minWidth) * ratio;
}

/**
 * Vrai si l'appareil mesure réellement la pression. Une souris annonce 0,5 en
 * permanence et beaucoup d'écrans tactiles une valeur fixe : on ne s'y fie que
 * si elle varie.
 */
export function hasPressure(points: InkPoint[]): boolean {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.pressure === undefined) return false;
    min = Math.min(min, p.pressure);
    max = Math.max(max, p.pressure);
  }
  return points.length > 1 && max - min >= 0.08;
}

/** Épaisseur en chaque point, lissée pour varier sans à-coups. */
export function strokeWidths(points: InkPoint[], options: StrokeOptions = defaultStroke): number[] {
  const byPressure = hasPressure(points);
  const widths: number[] = [];
  let current = (options.minWidth + options.maxWidth) / 2;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let target = current;
    if (byPressure) {
      target = widthFromPressure(p.pressure!, options);
    } else if (i > 0) {
      const q = points[i - 1];
      const dt = Math.max(1, p.t - q.t);
      target = widthFromSpeed(Math.hypot(p.x - q.x, p.y - q.y) / dt, options);
    }
    current = i === 0 && byPressure ? target : current * options.inertia + target * (1 - options.inertia);
    widths.push(current);
  }
  return widths;
}

export interface Sample { x: number; y: number; w: number }

/**
 * Échantillons serrés le long du trait lissé, chacun avec son épaisseur.
 * `step` est l'écart visé entre deux échantillons.
 */
export function strokeSamples(points: InkPoint[], options: StrokeOptions = defaultStroke, step = 1.5): Sample[] {
  if (points.length === 0) return [];
  const widths = strokeWidths(points, options);
  if (points.length === 1) return [{ x: points[0].x, y: points[0].y, w: options.maxWidth }];
  const path = smoothPath(points.map((p) => [p.x, p.y]));
  const samples: Sample[] = [{ x: points[0].x, y: points[0].y, w: widths[0] }];
  let fromX = points[0].x;
  let fromY = points[0].y;
  let fromW = widths[0];
  // La commande n° i (i ≥ 1) se termine au milieu des points i et i + 1, ou sur le dernier point.
  for (let i = 1; i < path.length; i++) {
    const command = path[i];
    const last = i === path.length - 1;
    const toW = last ? widths[widths.length - 1] : (widths[i] + widths[i + 1]) / 2;
    const [toX, toY] = command[0] === 'Q' ? [command[3], command[4]] : [command[1], command[2]];
    const [cx, cy] = command[0] === 'Q' ? [command[1], command[2]] : [(fromX + toX) / 2, (fromY + toY) / 2];
    // La vitesse le long d'une courbe quadratique ne dépasse pas deux fois son plus long bras.
    const reach = 2 * Math.max(Math.hypot(cx - fromX, cy - fromY), Math.hypot(toX - cx, toY - cy));
    const count = Math.max(1, Math.ceil(reach / step));
    for (let k = 1; k <= count; k++) {
      const u = k / count;
      const v = 1 - u;
      samples.push({
        x: v * v * fromX + 2 * v * u * cx + u * u * toX,
        y: v * v * fromY + 2 * v * u * cy + u * u * toY,
        w: fromW + (toW - fromW) * u,
      });
    }
    fromX = toX;
    fromY = toY;
    fromW = toW;
  }
  return samples;
}

export interface Bounds { x: number; y: number; width: number; height: number }

/** Boîte englobante des traits, épaisseur comprise ; `null` si rien n'est dessiné. */
export function samplesBounds(strokes: Sample[][]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const s of stroke) {
      const r = s.w / 2;
      minX = Math.min(minX, s.x - r);
      minY = Math.min(minY, s.y - r);
      maxX = Math.max(maxX, s.x + r);
      maxY = Math.max(maxY, s.y + r);
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Ramène des traits dans un cadre plus petit (téléphone tourné pendant la
 * signature) sans les déformer. Ne grossit jamais.
 */
export function fitStrokes(strokes: InkPoint[][], width: number, height: number, margin = 8): InkPoint[][] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX === Infinity) return strokes;
  if (minX >= margin && minY >= margin && maxX <= width - margin && maxY <= height - margin) return strokes;
  const scale = Math.min(1, (width - 2 * margin) / Math.max(1, maxX - minX), (height - 2 * margin) / Math.max(1, maxY - minY));
  const dx = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const dy = (height - (maxY - minY) * scale) / 2 - minY * scale;
  return strokes.map((stroke) => stroke.map((p) => ({ ...p, x: p.x * scale + dx, y: p.y * scale + dy })));
}
