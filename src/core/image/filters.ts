// Rendus du scanner : couleur, niveaux de gris, noir et blanc contrasté.
// Toutes les fonctions modifient l'image fournie, sans allocation inutile.
import type { RgbaImage } from './geometry';

export type ScanMode = 'color' | 'grey' | 'bw';

/** Luminance perçue (0 – 255) d'un pixel. */
const luma = (r: number, g: number, b: number): number => (r * 77 + g * 150 + b * 29) >> 8;

export function toGrey(image: RgbaImage): void {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = luma(d[i], d[i + 1], d[i + 2]);
    d[i] = y;
    d[i + 1] = y;
    d[i + 2] = y;
  }
}

/**
 * Étire légèrement le contraste : le papier tire vers le blanc, l'encre vers le
 * noir. Les bornes sont lues sur l'histogramme (en écartant `clip` des pixels
 * à chaque extrémité) puis limitées, pour ne pas dénaturer une photo déjà correcte.
 */
export function stretchContrast(image: RgbaImage, clip = 0.01): void {
  const d = image.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) histogram[luma(d[i], d[i + 1], d[i + 2])]++;
  const total = d.length / 4;
  const edge = total * clip;
  let lo = 0;
  for (let sum = 0; lo < 255; lo++) {
    sum += histogram[lo];
    if (sum > edge) break;
  }
  let hi = 255;
  for (let sum = 0; hi > 0; hi--) {
    sum += histogram[hi];
    if (sum > edge) break;
  }
  lo = Math.min(lo, 96);
  hi = Math.max(hi, 160);
  if (hi - lo >= 255) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

/**
 * Noir et blanc par seuil adaptatif (Bradley-Roth) : chaque pixel est comparé
 * à la moyenne de son voisinage, calculée avec une image intégrale. Un texte
 * reste lisible même si la page est éclairée de façon inégale.
 * `sensitivity` : un pixel devient noir s'il est plus sombre que la moyenne
 * locale d'au moins cette proportion.
 */
export function adaptiveThreshold(image: RgbaImage, options: { window?: number; sensitivity?: number } = {}): void {
  const { data: d, width: w, height: h } = image;
  const half = Math.max(7, Math.round((options.window ?? Math.min(w, h) / 8) / 2));
  const keep = 1 - (options.sensitivity ?? 0.15);

  // Image intégrale de la luminance, avec une ligne et une colonne de zéros en tête.
  // Au-delà de 16 millions de pixels, la somme dépasserait 32 bits.
  const stride = w + 1;
  const integral = w * h > 16_000_000 ? new Float64Array(stride * (h + 1)) : new Uint32Array(stride * (h + 1));
  for (let y = 0, p = 0; y < h; y++) {
    let row = 0;
    const at = (y + 1) * stride;
    for (let x = 0; x < w; x++, p += 4) {
      row += luma(d[p], d[p + 1], d[p + 2]);
      integral[at + x + 1] = integral[at - stride + x + 1] + row;
    }
  }

  for (let y = 0, p = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++, p += 4) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w, x + half + 1);
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
      const count = (x1 - x0) * (y1 - y0);
      const v = luma(d[p], d[p + 1], d[p + 2]) * count < sum * keep ? 0 : 255;
      d[p] = v;
      d[p + 1] = v;
      d[p + 2] = v;
      d[p + 3] = 255;
    }
  }
}

/**
 * Blanchit un mince cadre au bord de l'image. Les coins posés exactement sur le
 * bord de la feuille font déborder un liseré du fond, que le seuil transforme
 * en pointillés noirs.
 */
export function clearFrame(image: RgbaImage, thickness: number): void {
  const { data: d, width: w, height: h } = image;
  const t = Math.min(thickness, w >> 1, h >> 1);
  for (let y = 0; y < h; y++) {
    const inner = y >= t && y < h - t;
    for (let x = 0; x < w; x++) {
      if (inner && x === t) x = w - t; // saute l'intérieur de la ligne
      const p = (y * w + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = 255;
    }
  }
}

export function applyScanMode(image: RgbaImage, mode: ScanMode): void {
  if (mode === 'bw') {
    adaptiveThreshold(image);
    clearFrame(image, Math.max(1, Math.round(Math.max(image.width, image.height) / 400)));
    return;
  }
  if (mode === 'grey') toGrey(image);
  stretchContrast(image);
}

/**
 * Compacte une image noir et blanc à un bit par pixel (1 = blanc), chaque
 * ligne complétée à l'octet : le format attendu par une image PDF en
 * DeviceGray 1 bit, bien plus légère et plus nette qu'un JPEG.
 */
export function packBilevel(image: RgbaImage): Uint8Array {
  const { data: d, width: w, height: h } = image;
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const row = y * rowBytes;
    for (let x = 0, p = y * w * 4; x < w; x++, p += 4) {
      if (d[p] >= 128) out[row + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}
