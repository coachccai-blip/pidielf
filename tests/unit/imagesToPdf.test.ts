import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imagesToPdf, layoutImage, MARGINS, type PdfImage } from '@/core/pdf/imagesToPdf';
import { scanPageSize, scanToPdf } from '@/core/pdf/scan';
import { fixture, isPdf, pageCount, pageSizes } from './helpers';

const jpg = async (): Promise<PdfImage> => ({ data: await fixture('photo.jpg'), mime: 'image/jpeg', width: 320, height: 240 });
const png = async (): Promise<PdfImage> => ({ data: await fixture('photo.png'), mime: 'image/png', width: 320, height: 240 });
const tall = async (): Promise<PdfImage> => ({ data: await fixture('scan.jpg'), mime: 'image/jpeg', width: 1240, height: 1754 });

/** Images (XObjects) de chaque page : filtre et dimensions. */
async function pageImages(bytes: Uint8Array): Promise<Array<Array<{ filter: string; width: number; height: number; bits: number; size: number }>>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject')) as { entries(): Array<[PDFName, unknown]> } | undefined;
    return (xobjects?.entries() ?? []).map(([, ref]) => {
      const stream = doc.context.lookup(ref as never) as PDFRawStream;
      const num = (key: string) => Number(String(stream.dict.get(PDFName.of(key))));
      return { filter: String(stream.dict.get(PDFName.of('Filter'))), width: num('Width'), height: num('Height'), bits: num('BitsPerComponent'), size: stream.contents.length };
    });
  });
}

describe('mise en page des images', () => {
  it('A4 : orientation automatique selon l’image', () => {
    const landscape = layoutImage(320, 240, { format: 'a4', orientation: 'auto', margin: 'none' });
    expect([landscape.pageWidth, landscape.pageHeight]).toEqual([841.89, 595.28]);
    const portrait = layoutImage(240, 320, { format: 'a4', orientation: 'auto', margin: 'none' });
    expect([portrait.pageWidth, portrait.pageHeight]).toEqual([595.28, 841.89]);
  });

  it('orientation imposée : l’image reste entière et centrée', () => {
    const l = layoutImage(320, 240, { format: 'a4', orientation: 'portrait', margin: 'none' });
    expect([l.pageWidth, l.pageHeight]).toEqual([595.28, 841.89]);
    expect(l.width).toBeCloseTo(595.28);
    expect(l.height).toBeCloseTo(446.46);
    expect(l.x).toBeCloseTo(0);
    expect(l.y).toBeCloseTo((841.89 - 446.46) / 2);
    const forced = layoutImage(240, 320, { format: 'letter', orientation: 'landscape', margin: 'none' });
    expect([forced.pageWidth, forced.pageHeight]).toEqual([792, 612]);
    expect(forced.height).toBeCloseTo(612);
    expect(forced.width / forced.height).toBeCloseTo(240 / 320);
  });

  it('les marges réduisent la zone utile sans rogner', () => {
    for (const margin of ['small', 'large'] as const) {
      const m = MARGINS[margin];
      const l = layoutImage(1240, 1754, { format: 'a4', orientation: 'auto', margin });
      expect(l.x).toBeGreaterThanOrEqual(m - 1e-6);
      expect(l.y).toBeGreaterThanOrEqual(m - 1e-6);
      expect(l.x + l.width).toBeLessThanOrEqual(l.pageWidth - m + 1e-6);
      expect(l.y + l.height).toBeLessThanOrEqual(l.pageHeight - m + 1e-6);
      expect(l.width / l.height).toBeCloseTo(1240 / 1754, 5);
      // L'image touche la marge sur au moins un axe.
      expect(Math.min(l.x - m, l.y - m)).toBeCloseTo(0, 4);
    }
  });

  it('format ajusté : la page épouse l’image, marges en plus', () => {
    const small = layoutImage(320, 240, { format: 'fit', orientation: 'landscape', margin: 'none' });
    expect(small).toMatchObject({ pageWidth: 240, pageHeight: 180, x: 0, y: 0, width: 240, height: 180 });
    const withMargin = layoutImage(320, 240, { format: 'fit', orientation: 'auto', margin: 'small' });
    expect(withMargin.pageWidth).toBeCloseTo(240 + 2 * MARGINS.small);
    expect(withMargin.x).toBeCloseTo(MARGINS.small);
    // Une grande photo est ramenée à la hauteur d'un A4.
    const photo = layoutImage(4000, 3000, { format: 'fit', orientation: 'auto', margin: 'none' });
    expect(photo.pageWidth).toBeCloseTo(841.89);
    expect(photo.pageHeight).toBeCloseTo(631.42, 1);
  });
});

describe('images en PDF', () => {
  it('produit une page par image, dans l’ordre', async () => {
    const out = await imagesToPdf({ images: [await png(), await jpg(), await tall()], page: { format: 'a4', orientation: 'auto', margin: 'small' } });
    expect(isPdf(out)).toBe(true);
    expect(await pageSizes(out)).toEqual([[842, 595], [842, 595], [595, 842]]);
    const images = await pageImages(out);
    expect(images.map((p) => p.length)).toEqual([1, 1, 1]);
    expect(images.map((p) => p[0].filter)).toEqual(['/FlateDecode', '/DCTDecode', '/DCTDecode']);
    expect(images[2][0]).toMatchObject({ width: 1240, height: 1754 });
  });

  it('reprend les JPEG tels quels, sans recompression', async () => {
    const image = await jpg();
    const out = await imagesToPdf({ images: [image], page: { format: 'fit', orientation: 'auto', margin: 'none' } });
    expect(await pageSizes(out)).toEqual([[240, 180]]);
    const doc = await PDFDocument.load(out);
    const streams = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream);
    expect(streams.some((s) => Buffer.from(s.contents).equals(Buffer.from(image.data)))).toBe(true);
  });

  it('respecte l’orientation et le format imposés', async () => {
    const out = await imagesToPdf({ images: [await jpg(), await tall()], page: { format: 'letter', orientation: 'portrait', margin: 'large' } });
    expect(await pageSizes(out)).toEqual([[612, 792], [612, 792]]);
  });

  it('conserve la transparence d’un PNG', async () => {
    const hasSoftMask = async (bytes: Uint8Array) =>
      (await PDFDocument.load(bytes)).context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFRawStream && o.dict.has(PDFName.of('SMask')));
    const page = { format: 'a4', orientation: 'auto', margin: 'none' } as const;

    const opaque = await imagesToPdf({ images: [await png()], page });
    expect((await pageImages(opaque))[0][0]).toMatchObject({ width: 320, height: 240, bits: 8 });
    expect(await hasSoftMask(opaque)).toBe(false);

    // Un disque opaque sur fond transparent : le PDF doit porter un masque de transparence.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><circle cx="32" cy="24" r="20" fill="#245C35"/></svg>';
    const data = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
    const transparent = await imagesToPdf({ images: [{ data, mime: 'image/png', width: 64, height: 48 }], page });
    expect(await hasSoftMask(transparent)).toBe(true);
  });

  it('signale une image illisible et une liste vide', async () => {
    const broken: PdfImage = { data: new Uint8Array([1, 2, 3, 4]), mime: 'image/jpeg', width: 10, height: 10 };
    await expect(imagesToPdf({ images: [broken], page: { format: 'a4', orientation: 'auto', margin: 'none' } })).rejects.toMatchObject({ code: 'damaged' });
    await expect(imagesToPdf({ images: [], page: { format: 'a4', orientation: 'auto', margin: 'none' } })).rejects.toMatchObject({ code: 'empty' });
  });
});

describe('scanner : assemblage du PDF', () => {
  it('donne à chaque page les proportions de l’image, petit côté d’un A4', () => {
    expect(scanPageSize(1240, 1754).map(Math.round)).toEqual([595, 842]);
    expect(scanPageSize(2000, 1000).map(Math.round)).toEqual([1191, 595]);
  });

  it('assemble des pages JPEG et des pages noir et blanc 1 bit', async () => {
    // Damier 16 × 8 en un bit par pixel : deux octets par ligne.
    const bits = new Uint8Array(16);
    for (let y = 0; y < 8; y++) bits.set(y % 2 ? [0xaa, 0xaa] : [0x55, 0x55], y * 2);
    const out = await scanToPdf({
      pages: [
        { kind: 'jpeg', data: await fixture('scan.jpg'), width: 1240, height: 1754 },
        { kind: 'bilevel', data: bits, width: 16, height: 8 },
      ],
    });
    expect(await pageCount(out)).toBe(2);
    expect(await pageSizes(out)).toEqual([[595, 842], [1191, 595]]);
    const images = await pageImages(out);
    expect(images[0][0]).toMatchObject({ filter: '/DCTDecode', width: 1240, height: 1754 });
    expect(images[1][0]).toMatchObject({ filter: '/FlateDecode', width: 16, height: 8, bits: 1 });
  });

  it('pdf.js relit les deux images du document', async () => {
    const out = await scanToPdf({
      pages: [
        { kind: 'jpeg', data: await fixture('photo.jpg'), width: 320, height: 240 },
        { kind: 'bilevel', data: new Uint8Array(2 * 8).fill(0xf0), width: 16, height: 8 },
      ],
    });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: out.slice(), verbosity: 0 }).promise;
    const paints: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const ops = await (await pdf.getPage(n)).getOperatorList();
      paints.push(ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject).length);
    }
    await pdf.loadingTask.destroy();
    expect(paints).toEqual([1, 1]);
  });

  it('refuse un document sans page', async () => {
    await expect(scanToPdf({ pages: [] })).rejects.toMatchObject({ code: 'empty' });
  });
});
