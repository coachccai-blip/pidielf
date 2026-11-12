import { describe, expect, it } from 'vitest';
import { ToolError } from '@/core/errors';
import { mergePdfs } from '@/core/pdf/merge';
import { organizePdf } from '@/core/pdf/organize';
import { rotatePdf } from '@/core/pdf/rotate';
import { splitPdf } from '@/core/pdf/split';
import { fixture, isPdf, pageCount, pageSizes, rotations } from './helpers';

describe('fusionner', () => {
  it('réunit plusieurs PDF dans l’ordre', async () => {
    const out = await mergePdfs({ files: [{ bytes: await fixture('sample-3p.pdf') }, { bytes: await fixture('sample-12p.pdf') }] });
    expect(isPdf(out)).toBe(true);
    expect(await pageCount(out)).toBe(15);
  });

  it('ne garde que les pages demandées', async () => {
    const out = await mergePdfs({
      files: [
        { bytes: await fixture('sample-3p.pdf'), pages: [3, 1] },
        { bytes: await fixture('sample-12p.pdf'), pages: [2] },
      ],
    });
    expect(await pageSizes(out)).toEqual([[595, 842], [595, 842], [842, 595]]);
  });

  it('refuse un PDF protégé avec une erreur claire', async () => {
    await expect(mergePdfs({ files: [{ bytes: await fixture('protected.pdf') }] })).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('signale un fichier abîmé', async () => {
    const broken = new TextEncoder().encode('ceci n’est pas un PDF');
    await expect(mergePdfs({ files: [{ bytes: broken }] })).rejects.toBeInstanceOf(ToolError);
  });
});

describe('diviser', () => {
  it('découpe par plages', async () => {
    const parts = await splitPdf({ bytes: await fixture('sample-12p.pdf'), ranges: [{ from: 1, to: 5 }, { from: 6, to: 12 }] });
    expect(await Promise.all(parts.map(pageCount))).toEqual([5, 7]);
  });

  it('produit une page par fichier', async () => {
    const ranges = [1, 2, 3].map((p) => ({ from: p, to: p }));
    const parts = await splitPdf({ bytes: await fixture('sample-3p.pdf'), ranges });
    expect(parts).toHaveLength(3);
    expect(await Promise.all(parts.map(pageCount))).toEqual([1, 1, 1]);
  });
});

describe('pivoter', () => {
  it('pivote toutes les pages', async () => {
    const out = await rotatePdf({ bytes: await fixture('sample-3p.pdf'), angle: 90 });
    expect(await rotations(out)).toEqual([90, 90, 90]);
  });

  it('cumule avec la rotation existante et vise une sélection', async () => {
    const out = await rotatePdf({ bytes: await fixture('rotated.pdf'), angle: 270, pages: [2] });
    expect(await rotations(out)).toEqual([0, 0]);
  });
});

describe('organiser les pages', () => {
  it('réordonne, duplique, pivote et insère une page blanche', async () => {
    const out = await organizePdf({
      sources: [await fixture('sample-3p.pdf'), await fixture('sample-12p.pdf')],
      plan: [
        { kind: 'page', source: 0, page: 3 },
        { kind: 'page', source: 0, page: 3, rotate: 180 },
        { kind: 'blank', width: 300, height: 400 },
        { kind: 'page', source: 1, page: 2 },
      ],
    });
    expect(await pageSizes(out)).toEqual([[595, 842], [595, 842], [300, 400], [842, 595]]);
    expect(await rotations(out)).toEqual([0, 180, 0, 0]);
  });

  it('refuse un plan vide', async () => {
    await expect(organizePdf({ sources: [], plan: [] })).rejects.toMatchObject({ code: 'empty' });
  });
});
