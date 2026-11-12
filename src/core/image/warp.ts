// Redressement de perspective : le quadrilatère désigné dans la photo devient
// un rectangle, par échantillonnage bilinéaire.
import { solveHomography, type Quad, type RgbaImage } from './geometry';

/**
 * Projette le quadrilatère `quad` (en pixels de `src`) sur une image de
 * `width` × `height` pixels. Les coins du rectangle de sortie correspondent
 * aux coins du quadrilatère ; les pixels sont lus en leur centre.
 */
export function warpPerspective(src: RgbaImage, quad: Quad, width: number, height: number): RgbaImage {
  const rect: Quad = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const h = solveHomography(rect, quad);
  if (!h) throw new Error('Quadrilatère dégénéré : les coins sont alignés.');

  const out = new Uint8ClampedArray(width * height * 4);
  const s = src.data;
  const sw = src.width;
  const maxX = sw - 1;
  const maxY = src.height - 1;
  let o = 0;
  for (let j = 0; j < height; j++) {
    const y = j + 0.5;
    // Numérateurs et dénominateur avancent linéairement le long d'une ligne.
    let nx = h[0] * 0.5 + h[1] * y + h[2];
    let ny = h[3] * 0.5 + h[4] * y + h[5];
    let nw = h[6] * 0.5 + h[7] * y + h[8];
    for (let i = 0; i < width; i++) {
      let sx = nx / nw - 0.5;
      let sy = ny / nw - 0.5;
      nx += h[0];
      ny += h[3];
      nw += h[6];
      if (sx < 0) sx = 0;
      else if (sx > maxX) sx = maxX;
      if (sy < 0) sy = 0;
      else if (sy > maxY) sy = maxY;
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const p00 = (y0 * sw + x0) * 4;
      const p01 = x0 < maxX ? p00 + 4 : p00;
      const p10 = y0 < maxY ? p00 + sw * 4 : p00;
      const p11 = x0 < maxX ? p10 + 4 : p10;
      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;
      out[o] = s[p00] * w00 + s[p01] * w01 + s[p10] * w10 + s[p11] * w11;
      out[o + 1] = s[p00 + 1] * w00 + s[p01 + 1] * w01 + s[p10 + 1] * w10 + s[p11 + 1] * w11;
      out[o + 2] = s[p00 + 2] * w00 + s[p01 + 2] * w01 + s[p10 + 2] * w10 + s[p11 + 2] * w11;
      out[o + 3] = s[p00 + 3] * w00 + s[p01 + 3] * w01 + s[p10 + 3] * w10 + s[p11 + 3] * w11;
      o += 4;
    }
  }
  return { data: out, width, height };
}
