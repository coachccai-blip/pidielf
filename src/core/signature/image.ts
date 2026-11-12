// Traitement des pixels d'une signature importée (photo d'une signature sur
// papier) : fond blanc rendu transparent, puis rognage au plus près de l'encre.
// Les tableaux sont au format RGBA d'un canvas (4 octets par pixel).
import type { Bounds } from './stroke';

/**
 * Rend transparent ce qui est clair. Au-dessus de `white`, le pixel disparaît ;
 * en dessous de `ink`, il reste opaque ; entre les deux, la transparence est
 * progressive pour garder des bords doux. Modifie `pixels` sur place.
 */
export function whiteToAlpha(pixels: Uint8ClampedArray, white = 215, ink = 140): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const keep = luminance >= white ? 0 : luminance <= ink ? 1 : (white - luminance) / (white - ink);
    pixels[i + 3] = Math.round(pixels[i + 3] * keep);
  }
}

/** Boîte englobante des pixels visibles ; `null` si l'image est entièrement transparente. */
export function alphaBounds(pixels: Uint8ClampedArray, width: number, height: number, threshold = 12): Bounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
