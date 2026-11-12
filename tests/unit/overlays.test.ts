import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { applyOverlays, layoutText } from '@/core/pdf/overlays';
import type { Overlay } from '@/core/pdf/overlayTypes';
import { fixture, isPdf, pageCount } from './helpers';

interface Found { str: string; x: number; y: number; width: number }

/** Texte d'une page avec sa position dans la page affichée (points, origine en haut à gauche). */
async function readPage(bytes: Uint8Array, pageNumber: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: Found[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    items.push({ str: item.str, x, y, width: item.width });
  }
  const annotations = await page.getAnnotations();
  const result = { items, annotations, width: viewport.width, height: viewport.height, viewport };
  await doc.loadingTask.destroy();
  return result;
}

const text = (extra: Partial<Extract<Overlay, { type: 'text' }>> = {}): Overlay => ({
  type: 'text', text: 'Bonjour PidiElf', font: 'sans', size: 14, color: '#112233', x: 0.2, y: 0.3, w: 0.6, h: 0.05, ...extra,
});

const samples = async (): Promise<Record<Overlay['type'], Overlay>> => ({
  text: text(),
  image: { type: 'image', data: await fixture('photo.png'), mime: 'image/png', opacity: 0.8, x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
  rect: { type: 'rect', stroke: '#cc0000', fill: '#ffeeee', strokeWidth: 2, opacity: 0.9, x: 0.1, y: 0.5, w: 0.3, h: 0.1 },
  ellipse: { type: 'ellipse', stroke: '#0044cc', strokeWidth: 1.5, x: 0.5, y: 0.5, w: 0.3, h: 0.1 },
  line: { type: 'line', x1: 0.1, y1: 0.7, x2: 0.9, y2: 0.72, stroke: '#000000', strokeWidth: 1 },
  arrow: { type: 'arrow', x1: 0.1, y1: 0.8, x2: 0.5, y2: 0.75, stroke: '#aa00aa', strokeWidth: 3, opacity: 0.7 },
  ink: { type: 'ink', strokes: [[[0.2, 0.2], [0.25, 0.24], [0.3, 0.2], [0.35, 0.26]], [[0.5, 0.5]]], color: '#0f1e4d', width: 2, opacity: 0.9 },
  highlight: { type: 'highlight', rects: [{ x: 0.09, y: 0.13, w: 0.6, h: 0.02 }], color: '#ffe066' },
  underline: { type: 'underline', rects: [{ x: 0.09, y: 0.13, w: 0.6, h: 0.02 }], color: '#cc0000' },
  whiteout: { type: 'whiteout', x: 0.09, y: 0.08, w: 0.5, h: 0.04 },
  note: { type: 'note', x: 0.8, y: 0.1, text: 'À vérifier', color: '#ffd24d' },
});

describe('applyOverlays', () => {
  it('applique chaque type d’élément sans abîmer le document', async () => {
    const bytes = await fixture('sample-3p.pdf');
    for (const [type, overlay] of Object.entries(await samples())) {
      const out = await applyOverlays({ bytes, pages: [{ page: 2, overlays: [overlay] }] });
      expect(isPdf(out), type).toBe(true);
      expect(await pageCount(out), type).toBe(3);
      // pdf.js doit pouvoir rendre le texte de la page modifiée.
      const page = await readPage(out, 2);
      expect(page.items.some((i) => i.str.includes('Exemple')), type).toBe(true);
    }
  });

  it('applique tous les éléments d’un coup, sur plusieurs pages, et signale la progression', async () => {
    const all = Object.values(await samples());
    const ratios: number[] = [];
    const out = await applyOverlays(
      { bytes: await fixture('sample-3p.pdf'), pages: [{ page: 1, overlays: all }, { page: 3, overlays: all }, { page: 9, overlays: all }] },
      (ratio) => ratios.push(ratio),
    );
    expect(await pageCount(out)).toBe(3);
    expect(ratios.at(-1)).toBe(1);
  });

  it('écrit un texte extractible à l’endroit prévu', async () => {
    const out = await applyOverlays({ bytes: await fixture('sample-3p.pdf'), pages: [{ page: 1, overlays: [text()] }] });
    const page = await readPage(out, 1);
    const found = page.items.find((i) => i.str === 'Bonjour PidiElf');
    expect(found).toBeDefined();
    const layout = layoutText({ text: 'Bonjour PidiElf', font: 'sans', size: 14 });
    expect(found!.x).toBeCloseTo(0.2 * page.width, 0);
    expect(found!.y).toBeCloseTo(0.3 * page.height + layout.baseline, 0);
    expect(found!.width).toBeCloseTo(layout.width, 0);
  });

  it('place le texte au même endroit sur une page pivotée', async () => {
    const out = await applyOverlays({ bytes: await fixture('rotated.pdf'), pages: [{ page: 2, overlays: [text({ align: 'right' })] }] });
    const page = await readPage(out, 2);
    expect([page.width, page.height]).toEqual([842, 595]);
    const found = page.items.find((i) => i.str === 'Bonjour PidiElf');
    expect(found).toBeDefined();
    const layout = layoutText({ text: 'Bonjour PidiElf', font: 'sans', size: 14 });
    // Aligné à droite : la ligne se termine au bord droit de la boîte.
    expect(found!.x).toBeCloseTo(0.8 * page.width - layout.width, 0);
    expect(found!.y).toBeCloseTo(0.3 * page.height + layout.baseline, 0);
  });

  it('tient compte d’une boîte de rognage décalée', async () => {
    const doc = await PDFDocument.load(await fixture('sample-3p.pdf'));
    doc.getPage(0).setCropBox(100, 200, 300, 400);
    const out = await applyOverlays({ bytes: await doc.save(), pages: [{ page: 1, overlays: [text({ x: 0.1, y: 0.5, w: 0.8 })] }] });
    const page = await readPage(out, 1);
    expect([page.width, page.height]).toEqual([300, 400]);
    const found = page.items.find((i) => i.str === 'Bonjour PidiElf')!;
    expect(found.x).toBeCloseTo(30, 0);
    expect(found.y).toBeCloseTo(200 + layoutText({ text: 'x', font: 'sans', size: 14 }).baseline, 0);
  });

  it('renvoie à la ligne dans la largeur de la boîte et respecte les sauts de ligne', async () => {
    const long = 'Un texte assez long pour ne pas tenir sur une seule ligne dans une boîte étroite.\nFin';
    const overlay = text({ text: long, x: 0.1, y: 0.4, w: 0.3, size: 12, lineHeight: 1.5 });
    const blank = await PDFDocument.create();
    blank.addPage([595, 842]);
    const out = await applyOverlays({ bytes: await blank.save(), pages: [{ page: 1, overlays: [overlay] }] });
    const page = await readPage(out, 1);
    const added = page.items;
    const lines = [...new Set(added.map((i) => Math.round(i.y)))].sort((a, b) => a - b);
    expect(lines.length).toBeGreaterThan(3);
    // Interligne régulier : 12 points × 1,5.
    expect(lines[1] - lines[0]).toBeCloseTo(18, 0);
    for (const item of added) {
      expect(item.x).toBeGreaterThanOrEqual(0.1 * page.width - 0.5);
      expect(item.x + item.width).toBeLessThanOrEqual(0.4 * page.width + 0.5);
    }
    expect(added.at(-1)!.str).toBe('Fin');
    expect(added.map((i) => i.str).join(' ').replace(/\s+/g, ' ')).toContain('une seule ligne dans une boîte étroite.');
  });

  it('remplace les caractères hors WinAnsi au lieu d’échouer', async () => {
    const overlay = text({ text: 'Prix → 12 € 你好 😀 fin' });
    const out = await applyOverlays({ bytes: await fixture('sample-3p.pdf'), pages: [{ page: 1, overlays: [overlay] }] });
    const page = await readPage(out, 1);
    const found = page.items.find((i) => i.str.startsWith('Prix'));
    expect(found?.str).toMatch(/^Prix \? 12 € \?+ \?+ fin$/);
  });

  it('incorpore une image, une seule fois même si elle sert plusieurs fois', async () => {
    const image = (await samples()).image as Extract<Overlay, { type: 'image' }>;
    const jpeg: Overlay = { type: 'image', data: await fixture('photo.jpg'), mime: 'image/jpeg', x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    const before = await PDFDocument.load(await fixture('sample-3p.pdf'));
    const out = await applyOverlays({
      bytes: await fixture('sample-3p.pdf'),
      pages: [{ page: 1, overlays: [image, { ...image, x: 0.6 }, jpeg] }, { page: 2, overlays: [image] }],
    });
    const doc = await PDFDocument.load(out);
    const imagesOf = (d: PDFDocument, index: number) => {
      const xobjects = d.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      return (xobjects?.entries() ?? []).filter(([, ref]) => (d.context.lookup(ref) as PDFRawStream).dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    };
    const refs = (d: PDFDocument, index: number) => [...new Set(imagesOf(d, index).map(([, ref]) => ref.toString()))];
    expect(refs(doc, 0).length - refs(before, 0).length).toBe(2);
    expect(refs(doc, 1).length - refs(before, 1).length).toBe(1);
    // La même image posée sur deux pages pointe vers le même objet.
    expect(refs(doc, 0).filter((r) => refs(doc, 1).includes(r))).toHaveLength(1);
  });

  it('refuse une image qui n’est ni PNG ni JPEG', async () => {
    const overlay: Overlay = { type: 'image', data: new Uint8Array([1, 2, 3, 4]), mime: 'image/png', x: 0, y: 0, w: 0.1, h: 0.1 };
    await expect(applyOverlays({ bytes: await fixture('sample-3p.pdf'), pages: [{ page: 1, overlays: [overlay] }] })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('crée une vraie annotation de note, repliée, à l’endroit prévu', async () => {
    const note: Overlay = { type: 'note', x: 0.25, y: 0.4, text: 'Relire ce passage — 你好', color: '#33aa55' };
    for (const [file, pageNumber] of [['sample-3p.pdf', 1], ['rotated.pdf', 2]] as const) {
      const out = await applyOverlays({ bytes: await fixture(file), pages: [{ page: pageNumber, overlays: [note] }] });
      const page = await readPage(out, pageNumber);
      const found = page.annotations.find((a) => a.subtype === 'Text');
      expect(found, file).toBeDefined();
      expect(found.contentsObj.str).toBe('Relire ce passage — 你好');
      expect([...found.color]).toEqual([0x33, 0xaa, 0x55]);
      // Coin haut gauche du rectangle (espace de la page) = point choisi à l'écran.
      const [x, y] = page.viewport.convertToViewportPoint(found.rect[0], found.rect[3]);
      expect(x).toBeCloseTo(0.25 * page.width, 0);
      expect(y).toBeCloseTo(0.4 * page.height, 0);

      const doc = await PDFDocument.load(out);
      const annots = doc.getPage(pageNumber - 1).node.Annots()!;
      const dict = annots.lookup(annots.size() - 1, PDFDict);
      expect(dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('Text'));
      expect(dict.get(PDFName.of('Open'))?.toString()).toBe('false');
      // Rien n'est dessiné dans la page : aucun flux de contenu ajouté.
      const original = await PDFDocument.load(await fixture(file));
      const streams = (d: PDFDocument) => {
        const contents = d.getPage(pageNumber - 1).node.Contents();
        return contents instanceof PDFArray ? contents.size() : 1;
      };
      expect(streams(doc)).toBe(streams(original));
    }
  });

  it('surligne en mode « produit » pour laisser le texte lisible', async () => {
    const out = await applyOverlays({ bytes: await fixture('sample-3p.pdf'), pages: [{ page: 1, overlays: [(await samples()).highlight] }] });
    const doc = await PDFDocument.load(out);
    const states = doc.getPage(0).node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
    const blends = states.entries().map(([, value]) => (doc.context.lookup(value) as PDFDict).get(PDFName.of('BM'))?.toString());
    expect(blends).toContain('/Multiply');
  });

  it('dessine au bon endroit même si le contenu existant laisse l’état graphique modifié', async () => {
    // Deux « q » jamais refermés, avec deux changements d'échelle encore actifs.
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    const stream = doc.context.stream('q 0.5 0 0 0.5 40 40 cm (un q entre parenthèses) pop q 3 0 0 3 10 10 cm 0 0 10 10 re f');
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
    const out = await applyOverlays({ bytes: await doc.save(), pages: [{ page: 1, overlays: [text({ x: 0.25, y: 0.5 })] }] });
    const read = await readPage(out, 1);
    const found = read.items.find((i) => i.str === 'Bonjour PidiElf')!;
    expect(found.x).toBeCloseTo(100, 0);
    expect(found.y).toBeCloseTo(300 + layoutText({ text: 'x', font: 'sans', size: 14 }).baseline, 0);
    expect(found.width).toBeCloseTo(layoutText({ text: 'Bonjour PidiElf', font: 'sans', size: 14 }).width, 0);
  });

  it('signale un PDF protégé', async () => {
    await expect(applyOverlays({ bytes: await fixture('protected.pdf'), pages: [] })).rejects.toMatchObject({ code: 'encrypted' });
  });
});

describe('layoutText', () => {
  it('garde une ligne quand elle tient, et coupe aux espaces sinon', () => {
    const one = layoutText({ text: 'Bonjour à tous', font: 'serif', size: 12, maxWidth: 500 });
    expect(one.lines.map((l) => l.text)).toEqual(['Bonjour à tous']);
    const wrapped = layoutText({ text: 'Bonjour à tous les lecteurs', font: 'serif', size: 12, maxWidth: 70 });
    expect(wrapped.lines.length).toBeGreaterThan(1);
    expect(wrapped.lines.every((l) => l.width <= 70.01)).toBe(true);
    expect(wrapped.lines.map((l) => l.text).join(' ')).toBe('Bonjour à tous les lecteurs');
    expect(wrapped.height).toBeCloseTo(wrapped.lines.length * 12 * 1.2);
  });

  it('coupe un mot plus large que la boîte', () => {
    const layout = layoutText({ text: 'Anticonstitutionnellement', font: 'mono', size: 10, maxWidth: 60 });
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.map((l) => l.text).join('')).toBe('Anticonstitutionnellement');
    // Courier : chaque caractère fait 0,6 corps de large.
    expect(layout.lines[0].text).toHaveLength(10);
  });

  it('conserve les lignes vides et redonne la même mise en lignes à largeur mesurée', () => {
    const layout = layoutText({ text: 'Un\n\nDeux', font: 'sans', size: 12 });
    expect(layout.lines.map((l) => l.text)).toEqual(['Un', '', 'Deux']);
    const text = 'Un texte qui revient à la ligne quelque part';
    const first = layoutText({ text, font: 'sans', size: 12, maxWidth: 120, bold: true });
    const again = layoutText({ text: first.lines.map((l) => l.text).join('\n'), font: 'sans', size: 12, maxWidth: first.width, bold: true });
    expect(again.lines).toEqual(first.lines);
  });
});
