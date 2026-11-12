import { degrees, PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { toWinAnsi } from '@/core/pdf/pageFrame';
import { watermarkPdf, type WatermarkParams } from '@/core/pdf/watermark';
import { stampText, watermarkCentres } from '@/core/pdf/watermarkLayout';
import { fixture, pageCount } from './helpers';

interface Found { str: string; /** Centre du texte, origine en haut à gauche de la page affichée. */ cx: number; cy: number; /** Angle à l'écran, sens inverse des aiguilles d'une montre. */ angle: number }

/** Textes d'une page, positionnés tels qu'un lecteur les affiche (rotation de page comprise). */
async function textsOf(bytes: Uint8Array, pageNumber: number, prefix: string): Promise<{ found: Found[]; width: number; height: number }> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const found: Found[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.startsWith(prefix)) continue;
    const [a, b, , , x, y] = Util.transform(viewport.transform, item.transform) as number[];
    const angle = Math.atan2(-b, a);
    // De l'origine (début de la ligne de base) au centre : demi-largeur le long du texte, 0,35 corps au-dessus.
    const along = item.width / 2;
    const above = 0.35 * item.height;
    found.push({
      str: item.str,
      cx: x + along * Math.cos(angle) - above * Math.sin(angle),
      cy: y - along * Math.sin(angle) - above * Math.cos(angle),
      angle: (angle * 180) / Math.PI,
    });
  }
  await doc.loadingTask.destroy();
  return { found, width: viewport.width, height: viewport.height };
}

const text = (overrides: Partial<WatermarkParams> = {}): Omit<WatermarkParams, 'bytes'> => ({
  content: { kind: 'text', text: 'CONFIDENTIEL', font: 'sans', bold: true, size: 48, color: '#cc0000' },
  opacity: 0.3,
  position: 'mc',
  rotation: 0,
  tile: false,
  gap: 60,
  ...overrides,
});

describe('filigrane', () => {
  it('écrit un texte sélectionnable au centre de chaque page', async () => {
    const out = await watermarkPdf({ bytes: await fixture('sample-12p.pdf'), ...text() });
    expect(await pageCount(out)).toBe(12);
    for (const page of [1, 2]) {
      const { found, width, height } = await textsOf(out, page, 'CONFIDENTIEL');
      expect(found).toHaveLength(1);
      expect(found[0].cx).toBeCloseTo(width / 2, 0);
      expect(found[0].cy).toBeCloseTo(height / 2, 0);
    }
  });

  it('tourne autour du centre du filigrane', async () => {
    const out = await watermarkPdf({ bytes: await fixture('sample-3p.pdf'), ...text({ rotation: 45 }) });
    const { found, width, height } = await textsOf(out, 1, 'CONFIDENTIEL');
    expect(found[0].angle).toBeCloseTo(45, 1);
    expect(found[0].cx).toBeCloseTo(width / 2, 0);
    expect(found[0].cy).toBeCloseTo(height / 2, 0);
  });

  it('se place comme à l’écran sur une page pivotée', async () => {
    const out = await watermarkPdf({ bytes: await fixture('rotated.pdf'), ...text({ position: 'tl', rotation: 0 }) });
    // Page 2 : /Rotate 90, affichée en paysage (842 × 595).
    const { found, width, height } = await textsOf(out, 2, 'CONFIDENTIEL');
    expect([Math.round(width), Math.round(height)]).toEqual([842, 595]);
    expect(found).toHaveLength(1);
    expect(found[0].angle).toBeCloseTo(0, 1);
    // En haut à gauche : à une marge (4 % du petit côté) des deux bords.
    const margin = 0.04 * 595;
    expect(found[0].cy).toBeCloseTo(margin + 24, 0);
    expect(found[0].cx).toBeGreaterThan(margin + 100);
    expect(found[0].cx).toBeLessThan(width / 2);
    // Sur la page non pivotée, même placement.
    const first = await textsOf(out, 1, 'CONFIDENTIEL');
    expect(first.found[0].cy).toBeCloseTo(margin + 24, 0);
    expect(first.found[0].cx).toBeCloseTo(found[0].cx, 0);
  });

  it('suit une boîte de rognage décalée et pivotée', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(100, 150, 300, 400);
    page.setRotation(degrees(270));
    const out = await watermarkPdf({ bytes: await doc.save(), ...text({ content: { kind: 'text', text: 'CONF', font: 'mono', bold: false, size: 20, color: '#000000' }, rotation: -20 }) });
    const { found, width, height } = await textsOf(out, 1, 'CONF');
    expect([Math.round(width), Math.round(height)]).toEqual([400, 300]);
    expect(found[0].angle).toBeCloseTo(-20, 1);
    expect(found[0].cx).toBeCloseTo(200, 0);
    expect(found[0].cy).toBeCloseTo(150, 0);
  });

  it('respecte le choix des pages', async () => {
    const out = await watermarkPdf({ bytes: await fixture('sample-3p.pdf'), ...text({ pages: [1, 3] }) });
    expect((await textsOf(out, 1, 'CONFIDENTIEL')).found).toHaveLength(1);
    expect((await textsOf(out, 2, 'CONFIDENTIEL')).found).toHaveLength(0);
    expect((await textsOf(out, 3, 'CONFIDENTIEL')).found).toHaveLength(1);
  });

  it('répète le texte en mosaïque, sans sortir de la page', async () => {
    const out = await watermarkPdf({ bytes: await fixture('sample-3p.pdf'), ...text({ tile: true, rotation: 30, gap: 40 }) });
    // pdf.js ne rend que le texte visible : les copies coupées par le bord de la page reviennent tronquées.
    const { found, width, height } = await textsOf(out, 1, 'CONF');
    expect(found.length).toBeGreaterThan(8);
    expect(found.filter((f) => f.str === 'CONFIDENTIEL').length).toBeGreaterThan(4);
    for (const f of found) {
      expect(f.angle).toBeCloseTo(30, 1);
      expect(f.cx).toBeGreaterThan(0);
      expect(f.cx).toBeLessThan(width);
      expect(f.cy).toBeGreaterThan(0);
      expect(f.cy).toBeLessThan(height);
    }
    // Une seule police et un seul état graphique par page, quel que soit le nombre de copies.
    const page = (await PDFDocument.load(out)).getPage(0);
    const resources = page.node.Resources()!;
    expect(resources.lookup(PDFName.of('ExtGState'), PDFDict).keys()).toHaveLength(1);
    const state = resources.lookup(PDFName.of('ExtGState'), PDFDict).lookup(resources.lookup(PDFName.of('ExtGState'), PDFDict).keys()[0], PDFDict);
    expect(state.lookup(PDFName.of('ca'))?.toString()).toBe('0.3');
  });

  it('plafonne le nombre de copies d’une mosaïque très serrée', () => {
    const centres = watermarkCentres({ width: 595, height: 842 }, { width: 6, height: 6 }, { position: 'mc', rotation: 45, tile: true, gap: 0 });
    expect(centres.length).toBeGreaterThan(100);
    expect(centres.length).toBeLessThan(700);
  });

  it('pose une image, uniquement sur les pages choisies', async () => {
    const data = await fixture('photo.png');
    const out = await watermarkPdf({
      bytes: await fixture('rotated.pdf'),
      ...text({ content: { kind: 'image', data, mime: 'image/png', width: 0.4 }, pages: [2], position: 'br' }),
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    const xObjects = (index: number) => doc.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys() ?? [];
    expect(xObjects(0)).toHaveLength(0);
    expect(xObjects(1)).toHaveLength(1);
    const images = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(1);
  });

  it('accepte une image JPEG', async () => {
    const out = await watermarkPdf({
      bytes: await fixture('sample-3p.pdf'),
      ...text({ content: { kind: 'image', data: await fixture('photo.jpg'), mime: 'image/jpeg', width: 0.25 }, tile: true }),
    });
    expect(await pageCount(out)).toBe(3);
  });

  it('refuse un texte vide ou une sélection sans page', async () => {
    const bytes = await fixture('sample-3p.pdf');
    await expect(watermarkPdf({ bytes, ...text({ content: { kind: 'text', text: '   ', font: 'sans', bold: false, size: 40, color: '#000000' } }) })).rejects.toMatchObject({ code: 'empty' });
    await expect(watermarkPdf({ bytes, ...text({ pages: [9] }) })).rejects.toMatchObject({ code: 'empty' });
  });

  it('remplace les caractères hors du jeu latin, comme l’aperçu l’annonce', async () => {
    const samples = ['Été à Noël — « œuvre » 12 €', 'Ω 日本 😀 ok', 'ligne 1\nligne\t2', 'été !'];
    for (const sample of samples) expect(toWinAnsi(stampText(sample))).toBe(stampText(sample));
    expect(stampText('Ω 日本 😀 ok')).toBe('? ?? ? ok');
    expect(stampText('été')).toBe('été');
    const out = await watermarkPdf({ bytes: await fixture('sample-3p.pdf'), ...text({ content: { kind: 'text', text: 'Privé 😀', font: 'serif', bold: false, size: 30, color: '#000000' } }) });
    expect((await textsOf(out, 1, 'Privé ?')).found).toHaveLength(1);
  });
});
