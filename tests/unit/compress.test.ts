import { PDFDocument, PDFName, PDFRawStream, type PDFDict } from '@cantoo/pdf-lib';
import { zlibSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { compressPdf, COMPRESS_LEVELS, type CompressLevel } from '@/core/pdf/compress';
import { fitSide, readJpeg, type ImageCodec, type ImageSource } from '@/core/pdf/compressImages';
import { fixture, pageCount } from './helpers';

/** Vrai codec (sharp), pour mesurer des gains réels sous Node ; dans le navigateur, c'est OffscreenCanvas. */
const sharpCodec: ImageCodec = {
  async recompress(source, target) {
    const input = source.kind === 'jpeg' ? sharp(source.bytes) : sharp(source.data, { raw: { width: source.width, height: source.height, channels: source.channels } });
    const { width, height } = fitSide(source.width, source.height, target.maxSide);
    const bytes = await input.resize(width, height, { fit: 'fill' }).toColourspace('srgb').jpeg({ quality: Math.round(target.quality * 100) }).toBuffer();
    return { bytes: new Uint8Array(bytes), width, height };
  },
};

/** Codec espion : note ce qu'on lui demande et renvoie des octets de la taille voulue. */
function spyCodec(size: number): ImageCodec & { calls: ImageSource[] } {
  const calls: ImageSource[] = [];
  return {
    calls,
    async recompress(source, target) {
      calls.push(source);
      return { bytes: new Uint8Array(size).fill(7), ...fitSide(source.width, source.height, target.maxSide) };
    },
  };
}

const imagesOf = async (bytes: Uint8Array): Promise<Array<{ dict: PDFDict; contents: Uint8Array }>> =>
  (await PDFDocument.load(bytes)).context
    .enumerateIndirectObjects()
    .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image') ? [{ dict: o.dict, contents: o.contents }] : []));

const entry = (dict: PDFDict, key: string): string | undefined => dict.lookup(PDFName.of(key))?.toString();

async function textOf(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  await doc.loadingTask.destroy();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

/** Bruit reproductible : des pixels qui se compressent mal, comme une photo. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let seed = 7;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (seed >> 16) & 0xff; // les bits de poids fort : les bits faibles se répètent
  }
  return out;
}

/** PDF d'une page portant une image dont on fournit le dictionnaire et le flux. */
async function pdfWithImage(dict: Record<string, unknown>, contents: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const ref = doc.context.register(doc.context.stream(contents, { Type: 'XObject', Subtype: 'Image', ...dict } as never));
  page.node.newXObject('Im', ref);
  return doc.save({ useObjectStreams: false });
}

describe('compresser : images', () => {
  it('allège réellement une photo, de plus en plus selon le niveau', async () => {
    const original = await fixture('heavy-image.pdf');
    const sizes: number[] = [];
    for (const level of ['light', 'balanced', 'strong'] as CompressLevel[]) {
      const result = await compressPdf({ bytes: original, level }, undefined, sharpCodec);
      expect(result).toMatchObject({ changed: true, images: 1, recompressed: 1, codec: true });
      expect(await pageCount(result.bytes)).toBe(1);
      const [image] = await imagesOf(result.bytes);
      expect(entry(image.dict, 'Filter')).toBe('/DCTDecode');
      // Le dictionnaire décrit bien le JPEG produit, réduit à la taille du niveau.
      const jpeg = readJpeg(image.contents)!;
      expect([entry(image.dict, 'Width'), entry(image.dict, 'Height')]).toEqual([String(jpeg.width), String(jpeg.height)]);
      expect(Math.max(jpeg.width, jpeg.height)).toBe(Math.min(1600, COMPRESS_LEVELS[level].maxSide));
      expect(jpeg.components).toBe(3);
      sizes.push(result.bytes.length);
    }
    expect(sizes[0]).toBeLessThan(original.length * 0.8);
    expect(sizes[1]).toBeLessThan(sizes[0]);
    expect(sizes[2]).toBeLessThan(sizes[1]);
  });

  it('ne remplace jamais une image par une version plus lourde', async () => {
    const original = await fixture('heavy-image.pdf');
    const [before] = await imagesOf(original);
    const codec = spyCodec(before.contents.length + 10);
    const result = await compressPdf({ bytes: original, level: 'balanced' }, undefined, codec);
    expect(codec.calls).toHaveLength(1);
    expect(result.recompressed).toBe(0);
    expect(result.bytes.length).toBeLessThanOrEqual(original.length);
    const [after] = await imagesOf(result.bytes);
    expect(after.contents).toEqual(before.contents);
  });

  it('laisse les images intactes sans codec, et le signale', async () => {
    const original = await fixture('scan.pdf');
    const result = await compressPdf({ bytes: original, level: 'strong' }, undefined, null);
    expect(result).toMatchObject({ images: 1, recompressed: 0, codec: false });
    expect((await imagesOf(result.bytes))[0].contents).toEqual((await imagesOf(original))[0].contents);
  });

  it('transmet un JPEG sans ses blocs EXIF', async () => {
    const jpeg = new Uint8Array(await sharp(Buffer.from(noise(120 * 90 * 3)), { raw: { width: 120, height: 90, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer());
    const codec = spyCodec(100);
    await compressPdf({ bytes: await pdfWithImage({ Width: 120, Height: 90, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }, jpeg), level: 'balanced' }, undefined, codec);
    expect(codec.calls).toHaveLength(1);
    const sent = codec.calls[0];
    expect(sent.kind).toBe('jpeg');
    if (sent.kind !== 'jpeg') return;
    expect(sent.bytes.length).toBeLessThan(jpeg.length);
    expect((await sharp(sent.bytes).metadata()).orientation).toBeUndefined();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);
    expect(await sharp(sent.bytes).raw().toBuffer()).toEqual(await sharp(jpeg).raw().toBuffer());
  });

  it('décode les images Flate, prédicteur PNG compris', async () => {
    const [width, height] = [64, 48];
    const pixels = noise(width * height * 3);
    // Encodage PNG ligne par ligne, avec les cinq filtres à tour de rôle.
    const rowBytes = width * 3;
    const predicted = new Uint8Array((rowBytes + 1) * height);
    for (let row = 0; row < height; row++) {
      const type = row % 5;
      predicted[row * (rowBytes + 1)] = type;
      for (let i = 0; i < rowBytes; i++) {
        const at = (r: number, k: number) => (r >= 0 && k >= 0 ? pixels[r * rowBytes + k] : 0);
        const [a, b, c] = [at(row, i - 3), at(row - 1, i), row > 0 ? at(row - 1, i - 3) : 0];
        const p = a + b - c;
        const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        const guess = [0, a, b, (a + b) >> 1, paeth][type];
        predicted[row * (rowBytes + 1) + 1 + i] = (pixels[row * rowBytes + i] - guess) & 0xff;
      }
    }
    const dict = { Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'FlateDecode' };
    for (const [extra, data] of [
      [{}, pixels],
      [{ DecodeParms: { Predictor: 15, Colors: 3, Columns: width } }, predicted],
    ] as Array<[Record<string, unknown>, Uint8Array]>) {
      const codec = spyCodec(200);
      const result = await compressPdf({ bytes: await pdfWithImage({ ...dict, ...extra }, zlibSync(data)), level: 'light' }, undefined, codec);
      expect(codec.calls).toEqual([{ kind: 'pixels', data: pixels, width, height, channels: 3 }]);
      const [image] = await imagesOf(result.bytes);
      expect(entry(image.dict, 'Filter')).toBe('/DCTDecode');
      expect(image.dict.has(PDFName.of('DecodeParms'))).toBe(false);
      expect(image.contents).toHaveLength(200);
    }
  });

  it('passe en RVB une image en niveaux de gris recompressée', async () => {
    const pixels = noise(100 * 80);
    const result = await compressPdf(
      { bytes: await pdfWithImage({ Width: 100, Height: 80, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' }, zlibSync(pixels)), level: 'balanced' },
      undefined,
      sharpCodec,
    );
    const [image] = await imagesOf(result.bytes);
    expect(entry(image.dict, 'ColorSpace')).toBe('/DeviceRGB');
    expect(readJpeg(image.contents)).toMatchObject({ width: 100, height: 80, components: 3 });
  });

  it('ne touche pas aux images qu’un JPEG ne saurait pas reproduire', async () => {
    const jpeg = new Uint8Array(await sharp(Buffer.from(noise(120 * 90 * 3)), { raw: { width: 120, height: 90, channels: 3 } }).jpeg({ quality: 95 }).toBuffer());
    const base = { Width: 120, Height: 90, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' };
    const flate = zlibSync(noise(120 * 90 * 3));
    const cases: Array<[Record<string, unknown>, Uint8Array]> = [
      [{ ...base, ColorSpace: 'DeviceCMYK' }, jpeg],
      [{ ...base, ColorSpace: ['Indexed', 'DeviceRGB', 1, '<000000ffffff>'], Filter: 'FlateDecode' }, flate],
      [{ ...base, ColorSpace: ['Separation', 'Or', 'DeviceRGB', {}], Filter: 'FlateDecode' }, flate],
      [{ ...base, Mask: [0, 0, 0, 0, 0, 0] }, jpeg],
      [{ ...base, Decode: [1, 0, 1, 0, 1, 0] }, jpeg],
      [{ ...base, ImageMask: true, BitsPerComponent: 1 }, flate],
      [{ ...base, BitsPerComponent: 16, Filter: 'FlateDecode' }, flate],
      [{ ...base, Filter: 'JPXDecode' }, jpeg],
      [{ ...base, Filter: ['ASCII85Decode', 'DCTDecode'] }, jpeg],
      [{ ...base, Filter: 'FlateDecode', DecodeParms: { Predictor: 2, Colors: 3, Columns: 120 } }, flate],
      // Dimensions annoncées différentes de celles du JPEG : fichier douteux.
      [{ ...base, Width: 90, Height: 120 }, jpeg],
    ];
    for (const [dict, contents] of cases) {
      const codec = spyCodec(10);
      const bytes = await pdfWithImage(dict, contents);
      const result = await compressPdf({ bytes, level: 'strong' }, undefined, codec);
      expect(codec.calls, JSON.stringify(dict)).toHaveLength(0);
      expect(result).toMatchObject({ images: 1, recompressed: 0 });
      expect((await imagesOf(result.bytes))[0].contents).toEqual(contents);
    }
  });

  it('recompresse une image transparente sans toucher à son masque', async () => {
    const [width, height] = [160, 120];
    const rgba = noise(width * height * 4);
    const png = new Uint8Array(await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer());
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]).drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 400, height: 300 });
    const original = await doc.save();
    const mask = (list: Awaited<ReturnType<typeof imagesOf>>) => list.find((i) => !i.dict.has(PDFName.of('SMask')))!;
    const holder = (list: Awaited<ReturnType<typeof imagesOf>>) => list.find((i) => i.dict.has(PDFName.of('SMask')))!;
    const before = await imagesOf(original);
    expect(before).toHaveLength(2);

    const result = await compressPdf({ bytes: original, level: 'strong' }, undefined, sharpCodec);
    const after = await imagesOf(result.bytes);
    expect(result).toMatchObject({ images: 1, recompressed: 1 });
    expect(entry(holder(after).dict, 'Filter')).toBe('/DCTDecode');
    expect(holder(after).contents.length).toBeLessThan(holder(before).contents.length);
    expect(entry(mask(after).dict, 'Filter')).toBe('/FlateDecode');
    expect(mask(after).contents).toEqual(mask(before).contents);
  });
});

describe('compresser : structure', () => {
  it('garde le texte sélectionnable et le nombre de pages', async () => {
    const original = await fixture('sample-3p.pdf');
    const result = await compressPdf({ bytes: original, level: 'strong' }, undefined, spyCodec(1));
    expect(result).toMatchObject({ images: 0, recompressed: 0 });
    expect(result.bytes.length).toBeLessThanOrEqual(original.length);
    expect(await pageCount(result.bytes)).toBe(3);
    for (const page of [1, 2, 3]) expect(await textOf(result.bytes, page)).toContain(`lune${page}`);
  });

  it('rend le fichier d’origine, intact, quand il n’y a plus rien à gagner', async () => {
    const first = await compressPdf({ bytes: await fixture('sample-12p.pdf'), level: 'balanced' }, undefined, null);
    const again = await compressPdf({ bytes: first.bytes, level: 'balanced' }, undefined, null);
    expect(again.changed).toBe(false);
    expect(again.bytes).toBe(first.bytes);
  });

  it('compacte les flux non compressés et retire les objets orphelins', async () => {
    const doc = await PDFDocument.load(await fixture('sample-3p.pdf'));
    const plain = new TextEncoder().encode('% commentaire répété dans un flux de contenu\n'.repeat(400));
    doc.getPage(0).node.addContentStream(doc.context.register(doc.context.stream(plain)));
    const orphan = doc.context.register(doc.context.stream(noise(20_000)));
    const original = await doc.save({ useObjectStreams: false });
    expect(original.length).toBeGreaterThan(40_000);

    const result = await compressPdf({ bytes: original, level: 'light' }, undefined, null);
    expect(result.changed).toBe(true);
    expect(result.bytes.length).toBeLessThan(8_000);
    const after = await PDFDocument.load(result.bytes);
    expect(after.context.lookup(orphan)).toBeUndefined();
    expect(await textOf(result.bytes, 1)).toContain('lune1');
    expect(await pageCount(result.bytes)).toBe(3);
  });

  it('refuse un PDF protégé avec une erreur claire', async () => {
    await expect(compressPdf({ bytes: await fixture('protected.pdf'), level: 'balanced' }, undefined, null)).rejects.toMatchObject({ code: 'encrypted' });
  });
});
