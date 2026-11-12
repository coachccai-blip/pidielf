// Fabrique des éléments : formes tracées en faisant glisser, formes par défaut
// posées d'un simple appui, images et textes.
import type { NBox } from '@/core/pdf/overlayTypes';
import type { PickedImage } from './images';
import { LINE_HEIGHT, type EditorDefaults, type NewElement, type PageSize, type Point } from './model';
import type { DrawShape } from './useEditor';

type BoxShape = Exclude<DrawShape, 'ink'>;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const clampPoint = (p: Point): Point => ({ x: clamp01(p.x), y: clamp01(p.y) });

const boxBetween = (a: Point, b: Point): NBox => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

/** Élément correspondant à un glissement du point `a` au point `b`. */
export function shapeFromDrag(shape: BoxShape, a: Point, b: Point, defaults: EditorDefaults): NewElement {
  switch (shape) {
    case 'rect':
    case 'ellipse':
      return { type: shape, ...boxBetween(a, b), stroke: defaults.stroke, strokeWidth: defaults.strokeWidth, fill: defaults.fill || undefined };
    case 'line':
    case 'arrow':
      return { type: shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: defaults.stroke, strokeWidth: defaults.strokeWidth };
    case 'highlight':
      return { type: 'highlight', rects: [boxBetween(a, b)], color: defaults.highlight };
    case 'whiteout':
    case 'cover':
      return { type: 'whiteout', ...boxBetween(a, b) };
  }
}

/** Élément de taille courante, centré sur `at` : pour un simple appui ou une création au clavier. */
export function defaultShape(shape: BoxShape, at: Point, defaults: EditorDefaults, page: PageSize): NewElement {
  const w = shape === 'line' || shape === 'arrow' ? 0.22 : 0.26;
  // Hauteurs en points, pour garder la même allure sur une page en paysage.
  const heightPt = shape === 'highlight' || shape === 'whiteout' || shape === 'cover' ? 16 : shape === 'line' || shape === 'arrow' ? 0 : 60;
  const h = heightPt / page.height;
  const x = Math.min(1 - w, Math.max(0, at.x - w / 2));
  const y = Math.min(1 - h, Math.max(0, at.y - h / 2));
  return shapeFromDrag(shape, { x, y }, { x: x + w, y: y + h }, defaults);
}

/** Image centrée sur `at`, large de `widthRatio` fois la page, sans dépasser la moitié de sa hauteur. */
export function imageElement(image: PickedImage, at: Point, page: PageSize, widthRatio: number, extra: { label?: string } = {}): NewElement {
  const aspect = image.height / Math.max(1, image.width);
  let w = widthRatio;
  let h = (w * page.width * aspect) / page.height;
  if (h > 0.5) {
    w *= 0.5 / h;
    h = 0.5;
  }
  return {
    type: 'image',
    data: image.data,
    mime: image.mime,
    x: Math.min(1 - w, Math.max(0, at.x - w / 2)),
    y: Math.min(1 - h, Math.max(0, at.y - h / 2)),
    w,
    h,
    keepRatio: true,
    ...extra,
  };
}

/** Texte dont le coin haut gauche est en `at`. Sans `width`, la boîte épouse le texte. */
export function textElement(text: string, at: Point, defaults: EditorDefaults, page: PageSize, options: { width?: number; size?: number } = {}): NewElement {
  const size = options.size ?? defaults.size;
  const x = Math.min(0.98, Math.max(0, at.x));
  return {
    type: 'text',
    text,
    font: defaults.font,
    size,
    color: defaults.textColor,
    x,
    y: Math.min(1 - (size * LINE_HEIGHT) / page.height, Math.max(0, at.y)),
    // Dimensions provisoires : la mise en lignes les ajuste aussitôt.
    w: options.width ?? Math.min(0.3, 1 - x),
    h: (size * LINE_HEIGHT) / page.height,
    lineHeight: LINE_HEIGHT,
    autoWidth: options.width === undefined,
  };
}
