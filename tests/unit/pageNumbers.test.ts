import { degrees, PDFDocument } from '@cantoo/pdf-lib';
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { numberPages, type NumberPagesParams } from '@/core/pdf/pageNumbers';
import { formatPageNumber, numberingPlan, sideForPage } from '@/core/pdf/pageNumbersLayout';
import { fixture, pageCount } from './helpers';

interface Found { str: string; /** Bords du texte et ligne de base, origine en haut à gauche de la page affichée. */ left: number; right: number; baseline: number }

/** Textes ajoutés à une page (ceux qui ne figurent pas dans les fixtures), placés tels qu'un lecteur les affiche. */
async function numbersOf(bytes: Uint8Array, pageNumber: number): Promise<{ found: Found[]; width: number; height: number }> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const found: Found[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !/^(Page |Feuille )?\d+( \/ \d+)?$/.test(item.str)) continue;
    const [, , , , x, y] = Util.transform(viewport.transform, item.transform) as number[];
    found.push({ str: item.str, left: x, right: x + item.width, baseline: y });
  }
  await doc.loadingTask.destroy();
  return { found, width: viewport.width, height: viewport.height };
}

const options = (overrides: Partial<NumberPagesParams> = {}): Omit<NumberPagesParams, 'bytes'> => ({
  edge: 'bottom',
  side: 'center',
  margin: 36,
  font: 'sans',
  size: 12,
  color: '#000000',
  start: 1,
  format: 'n',
  ...overrides,
});

const labels = async (bytes: Uint8Array): Promise<Array<string | null>> => {
  const out: Array<string | null> = [];
  for (let p = 1; p <= (await pageCount(bytes)); p++) out.push((await numbersOf(bytes, p)).found[0]?.str ?? null);
  return out;
};

describe('numéros de page : formats', () => {
  it('écrit « 3 », « 3 / 12 » et « Page 3 »', () => {
    expect(formatPageNumber('n', 3, 12)).toBe('3');
    expect(formatPageNumber('n-total', 3, 12)).toBe('3 / 12');
    expect(formatPageNumber('prefix-n', 3, 12, 'Page')).toBe('Page 3');
    expect(formatPageNumber('prefix-n', 3, 12, ' Feuille ')).toBe('Feuille 3');
    expect(formatPageNumber('prefix-n', 3, 12, '')).toBe('3');
  });

  it('part du numéro de départ et adapte le total', () => {
    const plan = numberingPlan(4, { start: 5, format: 'n-total', side: 'center' });
    expect(plan.map((l) => l?.text)).toEqual(['5 / 8', '6 / 8', '7 / 8', '8 / 8']);
  });

  it('ne numérote pas les pages exclues : la première page numérotée porte le numéro de départ', () => {
    const plan = numberingPlan(5, { start: 1, format: 'n-total', side: 'center', exclude: [1, 4] });
    expect(plan.map((l) => l?.text ?? null)).toEqual([null, '1 / 3', '2 / 3', null, '3 / 3']);
  });

  it('peut compter les pages exclues dans la suite', () => {
    const plan = numberingPlan(5, { start: 1, format: 'n-total', side: 'center', exclude: [1, 4], countExcluded: true });
    expect(plan.map((l) => l?.text ?? null)).toEqual([null, '2 / 5', '3 / 5', null, '5 / 5']);
  });

  it('alterne le côté avec les marges miroir', () => {
    expect([1, 2, 3, 4].map((p) => sideForPage('right', true, p))).toEqual(['right', 'left', 'right', 'left']);
    expect([1, 2, 3].map((p) => sideForPage('left', true, p))).toEqual(['left', 'right', 'left']);
    expect([1, 2].map((p) => sideForPage('center', true, p))).toEqual(['center', 'center']);
    expect([1, 2].map((p) => sideForPage('right', false, p))).toEqual(['right', 'right']);
    // La parité suit la feuille, pas le numéro affiché ni les exclusions.
    const plan = numberingPlan(4, { start: 10, format: 'n', side: 'right', mirror: true, exclude: [1] });
    expect(plan.map((l) => l?.side ?? null)).toEqual([null, 'left', 'right', 'left']);
  });
});

describe('numéros de page : écriture dans le PDF', () => {
  it('numérote chaque page, en bas au centre', async () => {
    const out = await numberPages({ bytes: await fixture('sample-12p.pdf'), ...options({ format: 'n-total' }) });
    expect(await pageCount(out)).toBe(12);
    expect(await labels(out)).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1} / 12`));
    // Pages portrait et paysage : toujours centré, à 36 points du bas.
    for (const p of [1, 2]) {
      const { found, width, height } = await numbersOf(out, p);
      expect((found[0].left + found[0].right) / 2).toBeCloseTo(width / 2, 0);
      expect(found[0].baseline).toBeCloseTo(height - 36, 0);
    }
  });

  it('applique format, numéro de départ et exclusions', async () => {
    const out = await numberPages({ bytes: await fixture('sample-3p.pdf'), ...options({ format: 'prefix-n', prefix: 'Feuille', start: 7, exclude: [1] }) });
    expect(await labels(out)).toEqual([null, 'Feuille 7', 'Feuille 8']);
  });

  it('place le numéro du côté extérieur avec les marges miroir', async () => {
    const out = await numberPages({ bytes: await fixture('sample-3p.pdf'), ...options({ side: 'right', mirror: true, edge: 'top', margin: 40, size: 10 }) });
    const [p1, p2, p3] = [await numbersOf(out, 1), await numbersOf(out, 2), await numbersOf(out, 3)];
    expect(p1.found[0].right).toBeCloseTo(p1.width - 40, 0);
    expect(p2.found[0].left).toBeCloseTo(40, 0);
    expect(p3.found[0].right).toBeCloseTo(p3.width - 40, 0);
    // En haut : le sommet des chiffres (0,72 corps au-dessus de la ligne de base) touche la marge.
    expect(p1.found[0].baseline).toBeCloseTo(40 + 7.2, 0);
  });

  it('vise le bon coin d’une page pivotée', async () => {
    const out = await numberPages({ bytes: await fixture('rotated.pdf'), ...options({ side: 'right', margin: 30, format: 'prefix-n', prefix: 'Page' }) });
    // Page 2 : /Rotate 90, affichée en paysage.
    const { found, width, height } = await numbersOf(out, 2);
    expect([Math.round(width), Math.round(height)]).toEqual([842, 595]);
    expect(found).toHaveLength(1);
    expect(found[0].str).toBe('Page 2');
    expect(found[0].right).toBeCloseTo(842 - 30, 0);
    expect(found[0].baseline).toBeCloseTo(595 - 30, 0);
  });

  it('suit une boîte de rognage décalée', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(100, 150, 300, 400);
    page.setRotation(degrees(180));
    const out = await numberPages({ bytes: await doc.save(), ...options({ side: 'left', edge: 'top', margin: 20, size: 10 }) });
    const { found } = await numbersOf(out, 1);
    expect(found[0].left).toBeCloseTo(20, 0);
    expect(found[0].baseline).toBeCloseTo(20 + 7.2, 0);
  });

  it('refuse de tout exclure', async () => {
    await expect(numberPages({ bytes: await fixture('sample-3p.pdf'), ...options({ exclude: [1, 2, 3] }) })).rejects.toMatchObject({ code: 'empty' });
  });
});
