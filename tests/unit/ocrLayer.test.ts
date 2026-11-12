import { describe, expect, it } from 'vitest';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addTextLayer, type OcrWord } from '@/core/pdf/ocrLayer';
import { fixture, pageCount, pageSizes, rotations } from './helpers';

interface Found {
  text: string;
  /** Origine du mot dans l'image de la page (pixels, origine en haut à gauche). */
  x: number;
  y: number;
  width: number;
  /** Matrice du texte ramenée dans le repère de l'image : [a, b, c, d]. */
  matrix: number[];
}

/** Relit le texte d'une page avec pdf.js, positions converties en pixels d'une image de largeur donnée. */
async function readWords(bytes: Uint8Array, pageNumber: number, imageWidth: number): Promise<{ found: Found[]; modes: number[] }> {
  const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: imageWidth / page.getViewport({ scale: 1 }).width });
  const content = await page.getTextContent();
  const found: Found[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const m = Util.transform(viewport.transform, item.transform);
    found.push({ text: item.str.trim(), x: m[4], y: m[5], width: item.width * viewport.scale, matrix: m.slice(0, 4) });
  }
  const ops = await page.getOperatorList();
  const modes = ops.fnArray.flatMap((fn, i) => (fn === OPS.setTextRenderingMode ? [ops.argsArray[i][0] as number] : []));
  await pdf.loadingTask.destroy();
  return { found, modes };
}

// Mots tels qu'un moteur OCR les rendrait pour scan.pdf, image de 1240 × 1754 pixels. Les hauteurs
// diffèrent d'un mot à l'autre, comme dans un vrai scan : pdf.js rend alors un élément par mot.
const scanWords: OcrWord[] = [
  { text: 'Bibliothèque', x0: 120, y0: 172, x1: 531, y1: 232 },
  { text: 'des', x0: 553, y0: 172, x1: 663, y1: 220 },
  { text: 'elfes', x0: 686, y0: 169, x1: 836, y1: 220 },
  { text: 'The', x0: 120, y0: 392, x1: 193, y1: 422 },
  { text: 'quick', x0: 208, y0: 390, x1: 312, y1: 430, baseline: 422 },
  { text: 'brown', x0: 327, y0: 390, x1: 449, y1: 422 },
  { text: 'fox', x0: 463, y0: 388, x1: 523, y1: 422 },
];

describe('couche de texte OCR', () => {
  it('rend les mots cherchables, dans l’ordre et à leur place', async () => {
    const original = await fixture('scan.pdf');
    const out = await addTextLayer({ bytes: original, pages: [{ page: 1, width: 1240, height: 1754, words: scanWords }] });

    const { found, modes } = await readWords(out, 1, 1240);
    expect(found.map((f) => f.text)).toEqual(scanWords.map((w) => w.text));
    expect(found.map((f) => f.text).join(' ')).toBe('Bibliothèque des elfes The quick brown fox');
    found.forEach((f, i) => {
      const word = scanWords[i];
      expect(Math.abs(f.x - word.x0), `${word.text} : gauche`).toBeLessThan(2);
      // La ligne de base tombe dans le bas de la boîte (au-dessus des jambages).
      expect(f.y, `${word.text} : ligne de base`).toBeGreaterThan(word.y0 + (word.y1 - word.y0) / 2);
      expect(f.y, `${word.text} : ligne de base`).toBeLessThanOrEqual(word.y1 + 1);
      // Le mot couvre sa boîte ; seule l'espace finale dépasse.
      expect(f.width, `${word.text} : largeur`).toBeGreaterThan(word.x1 - word.x0 - 2);
      expect(f.width, `${word.text} : largeur`).toBeLessThan((word.x1 - word.x0) * 1.4);
    });
    // « quick » porte sa ligne de base : elle est respectée telle quelle.
    expect(found[4].y).toBeCloseTo(422, 0);
    // Texte invisible uniquement.
    expect(new Set(modes)).toEqual(new Set([3]));

    // La page d'origine n'est ni redessinée ni recompressée.
    expect(await pageCount(out)).toBe(1);
    expect(await pageSizes(out)).toEqual(await pageSizes(original));
    expect(Math.abs(out.length - original.length)).toBeLessThan(original.length * 0.05);
  });

  it('suit la rotation de la page', async () => {
    const original = await fixture('rotated.pdf');
    // La page 2 (/Rotate 90) s'affiche en paysage : image de 1684 × 1190 pixels.
    const words: OcrWord[] = [
      { text: 'Page', x0: 200, y0: 300, x1: 330, y1: 350 },
      { text: 'tournée', x0: 350, y0: 300, x1: 560, y1: 340 },
      { text: 'en bas', x0: 1300, y0: 1100, x1: 1500, y1: 1140 },
    ];
    const out = await addTextLayer({
      bytes: original,
      pages: [
        { page: 1, width: 1190, height: 1684, words: [{ text: 'Droite', x0: 100, y0: 100, x1: 300, y1: 150 }] },
        { page: 2, width: 1684, height: 1190, words },
      ],
    });
    expect(await rotations(out)).toEqual([0, 90]);
    expect(await pageSizes(out)).toEqual(await pageSizes(original));

    const before = (await readWords(original, 2, 1684)).found.map((f) => f.text);
    const added = (await readWords(out, 2, 1684)).found.filter((f) => !before.includes(f.text));
    expect(added.map((f) => f.text)).toEqual(words.map((w) => w.text));
    added.forEach((f, i) => {
      expect(Math.abs(f.x - words[i].x0), `${f.text} : gauche`).toBeLessThan(2);
      expect(Math.abs(f.y - words[i].y1), `${f.text} : ligne de base`).toBeLessThan((words[i].y1 - words[i].y0) / 2);
      // Sur la page affichée, le texte se lit à l'horizontale, de gauche à droite.
      const [a, b, c, d] = f.matrix;
      expect(a).toBeGreaterThan(0);
      expect(d).toBeLessThan(0);
      expect(Math.abs(b) + Math.abs(c)).toBeLessThan(1e-6);
    });
    expect((await readWords(out, 1, 1190)).found.map((f) => f.text)).toContain('Droite');
  });

  it('écrit ce que la police sait écrire et omet le reste', async () => {
    const words: OcrWord[] = [
      { text: 'ﬁn', x0: 100, y0: 100, x1: 160, y1: 140 },
      { text: '日本語', x0: 200, y0: 100, x1: 320, y1: 140 },
      { text: 'd’œuvre', x0: 340, y0: 100, x1: 520, y1: 140 },
      { text: '   ', x0: 540, y0: 100, x1: 600, y1: 140 },
      { text: 'vide', x0: 620, y0: 100, x1: 620, y1: 140 },
    ];
    const out = await addTextLayer({ bytes: await fixture('scan.pdf'), pages: [{ page: 1, width: 1240, height: 1754, words }, { page: 9, width: 10, height: 10, words }] });
    expect((await readWords(out, 1, 1240)).found.map((f) => f.text)).toEqual(['fin', 'd’œuvre']);
  });

  it('rend le document intact quand rien n’a été reconnu', async () => {
    const out = await addTextLayer({ bytes: await fixture('sample-3p.pdf'), pages: [{ page: 2, width: 1240, height: 1754, words: [] }] });
    expect(await pageCount(out)).toBe(3);
    expect((await readWords(out, 2, 1240)).modes).not.toContain(3);
  });

  it('refuse un PDF protégé', async () => {
    await expect(addTextLayer({ bytes: await fixture('protected.pdf'), pages: [] })).rejects.toMatchObject({ code: 'encrypted' });
  });
});
