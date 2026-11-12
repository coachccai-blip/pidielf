// Modèle de l'éditeur de page : les éléments posés sur chaque page, et la
// géométrie pour les déplacer, les redimensionner et les exporter.
// Coordonnées normalisées (0 à 1) dans la page affichée, comme overlayTypes.ts.
import type { NBox, Overlay, OverlayFont, PageOverlays } from '@/core/pdf/overlayTypes';

type Editable = Exclude<Overlay, { type: 'underline' | 'note' }>;

interface ElementMeta {
  id: string;
  /** Image : le rapport largeur / hauteur est conservé au redimensionnement. */
  keepRatio?: boolean;
  /** Texte : la boîte épouse le texte tant que sa largeur n'a pas été réglée à la main. */
  autoWidth?: boolean;
  /** Nom annoncé par les lecteurs d'écran (« Signature », « Initiales »…). */
  label?: string;
}

export type EditorElement = Editable & ElementMeta;
export type ElementOf<T extends Editable['type']> = Extract<Editable, { type: T }> & ElementMeta;
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type NewElement = WithoutId<EditorElement>;

/** Éléments de chaque page (numérotées à partir de 1), dans l'ordre où ils sont dessinés. */
export type PagesState = Record<number, EditorElement[]>;

export interface Point { x: number; y: number }
export interface PageSize { width: number; height: number }

/** Réglages repris pour chaque nouvel élément (les derniers utilisés). */
export interface EditorDefaults {
  font: OverlayFont;
  size: number;
  textColor: string;
  stroke: string;
  strokeWidth: number;
  /** Vide : pas de remplissage. */
  fill: string;
  inkColor: string;
  inkWidth: number;
  highlight: string;
}

export const baseDefaults: EditorDefaults = {
  font: 'sans',
  size: 14,
  textColor: '#1a1a1a',
  stroke: '#d92d20',
  strokeWidth: 2,
  fill: '',
  inkColor: '#1d4ed8',
  inkWidth: 2,
  highlight: '#ffe066',
};

export const LINE_HEIGHT = 1.2;
const MIN_SIZE = 0.012;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function pointsBounds(points: number[][]): NBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return minX === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Boîte englobante d'un élément. */
export function boundsOf(el: EditorElement): NBox {
  switch (el.type) {
    case 'line':
    case 'arrow':
      return pointsBounds([[el.x1, el.y1], [el.x2, el.y2]]);
    case 'ink':
      return pointsBounds(el.strokes.flat());
    case 'highlight':
      return pointsBounds(el.rects.flatMap((r) => [[r.x, r.y], [r.x + r.w, r.y + r.h]]));
    default:
      return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
}

/** Applique une transformation à tous les points d'un élément ; `size` transforme ses dimensions. */
function mapGeometry(el: EditorElement, point: (x: number, y: number) => [number, number], size: (w: number, h: number) => [number, number]): EditorElement {
  switch (el.type) {
    case 'line':
    case 'arrow': {
      const [x1, y1] = point(el.x1, el.y1);
      const [x2, y2] = point(el.x2, el.y2);
      return { ...el, x1, y1, x2, y2 };
    }
    case 'ink':
      return { ...el, strokes: el.strokes.map((stroke) => stroke.map(([x, y]) => point(x, y))) };
    case 'highlight':
      return {
        ...el,
        rects: el.rects.map((r) => {
          const [x, y] = point(r.x, r.y);
          const [w, h] = size(r.w, r.h);
          return { x, y, w, h };
        }),
      };
    default: {
      const [x, y] = point(el.x, el.y);
      const [w, h] = size(el.w, el.h);
      return { ...el, x, y, w, h };
    }
  }
}

/** Déplace un élément, sans le laisser sortir de la page. */
export function moved(el: EditorElement, dx: number, dy: number): EditorElement {
  const b = boundsOf(el);
  const tx = clamp(dx, -b.x, Math.max(-b.x, 1 - b.x - b.w));
  const ty = clamp(dy, -b.y, Math.max(-b.y, 1 - b.y - b.h));
  return mapGeometry(el, (x, y) => [x + tx, y + ty], (w, h) => [w, h]);
}

/** Étire un élément pour que sa boîte englobante devienne `to`. */
export function resized(el: EditorElement, to: NBox): EditorElement {
  const from = boundsOf(el);
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  return mapGeometry(el, (x, y) => [to.x + (x - from.x) * sx, to.y + (y - from.y) * sy], (w, h) => [w * sx, h * sy]);
}

/**
 * Agrandit ou réduit un élément autour de son centre (pincement à deux doigts).
 * `ratio` est le rapport largeur / hauteur de la page : une même distance à
 * l'écran ne vaut pas la même fraction en x et en y.
 */
export function scaled(el: EditorElement, factor: number, ratio: number): EditorElement {
  const b = boundsOf(el);
  // On ne dépasse ni la page ni une taille minimale encore saisissable.
  const largest = Math.min(b.w > 0 ? 1 / b.w : Infinity, b.h > 0 ? 1 / b.h : Infinity);
  const smallest = Math.max(b.w > 0 ? MIN_SIZE / b.w : 0, b.h > 0 ? (MIN_SIZE * ratio) / b.h : 0);
  const k = clamp(factor, Math.min(1, smallest), Math.max(1, largest));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const next = mapGeometry(el, (x, y) => [cx + (x - cx) * k, cy + (y - cy) * k], (w, h) => [w * k, h * k]);
  if (next.type === 'text' && el.type === 'text') next.size = clamp(Math.round(el.size * k * 10) / 10, 4, 400);
  return moved(next, 0, 0);
}

/**
 * Adapte un élément à une page d'un autre format : il garde sa taille réelle
 * (en points) et la position relative de son centre. Sert à répéter des
 * initiales sur des pages en portrait comme en paysage.
 */
export function refit(el: EditorElement, from: PageSize, to: PageSize): EditorElement {
  if (from.width === to.width && from.height === to.height) return el;
  const b = boundsOf(el);
  let fx = from.width / to.width;
  let fy = from.height / to.height;
  // Plus grand que la page d'arrivée : on réduit juste ce qu'il faut.
  const fit = Math.min(1, b.w > 0 ? 1 / (b.w * fx) : 1, b.h > 0 ? 1 / (b.h * fy) : 1);
  fx *= fit;
  fy *= fit;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return moved(mapGeometry(el, (x, y) => [cx + (x - cx) * fx, cy + (y - cy) * fy], (w, h) => [w * fx, h * fy]), 0, 0);
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e' | 'p1' | 'p2';

/**
 * Poignées proposées pour un élément, selon sa taille à l'écran (en pixels) :
 * sur un élément très petit, quatre coins se marcheraient dessus.
 */
export function handlesOf(el: EditorElement, widthPx: number, heightPx: number): Handle[] {
  if (el.type === 'line' || el.type === 'arrow') return ['p1', 'p2'];
  // Texte : les côtés règlent la largeur de retour à la ligne, les coins le corps.
  if (el.type === 'text') return heightPx < 44 ? ['w', 'e'] : ['w', 'e', 'nw', 'ne', 'sw', 'se'];
  return Math.min(widthPx, heightPx) < 30 ? ['nw', 'se'] : ['nw', 'ne', 'sw', 'se'];
}

/** Position d'une poignée, en coordonnées normalisées. */
export function handlePoint(el: EditorElement, handle: Handle): Point {
  if (el.type === 'line' || el.type === 'arrow') return handle === 'p1' ? { x: el.x1, y: el.y1 } : { x: el.x2, y: el.y2 };
  const b = boundsOf(el);
  if (handle === 'w' || handle === 'e') return { x: handle === 'w' ? b.x : b.x + b.w, y: b.y + b.h / 2 };
  return { x: handle.includes('w') ? b.x : b.x + b.w, y: handle.startsWith('n') ? b.y : b.y + b.h };
}

/**
 * Élément obtenu en tirant une poignée jusqu'au point `to`. `origin` est
 * l'élément au début du geste ; `lockRatio` conserve ses proportions.
 */
export function dragHandle(origin: EditorElement, handle: Handle, to: Point, ratio: number, lockRatio: boolean): EditorElement {
  const px = clamp(to.x, 0, 1);
  const py = clamp(to.y, 0, 1);
  if (origin.type === 'line' || origin.type === 'arrow') {
    return handle === 'p1' ? { ...origin, x1: px, y1: py } : { ...origin, x2: px, y2: py };
  }
  const b = boundsOf(origin);
  if (handle === 'w' || handle === 'e') {
    // Texte : les poignées latérales règlent la largeur de retour à la ligne.
    const fixed = handle === 'w' ? b.x + b.w : b.x;
    const w = Math.max(MIN_SIZE * 2, Math.abs(px - fixed));
    const next = { ...origin, x: handle === 'w' ? fixed - w : fixed, w };
    return origin.type === 'text' ? { ...next, autoWidth: false } as EditorElement : (next as EditorElement);
  }
  const fx = handle.includes('w') ? b.x + b.w : b.x;
  const fy = handle.startsWith('n') ? b.y + b.h : b.y;
  let w = Math.max(MIN_SIZE, handle.includes('w') ? fx - px : px - fx);
  let h = Math.max(MIN_SIZE * ratio, handle.startsWith('n') ? fy - py : py - fy);
  const uniform = lockRatio || origin.type === 'text';
  if (uniform && b.w > 0 && b.h > 0) {
    // On suit le côté qui a le plus bougé, et l'autre s'aligne.
    const kx = w / b.w;
    const ky = h / b.h;
    const k = Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky;
    const limit = Math.min((handle.includes('w') ? fx : 1 - fx) / b.w, (handle.startsWith('n') ? fy : 1 - fy) / b.h);
    const factor = Math.min(k, limit);
    w = b.w * factor;
    h = b.h * factor;
  }
  const box = { x: handle.includes('w') ? fx - w : fx, y: handle.startsWith('n') ? fy - h : fy, w, h };
  if (origin.type === 'text') {
    // Un coin de texte change le corps : la boîte suit, la mise en lignes reste la même.
    return { ...origin, ...box, size: clamp(Math.round(origin.size * (w / b.w) * 10) / 10, 4, 400) };
  }
  return resized(origin, box);
}

/** Vrai si les proportions de l'élément sont conservées quand on tire un coin. */
export const keepsRatio = (el: EditorElement): boolean => el.type === 'image' && el.keepRatio !== false;

export const totalCount = (pages: PagesState): number => Object.values(pages).reduce((sum, list) => sum + list.length, 0);

/** Éléments prêts pour `applyOverlays` : sans les informations propres à l'éditeur. */
export function toPageOverlays(pages: PagesState): PageOverlays[] {
  return Object.entries(pages)
    .filter(([, list]) => list.length > 0)
    .map(([page, list]) => ({
      page: Number(page),
      overlays: list.map((el): Overlay => {
        const { id, keepRatio, autoWidth, label, ...overlay } = el;
        return overlay;
      }),
    }));
}
