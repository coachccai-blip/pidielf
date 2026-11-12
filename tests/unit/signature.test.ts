import { describe, expect, it } from 'vitest';
import { alphaBounds, whiteToAlpha } from '@/core/signature/image';
import { arrowHead, smoothPath, svgPath } from '@/core/signature/path';
import {
  defaultStroke, fitStrokes, hasPressure, keepPoint, samplesBounds, strokeSamples, strokeWidths, widthFromPressure, widthFromSpeed,
  type InkPoint,
} from '@/core/signature/stroke';

/** Trait horizontal : un point tous les `dx` pixels, toutes les `dt` millisecondes. */
const line = (count: number, dx: number, dt: number, pressure?: (i: number) => number): InkPoint[] =>
  Array.from({ length: count }, (_, i) => ({ x: 10 + i * dx, y: 50, t: i * dt, pressure: pressure?.(i) }));

describe('filtrage des points', () => {
  it('garde le premier point et écarte ceux qui sont trop proches', () => {
    const a: InkPoint = { x: 0, y: 0, t: 0 };
    expect(keepPoint(undefined, a, 2)).toBe(true);
    expect(keepPoint(a, { x: 1, y: 1, t: 5 }, 2)).toBe(false);
    expect(keepPoint(a, { x: 2, y: 0, t: 5 }, 2)).toBe(true);
  });
});

describe('épaisseur du trait', () => {
  it('diminue avec la vitesse, entre les deux bornes', () => {
    const o = defaultStroke;
    expect(widthFromSpeed(0, o)).toBe(o.maxWidth);
    expect(widthFromSpeed(o.fastSpeed, o)).toBeCloseTo(o.minWidth);
    expect(widthFromSpeed(o.fastSpeed * 10, o)).toBeCloseTo(o.minWidth);
    expect(widthFromSpeed(o.fastSpeed / 2, o)).toBeCloseTo((o.minWidth + o.maxWidth) / 2);
  });

  it('augmente avec la pression', () => {
    const o = defaultStroke;
    expect(widthFromPressure(0, o)).toBe(o.minWidth);
    expect(widthFromPressure(1, o)).toBe(o.maxWidth);
    expect(widthFromPressure(2, o)).toBe(o.maxWidth);
  });

  it('un trait lent est plus épais qu’un trait rapide, sans à-coups', () => {
    const slow = strokeWidths(line(30, 2, 16));
    const fast = strokeWidths(line(30, 30, 16));
    expect(slow.at(-1)!).toBeGreaterThan(fast.at(-1)! + 1);
    for (const widths of [slow, fast]) {
      for (let i = 1; i < widths.length; i++) {
        expect(Math.abs(widths[i] - widths[i - 1])).toBeLessThan(1.2);
        expect(widths[i]).toBeGreaterThanOrEqual(defaultStroke.minWidth - 1e-9);
        expect(widths[i]).toBeLessThanOrEqual(defaultStroke.maxWidth + 1e-9);
      }
    }
  });

  it('ne se fie à la pression que si elle varie', () => {
    expect(hasPressure(line(10, 5, 16))).toBe(false);
    expect(hasPressure(line(10, 5, 16, () => 0.5))).toBe(false); // souris
    const pen = line(10, 5, 16, (i) => 0.2 + i * 0.08);
    expect(hasPressure(pen)).toBe(true);
    const widths = strokeWidths(pen);
    expect(widths.at(-1)!).toBeGreaterThan(widths[0]);
  });
});

describe('lissage', () => {
  it('relie les points par des courbes passant par les milieux', () => {
    const path = smoothPath([[0, 0], [10, 0], [10, 10], [20, 10]]);
    expect(path).toEqual([
      ['M', 0, 0],
      ['Q', 10, 0, 10, 5],
      ['Q', 10, 10, 15, 10],
      ['L', 20, 10],
    ]);
    expect(svgPath([[0, 0], [10, 0], [10, 10], [20, 10]])).toBe('M0 0Q10 0 10 5Q10 10 15 10L20 10');
  });

  it('gère le point isolé et le segment simple', () => {
    expect(smoothPath([])).toEqual([]);
    expect(smoothPath([[3, 4]])).toEqual([['M', 3, 4], ['L', 3, 4]]);
    expect(smoothPath([[0, 0], [5, 5]])).toEqual([['M', 0, 0], ['L', 5, 5]]);
  });

  it('produit des échantillons serrés, du premier au dernier point, sans sortir de l’enveloppe', () => {
    const points: InkPoint[] = [
      { x: 0, y: 0, t: 0 }, { x: 20, y: 0, t: 20 }, { x: 20, y: 20, t: 40 }, { x: 40, y: 20, t: 60 },
    ];
    const samples = strokeSamples(points, defaultStroke, 2);
    expect(samples[0]).toMatchObject({ x: 0, y: 0 });
    expect(samples.at(-1)).toMatchObject({ x: 40, y: 20 });
    for (let i = 1; i < samples.length; i++) {
      expect(Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y)).toBeLessThanOrEqual(2.01);
    }
    // Le lissage arrondit l'angle : aucun échantillon n'atteint le coin (20, 0).
    expect(samples.some((s) => Math.hypot(s.x - 20, s.y) < 1)).toBe(false);
    expect(samples.every((s) => s.x >= -1e-9 && s.x <= 40 + 1e-9 && s.y >= -1e-9 && s.y <= 20 + 1e-9)).toBe(true);
  });

  it('transforme un simple appui en point', () => {
    expect(strokeSamples([{ x: 5, y: 6, t: 0 }])).toEqual([{ x: 5, y: 6, w: defaultStroke.maxWidth }]);
  });
});

describe('cadrage', () => {
  it('calcule la boîte englobante, épaisseur comprise', () => {
    expect(samplesBounds([])).toBeNull();
    const bounds = samplesBounds([[{ x: 10, y: 10, w: 4 }, { x: 30, y: 20, w: 2 }], [{ x: 5, y: 40, w: 2 }]]);
    expect(bounds).toEqual({ x: 4, y: 8, width: 27, height: 33 });
  });

  it('ramène les traits dans un cadre plus petit sans les déformer', () => {
    const strokes = [line(10, 50, 16)]; // de x = 10 à x = 460
    expect(fitStrokes(strokes, 600, 200)).toBe(strokes);
    const fitted = fitStrokes(strokes, 240, 200);
    const xs = fitted[0].map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(232 + 1e-9);
    expect(fitted[0][0].y).toBeCloseTo(100);
    expect(fitted[0][3].t).toBe(strokes[0][3].t);
  });
});

describe('pointe de flèche', () => {
  it('est proportionnée au trait et pointe dans le sens de la flèche', () => {
    const head = arrowHead(0, 0, 100, 0, 2);
    expect(head.tip).toEqual([100, 0]);
    expect(head.base[0]).toBeCloseTo(91);
    expect(head.left[1]).toBeCloseTo(-head.right[1]);
    expect(Math.abs(head.left[1])).toBeGreaterThan(2); // plus large que le trait
    const thick = arrowHead(0, 0, 100, 0, 6);
    expect(100 - thick.base[0]).toBeGreaterThan(100 - head.base[0]);
  });

  it('ne dépasse jamais la longueur de la flèche', () => {
    const head = arrowHead(0, 0, 0, 6, 8);
    expect(head.base[1]).toBeGreaterThan(0);
    expect(head.base[1]).toBeLessThan(6);
    expect(arrowHead(1, 1, 1, 1, 2).base).toEqual([1, 1]);
  });
});

describe('signature importée', () => {
  const rgba = (pixels: number[][]): Uint8ClampedArray => new Uint8ClampedArray(pixels.flat());

  it('rend le fond clair transparent et garde l’encre', () => {
    const pixels = rgba([[255, 255, 255, 255], [20, 30, 90, 255], [180, 180, 180, 255], [240, 238, 230, 255]]);
    whiteToAlpha(pixels);
    expect(pixels[3]).toBe(0); // blanc
    expect(pixels[7]).toBe(255); // encre
    expect(pixels[11]).toBeGreaterThan(0); // gris : bord adouci
    expect(pixels[11]).toBeLessThan(255);
    expect(pixels[15]).toBe(0); // papier légèrement teinté
    expect([...pixels.slice(4, 7)]).toEqual([20, 30, 90]);
  });

  it('trouve la zone encrée', () => {
    const width = 6;
    const height = 5;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of [[2, 1], [4, 3], [3, 2]]) pixels[(y * width + x) * 4 + 3] = 255;
    expect(alphaBounds(pixels, width, height)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
    expect(alphaBounds(new Uint8ClampedArray(width * height * 4), width, height)).toBeNull();
  });
});
