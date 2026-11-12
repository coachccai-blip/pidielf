import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { adaptiveThreshold, clearFrame, packBilevel, stretchContrast, toGrey } from '@/core/image/filters';
import { applyHomography, defaultQuad, isValidQuad, quadOutputSize, rotateQuad90, solveHomography, type Quad, type RgbaImage } from '@/core/image/geometry';
import { readJpegInfo } from '@/core/image/jpeg';
import { fitWithin, planRender } from '@/core/image/size';
import { warpPerspective } from '@/core/image/warp';
import { processScan } from '@/core/pdf/scan';
import { fixture } from './helpers';

function blank(width: number, height: number, fill: [number, number, number] = [255, 255, 255]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...fill, 255], i);
  return { data, width, height };
}

const pixel = (img: RgbaImage, x: number, y: number): number[] => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];

/** Vrai si le point est dans le quadrilatère convexe (sens horaire, y vers le bas). */
function inside(quad: Quad, x: number, y: number): boolean {
  return quad.every((a, i) => {
    const b = quad[(i + 1) % 4];
    return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
  });
}

describe('homographie', () => {
  it('envoie quatre points sur leurs quatre images', () => {
    const from: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const to: Quad = [{ x: 12, y: 8 }, { x: 180, y: 22 }, { x: 160, y: 140 }, { x: 4, y: 120 }];
    const h = solveHomography(from, to)!;
    from.forEach((p, i) => {
      const q = applyHomography(h, p.x, p.y);
      expect(q.x).toBeCloseTo(to[i].x, 6);
      expect(q.y).toBeCloseTo(to[i].y, 6);
    });
  });

  it('retrouve une translation et une mise à l’échelle simples', () => {
    const h = solveHomography(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      [{ x: 10, y: 20 }, { x: 12, y: 20 }, { x: 12, y: 23 }, { x: 10, y: 23 }],
    )!;
    expect([...h].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 0, 10, 0, 3, 20, 0, 0, 1]);
  });

  it('refuse des points alignés', () => {
    const line: Quad = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(solveHomography(line, defaultQuad())).toBeNull();
  });
});

describe('quadrilatère', () => {
  it('reconnaît un quadrilatère convexe, croisé ou retourné', () => {
    const quad = defaultQuad();
    expect(isValidQuad(quad)).toBe(true);
    expect(isValidQuad([quad[0], quad[2], quad[1], quad[3]])).toBe(false); // croisé
    expect(isValidQuad([quad[1], quad[0], quad[3], quad[2]])).toBe(false); // retourné
    expect(isValidQuad([quad[0], quad[1], { x: 0.3, y: 0.1 }, quad[3]])).toBe(false); // concave
  });

  it('estime la taille de sortie d’après les côtés, avec un plafond', () => {
    const quad: Quad = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 380, y: 300 }, { x: 20, y: 300 }];
    expect(quadOutputSize(quad, 5000)).toEqual({ width: 400, height: 301 });
    expect(quadOutputSize(quad, 200)).toEqual({ width: 200, height: 150 });
  });

  it('suit une rotation de 90° : quatre rotations ramènent au départ', () => {
    const start: Quad = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.8 }];
    const once = rotateQuad90(start);
    expect(isValidQuad(once)).toBe(true);
    // Le coin haut-gauche de la photo se retrouve en haut à droite.
    expect(once[1].x).toBeCloseTo(0.8);
    expect(once[1].y).toBeCloseTo(0.1);
    const back = rotateQuad90(rotateQuad90(rotateQuad90(once)));
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(start[i].x);
      expect(p.y).toBeCloseTo(start[i].y);
    });
  });
});

describe('redressement de perspective', () => {
  it('conserve les pixels quand le quadrilatère est l’image entière', () => {
    const src = blank(9, 7);
    for (let i = 0; i < src.data.length; i++) src.data[i] = (i * 37) % 251;
    const full: Quad = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 7 }, { x: 0, y: 7 }];
    const out = warpPerspective(src, full, 9, 7);
    expect([...out.data]).toEqual([...src.data]);
  });

  it('ramène un quadrilatère connu à un rectangle', () => {
    // Une « feuille » rouge vue en perspective sur un fond bleu, avec un repère vert vers son coin haut-gauche.
    const quad: Quad = [{ x: 40, y: 30 }, { x: 170, y: 20 }, { x: 185, y: 130 }, { x: 20, y: 115 }];
    const toSheet = solveHomography(quad, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])!;
    const src = blank(200, 150, [0, 0, 255]);
    for (let y = 0; y < 150; y++) {
      for (let x = 0; x < 200; x++) {
        if (!inside(quad, x + 0.5, y + 0.5)) continue;
        const uv = applyHomography(toSheet, x + 0.5, y + 0.5);
        const mark = uv.x > 0.1 && uv.x < 0.3 && uv.y > 0.1 && uv.y < 0.3;
        src.data.set(mark ? [0, 255, 0, 255] : [255, 0, 0, 255], (y * 200 + x) * 4);
      }
    }
    const out = warpPerspective(src, quad, 100, 80);
    // Plus de fond bleu : toute l'image de sortie est la feuille (bords exclus, lissés par l'échantillonnage).
    for (let y = 2; y < 78; y++) for (let x = 2; x < 98; x++) expect(out.data[(y * 100 + x) * 4 + 2]).toBe(0);
    // Le repère vert occupe bien le rectangle 10 – 30 % de la sortie, et lui seul.
    expect(pixel(out, 20, 16)).toEqual([0, 255, 0]);
    expect(pixel(out, 13, 11)).toEqual([0, 255, 0]);
    expect(pixel(out, 27, 21)).toEqual([0, 255, 0]);
    expect(pixel(out, 5, 4)).toEqual([255, 0, 0]);
    expect(pixel(out, 35, 16)).toEqual([255, 0, 0]);
    expect(pixel(out, 80, 60)).toEqual([255, 0, 0]);
  });
});

describe('rendus du scanner', () => {
  /** Page éclairée de façon inégale (sombre à gauche, claire à droite) avec des traits d'encre. */
  function unevenPage(): { image: RgbaImage; isInk: (x: number, y: number) => boolean } {
    const width = 240;
    const height = 160;
    const image = blank(width, height);
    const isInk = (x: number, y: number) => y % 20 >= 8 && y % 20 < 11 && x % 12 < 8 && x > 10 && x < width - 10;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const paper = 90 + (140 * x) / width; // de 90 à 230
        const v = isInk(x, y) ? paper - 65 : paper;
        image.data.set([v, v, v, 255], (y * width + x) * 4);
      }
    }
    return { image, isInk };
  }

  it('le seuil adaptatif sépare l’encre du papier malgré un éclairage inégal', () => {
    const { image, isInk } = unevenPage();
    // Aucun seuil global ne conviendrait : l'encre de droite (≈ 160) est plus claire que le papier de gauche (≈ 95).
    adaptiveThreshold(image);
    let wrong = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const v = image.data[(y * image.width + x) * 4];
        expect(v === 0 || v === 255).toBe(true);
        if ((v === 0) !== isInk(x, y)) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  it('les niveaux de gris égalisent les trois canaux', () => {
    const image = blank(2, 1, [200, 100, 50]);
    toGrey(image);
    expect(pixel(image, 0, 0)).toEqual([124, 124, 124]);
  });

  it('l’étirement du contraste éclaircit le papier et fonce l’encre', () => {
    const image = blank(20, 20, [200, 200, 200]);
    for (let i = 0; i < 40; i++) image.data.set([60, 60, 60, 255], i * 4);
    stretchContrast(image);
    expect(pixel(image, 0, 0)).toEqual([0, 0, 0]);
    expect(pixel(image, 10, 10)).toEqual([255, 255, 255]);
  });

  it('une image déjà contrastée n’est pas modifiée', () => {
    const image = blank(4, 4, [255, 255, 255]);
    image.data.set([0, 0, 0, 255], 0);
    image.data.set([128, 128, 128, 255], 4);
    const before = [...image.data];
    stretchContrast(image);
    expect([...image.data]).toEqual(before);
  });

  it('blanchit un cadre sans toucher à l’intérieur', () => {
    const image = blank(8, 6, [0, 0, 0]);
    clearFrame(image, 2);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 8; x++) {
        const inner = x >= 2 && x < 6 && y >= 2 && y < 4;
        expect(pixel(image, x, y)).toEqual(inner ? [0, 0, 0] : [255, 255, 255]);
      }
    }
  });

  it('compacte le noir et blanc à un bit par pixel', () => {
    const image = blank(10, 2);
    image.data.set([0, 0, 0, 255], 0); // pixel (0, 0) noir
    image.data.set([0, 0, 0, 255], (10 + 9) * 4); // pixel (9, 1) noir
    expect([...packBilevel(image)]).toEqual([0b0111_1111, 0b1100_0000, 0b1111_1111, 0b1000_0000]);
  });
});

describe('traitement complet d’une page scannée', () => {
  const quad: Quad = [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 70 }, { x: 10, y: 70 }];

  it('redresse, applique le rendu et plafonne la taille', async () => {
    const src = blank(120, 80, [180, 60, 60]);
    const out = await processScan({ ...src, quad, mode: 'grey', maxSide: 50 });
    expect([out.width, out.height, out.bilevel]).toEqual([50, 30, false]);
    expect(out.data).toHaveLength(50 * 30 * 4);
    expect(out.data[0]).toBe(out.data[1]);
  });

  it('renvoie un bit par pixel en noir et blanc quand on le demande', async () => {
    const out = await processScan({ ...blank(120, 80), quad, mode: 'bw', maxSide: 100, pack: true });
    expect(out.bilevel).toBe(true);
    expect(out.data).toHaveLength(Math.ceil(100 / 8) * 60);
  });

  it('refuse des coins croisés', async () => {
    const crossed: Quad = [quad[0], quad[2], quad[1], quad[3]];
    await expect(processScan({ ...blank(120, 80), quad: crossed, mode: 'color', maxSide: 100 })).rejects.toMatchObject({ code: 'empty' });
  });
});

describe('dimensions de rendu', () => {
  const desktop = { maxArea: 32_000_000, maxSide: 16_000 };

  it('convertit des points en pixels à la résolution demandée', () => {
    expect(planRender(595.28, 841.89, 150, desktop)).toMatchObject({ width: 1240, height: 1753, dpi: 150, reduced: false });
    expect(planRender(595.28, 841.89, 72, desktop)).toMatchObject({ width: 595, height: 841, reduced: false });
  });

  it('abaisse la résolution d’une page immense', () => {
    const plan = planRender(2384, 3370, 300, { maxArea: 12_000_000, maxSide: 8192 }); // A0 sur téléphone
    expect(plan.reduced).toBe(true);
    expect(plan.width * plan.height).toBeLessThanOrEqual(12_000_000);
    expect(plan.dpi).toBeLessThan(300);
    expect(plan.width / plan.height).toBeCloseTo(2384 / 3370, 2);
  });

  it('respecte aussi le côté maximal', () => {
    const plan = planRender(200, 20_000, 150, { maxArea: 32_000_000, maxSide: 8192 });
    expect(plan.height).toBeLessThanOrEqual(8192);
    expect(plan.reduced).toBe(true);
  });

  it('réduit sans jamais agrandir', () => {
    expect(fitWithin(4000, 3000, { maxSide: 2000 })).toMatchObject({ width: 2000, height: 1500 });
    expect(fitWithin(400, 300, { maxSide: 2000, maxArea: 1_000_000 })).toMatchObject({ width: 400, height: 300, scale: 1 });
    expect(fitWithin(4000, 3000, { maxArea: 3_000_000 })).toMatchObject({ width: 2000, height: 1500 });
  });
});

describe('en-tête JPEG', () => {
  it('lit les dimensions d’un JPEG sans EXIF', async () => {
    expect(readJpegInfo(await fixture('photo.jpg'))).toEqual({ width: 320, height: 240, orientation: 1, components: 3 });
  });

  it('lit l’orientation EXIF', async () => {
    const turned = await sharp(Buffer.from(await fixture('photo.jpg'))).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(readJpegInfo(new Uint8Array(turned))).toMatchObject({ width: 320, height: 240, orientation: 6 });
  });

  it('écarte ce qui n’est pas un JPEG', async () => {
    expect(readJpegInfo(await fixture('photo.png'))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
