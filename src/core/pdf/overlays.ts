// Incruste dans un PDF les éléments posés par-dessus ses pages. L'éditeur, la
// signature et l'export des annotations du lecteur passent tous par ici.
import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFContentStream,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFontEmbedder,
  StandardFonts,
  appendBezierCurve,
  closePath,
  decodePDFRawStream,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { arrowHead, smoothPath } from '../signature/path';
import { loadPdf, savePdf } from './load';
import type { NBox, Overlay, OverlayFont, PageOverlays } from './overlayTypes';
import { displayFrame, displayMatrix, fromNormalized, hexColor, inDisplayFrame, toWinAnsi, type DisplayFrame } from './pageFrame';

// ---- Texte : polices standard, mesure et mise en lignes ---------------------

interface Family {
  /** Normal, gras, italique, gras italique. */
  names: [StandardFonts, StandardFonts, StandardFonts, StandardFonts];
  /** Hauteur au-dessus et au-dessous de la ligne de base, en fraction du corps. */
  ascent: number;
  descent: number;
}

// Les hauteurs sont celles des polices d'écran de mêmes largeurs (Arial, Times
// New Roman, Courier New) : une ligne se place ainsi comme dans un navigateur,
// et l'aperçu correspond au PDF produit.
const FAMILIES: Record<OverlayFont, Family> = {
  sans: {
    names: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    ascent: 0.905,
    descent: 0.212,
  },
  serif: {
    names: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    ascent: 0.891,
    descent: 0.216,
  },
  mono: {
    names: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
    ascent: 0.833,
    descent: 0.3,
  },
};

const DEFAULT_LINE_HEIGHT = 1.2;

const fontNameOf = (font: OverlayFont, bold?: boolean, italic?: boolean): StandardFonts =>
  (FAMILIES[font] ?? FAMILIES.sans).names[(bold ? 1 : 0) + (italic ? 2 : 0)];

const glyphWidths = new Map<StandardFonts, { embedder: StandardFontEmbedder; widths: Map<string, number> }>();

/**
 * Largeur d'un texte pour un corps de 1 point. Somme des largeurs de glyphes,
 * sans crénage : c'est ainsi que le texte est réellement écrit dans la page.
 */
function unitWidth(name: StandardFonts, text: string): number {
  let entry = glyphWidths.get(name);
  if (!entry) {
    // Mêmes noms des deux côtés : pdf-lib n'exporte pas le type attendu par son outil de mesure.
    entry = { embedder: StandardFontEmbedder.for(name as unknown as Parameters<typeof StandardFontEmbedder.for>[0]), widths: new Map() };
    glyphWidths.set(name, entry);
  }
  let total = 0;
  for (const ch of text) {
    let width = entry.widths.get(ch);
    if (width === undefined) {
      width = entry.embedder.widthOfTextAtSize(ch, 1);
      entry.widths.set(ch, width);
    }
    total += width;
  }
  return total;
}

/** Coupe un paragraphe en lignes qui tiennent dans `maxWidth` ; un mot trop long est coupé lettre à lettre. */
function wrapParagraph(paragraph: string, maxWidth: number, measure: (text: string) => number): string[] {
  const fits = (text: string) => measure(text.trimEnd()) <= maxWidth + 0.01;
  if (fits(paragraph)) return [paragraph.trimEnd()];
  const lines: string[] = [];
  let line = '';
  for (const token of paragraph.match(/\S+\s*|\s+/g) ?? []) {
    if (fits(line + token)) {
      line += token;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = '';
    if (fits(token)) {
      line = token;
      continue;
    }
    for (const ch of token) {
      if (line && !fits(line + ch)) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line.trim() || lines.length === 0) lines.push(line.trimEnd());
  return lines;
}

export interface TextSpec {
  text: string;
  font: OverlayFont;
  /** Corps, en points. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  lineHeight?: number;
  /** Largeur disponible, en points. Sans limite si absente. */
  maxWidth?: number;
}

export interface TextLayout {
  /** Lignes telles qu'elles seront écrites (caractères inconnus des polices standard remplacés). */
  lines: Array<{ text: string; width: number }>;
  /** Largeur de la ligne la plus longue, en points. */
  width: number;
  height: number;
  /** Pas entre deux lignes, en points. */
  lineHeight: number;
  /** Distance du haut du bloc à la ligne de base de la première ligne. */
  baseline: number;
}

/** Met un texte en lignes : sauts de ligne explicites, puis retour automatique dans la largeur. */
export function layoutText(spec: TextSpec): TextLayout {
  const family = FAMILIES[spec.font] ?? FAMILIES.sans;
  const name = fontNameOf(spec.font, spec.bold, spec.italic);
  const size = Math.max(1, spec.size);
  const measure = (text: string) => unitWidth(name, text) * size;
  const maxWidth = spec.maxWidth !== undefined && spec.maxWidth > 0 ? spec.maxWidth : Infinity;
  const lines: TextLayout['lines'] = [];
  for (const paragraph of toWinAnsi(spec.text.replace(/\r\n?/g, '\n')).split('\n')) {
    for (const line of wrapParagraph(paragraph, maxWidth, measure)) lines.push({ text: line, width: measure(line) });
  }
  const lineHeight = size * (spec.lineHeight ?? DEFAULT_LINE_HEIGHT);
  return {
    lines,
    width: lines.reduce((max, l) => Math.max(max, l.width), 0),
    height: lines.length * lineHeight,
    lineHeight,
    baseline: (lineHeight - (family.ascent + family.descent) * size) / 2 + family.ascent * size,
  };
}

/** Mise en lignes à la demande de l'interface : l'aperçu affiche exactement les lignes du PDF. */
export async function layoutTexts(params: { items: TextSpec[] }): Promise<TextLayout[]> {
  return params.items.map(layoutText);
}

// ---- État graphique ----------------------------------------------------------

const isSpace = (c: number): boolean => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const isDelimiter = (c: number): boolean => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 37;

/** Saute les données d'une image en ligne (BI … ID … EI), qui peuvent contenir n'importe quels octets. */
function skipInlineImage(bytes: Uint8Array, from: number): number {
  let i = from;
  while (i + 2 < bytes.length && !(bytes[i] === 73 && bytes[i + 1] === 68 && isSpace(bytes[i + 2]) && isSpace(bytes[i - 1]))) i++;
  i += 3;
  while (i + 1 < bytes.length) {
    if (bytes[i] === 69 && bytes[i + 1] === 73 && isSpace(bytes[i - 1]) && (i + 2 >= bytes.length || isSpace(bytes[i + 2]))) return i + 2;
    i++;
  }
  return bytes.length;
}

/** Parcourt un flux de contenu et suit le nombre de « q » restés sans « Q ». */
function scanDepth(bytes: Uint8Array, initial: number): number {
  let depth = initial;
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const c = bytes[i];
    if (isSpace(c)) {
      i++;
    } else if (c === 37) {
      while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; // commentaire
    } else if (c === 40) {
      // Chaîne entre parenthèses, avec échappements et parenthèses imbriquées.
      let level = 1;
      i++;
      while (i < n && level > 0) {
        if (bytes[i] === 92) i++;
        else if (bytes[i] === 40) level++;
        else if (bytes[i] === 41) level--;
        i++;
      }
    } else if (c === 60 && bytes[i + 1] !== 60) {
      while (i < n && bytes[i] !== 62) i++; // chaîne hexadécimale
      i++;
    } else if (isDelimiter(c)) {
      i++;
    } else {
      const start = i++;
      while (i < n && !isSpace(bytes[i]) && !isDelimiter(bytes[i]) && bytes[i] !== 47) i++;
      const length = i - start;
      if (length === 1 && bytes[start] === 113) depth++;
      else if (length === 1 && bytes[start] === 81) depth = Math.max(0, depth - 1);
      else if (length === 2 && bytes[start] === 66 && bytes[start + 1] === 73) i = skipInlineImage(bytes, i);
    }
  }
  return depth;
}

/**
 * Nombre d'états graphiques que le contenu existant de la page a empilés sans
 * les dépiler. pdf-lib encadre déjà ce contenu par « q … Q », ce qui annule un
 * niveau ; certains PDF en laissent plusieurs ouverts, avec une échelle ou un
 * masque encore actifs, et nos ajouts seraient déformés ou rognés.
 */
function leftoverPushes(page: PDFPage): number {
  try {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents];
    let depth = 0;
    for (const stream of streams) {
      if (stream instanceof PDFRawStream) depth = scanDepth(decodePDFRawStream(stream).decode(), depth);
      else if (stream instanceof PDFContentStream) depth = scanDepth(stream.getUnencodedContents(), depth);
    }
    return depth;
  } catch {
    return 0; // flux illisible : on s'en tient à l'encadrement de pdf-lib
  }
}

/** Opacité et mode de fusion passent par un état graphique nommé dans les ressources de la page. */
function graphicsState(page: PDFPage, options: { fill?: number; stroke?: number; blend?: BlendMode }): PDFOperator[] {
  const entries: Record<string, string | number> = { Type: 'ExtGState' };
  if (options.fill !== undefined && options.fill < 1) entries.ca = options.fill;
  if (options.stroke !== undefined && options.stroke < 1) entries.CA = options.stroke;
  if (options.blend) entries.BM = options.blend;
  if (Object.keys(entries).length === 1) return [];
  return [setGraphicsState(page.node.newExtGState('GS', page.doc.context.obj(entries)))];
}

const opacityOf = (value: number | undefined, fallback = 1): number => Math.min(1, Math.max(0, value ?? fallback));

// ---- Dessin des éléments -------------------------------------------------------

type Drawable = Exclude<Overlay, { type: 'note' }>;

interface Assets {
  font: (font: OverlayFont, bold?: boolean, italic?: boolean) => PDFFont;
  image: (data: Uint8Array) => PDFImage;
}

/** Rectangle normalisé → coin bas gauche et dimensions dans le repère d'affichage. */
function boxOf(frame: DisplayFrame, box: NBox): { x: number; y: number; width: number; height: number } {
  const width = box.w * frame.width;
  const height = box.h * frame.height;
  const top = fromNormalized(frame, box.x, box.y);
  return { x: top.x, y: top.y - height, width, height };
}

function drawOverlay(page: PDFPage, frame: DisplayFrame, overlay: Drawable, assets: Assets): void {
  switch (overlay.type) {
    case 'text': {
      const box = boxOf(frame, overlay);
      const font = assets.font(overlay.font, overlay.bold, overlay.italic);
      const layout = layoutText({ ...overlay, maxWidth: box.width });
      const top = box.y + box.height;
      layout.lines.forEach((line, i) => {
        if (!line.text) return;
        const slack = box.width - line.width;
        const x = box.x + (overlay.align === 'center' ? slack / 2 : overlay.align === 'right' ? slack : 0);
        page.drawText(line.text, {
          x,
          y: top - layout.baseline - i * layout.lineHeight,
          font,
          size: Math.max(1, overlay.size),
          color: hexColor(overlay.color),
        });
      });
      break;
    }
    case 'image': {
      const box = boxOf(frame, overlay);
      const opacity = opacityOf(overlay.opacity);
      if (box.width > 0 && box.height > 0) page.drawImage(assets.image(overlay.data), { ...box, opacity: opacity < 1 ? opacity : undefined });
      break;
    }
    case 'rect':
    case 'ellipse': {
      const box = boxOf(frame, overlay);
      const bordered = !!overlay.stroke && overlay.strokeWidth > 0;
      if (!overlay.fill && !bordered) break;
      const opacity = opacityOf(overlay.opacity);
      const style = {
        color: overlay.fill ? hexColor(overlay.fill) : undefined,
        borderColor: bordered ? hexColor(overlay.stroke!) : undefined,
        borderWidth: bordered ? overlay.strokeWidth : 0,
        opacity,
        borderOpacity: opacity,
      };
      if (overlay.type === 'rect') page.drawRectangle({ ...box, ...style });
      else page.drawEllipse({ x: box.x + box.width / 2, y: box.y + box.height / 2, xScale: box.width / 2, yScale: box.height / 2, ...style });
      break;
    }
    case 'line': {
      page.drawLine({
        start: fromNormalized(frame, overlay.x1, overlay.y1),
        end: fromNormalized(frame, overlay.x2, overlay.y2),
        thickness: overlay.strokeWidth,
        color: hexColor(overlay.stroke),
        opacity: opacityOf(overlay.opacity),
        lineCap: LineCapStyle.Round,
      });
      break;
    }
    case 'arrow': {
      const start = fromNormalized(frame, overlay.x1, overlay.y1);
      const end = fromNormalized(frame, overlay.x2, overlay.y2);
      if (start.x === end.x && start.y === end.y) break;
      const head = arrowHead(start.x, start.y, end.x, end.y, overlay.strokeWidth);
      const color = hexColor(overlay.stroke);
      const opacity = opacityOf(overlay.opacity);
      // La tige s'arrête au pied de la pointe : rien ne dépasse, même en transparence.
      page.pushOperators(
        pushGraphicsState(),
        ...graphicsState(page, { fill: opacity, stroke: opacity }),
        setStrokingColor(color),
        setFillingColor(color),
        setLineWidth(overlay.strokeWidth),
        setLineCap(LineCapStyle.Butt),
        moveTo(start.x, start.y),
        lineTo(head.base[0], head.base[1]),
        stroke(),
        moveTo(head.tip[0], head.tip[1]),
        lineTo(head.left[0], head.left[1]),
        lineTo(head.right[0], head.right[1]),
        closePath(),
        fill(),
        popGraphicsState(),
      );
      break;
    }
    case 'ink': {
      const operators: PDFOperator[] = [];
      for (const points of overlay.strokes) {
        let x = 0;
        let y = 0;
        const path = smoothPath(
          points.map(([nx, ny]) => {
            const p = fromNormalized(frame, nx, ny);
            return [p.x, p.y];
          }),
        );
        for (const command of path) {
          if (command[0] === 'Q') {
            // Courbe quadratique exprimée en cubique, seule forme connue du PDF.
            const [, cx, cy, tx, ty] = command;
            operators.push(appendBezierCurve(x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), tx + (2 / 3) * (cx - tx), ty + (2 / 3) * (cy - ty), tx, ty));
            [x, y] = [tx, ty];
          } else {
            [, x, y] = command;
            operators.push(command[0] === 'M' ? moveTo(x, y) : lineTo(x, y));
          }
        }
      }
      if (operators.length === 0) break;
      // Un seul tracé pour tous les traits : là où ils se croisent, la transparence ne s'additionne pas.
      page.pushOperators(
        pushGraphicsState(),
        ...graphicsState(page, { stroke: opacityOf(overlay.opacity) }),
        setStrokingColor(hexColor(overlay.color)),
        setLineWidth(overlay.width),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
        ...operators,
        stroke(),
        popGraphicsState(),
      );
      break;
    }
    case 'highlight': {
      // Fusion « produit » : le texte surligné reste lisible, comme sous un feutre fluo.
      for (const rect of overlay.rects) {
        page.drawRectangle({ ...boxOf(frame, rect), color: hexColor(overlay.color), opacity: opacityOf(overlay.opacity, 0.4), blendMode: BlendMode.Multiply });
      }
      break;
    }
    case 'underline': {
      for (const rect of overlay.rects) {
        const box = boxOf(frame, rect);
        const thickness = overlay.width ?? Math.max(0.75, box.height * 0.07);
        page.drawLine({ start: { x: box.x, y: box.y }, end: { x: box.x + box.width, y: box.y }, thickness, color: hexColor(overlay.color) });
      }
      break;
    }
    case 'whiteout': {
      page.drawRectangle({ ...boxOf(frame, overlay), color: hexColor(overlay.color ?? '#ffffff') });
      break;
    }
  }
}

// ---- Notes -----------------------------------------------------------------------

const NOTE_SIZE = 20;
const DEFAULT_NOTE_COLOR = '#ffd24d';

/**
 * Note repliée : une vraie annotation /Text, que tout lecteur PDF affiche et
 * ouvre. Rien n'est dessiné dans la page elle-même.
 */
function addNote(doc: PDFDocument, page: PDFPage, note: Extract<Overlay, { type: 'note' }>): void {
  const frame = displayFrame(page);
  const color = hexColor(note.color ?? DEFAULT_NOTE_COLOR);
  // Coin haut gauche de l'icône, ramené dans l'espace de la page (rotation comprise).
  const at = fromNormalized(frame, Math.min(1, Math.max(0, note.x)), Math.min(1, Math.max(0, note.y)));
  const [a, b, c, d, e, f] = displayMatrix(page);
  const x = a * at.x + c * at.y + e;
  const y = b * at.x + d * at.y + f;

  // Apparence explicite (une bulle), pour les lecteurs qui ne dessinent pas d'icône par défaut.
  const dark = hexColor('#3a3a3a');
  const appearance = doc.context.formXObject(
    [
      setFillingColor(color),
      setStrokingColor(dark),
      setLineWidth(1),
      setLineJoin(LineJoinStyle.Round),
      moveTo(2, 6.5),
      lineTo(2, 18),
      lineTo(18, 18),
      lineTo(18, 6.5),
      lineTo(9.5, 6.5),
      lineTo(5, 2),
      lineTo(5, 6.5),
      closePath(),
      fillAndStroke(),
      moveTo(5, 14.5),
      lineTo(15, 14.5),
      moveTo(5, 10.5),
      lineTo(12, 10.5),
      stroke(),
    ],
    { BBox: [0, 0, NOTE_SIZE, NOTE_SIZE] },
  );
  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    // L'icône reste droite et de taille fixe (NoZoom + NoRotate), ancrée à son coin haut gauche.
    Rect: [x, y - NOTE_SIZE, x + NOTE_SIZE, y],
    F: 4 + 8 + 16,
    Contents: PDFHexString.fromText(note.text),
    C: [color.red, color.green, color.blue],
    Name: 'Comment',
    Open: false,
    M: PDFString.fromDate(new Date()),
    P: page.ref,
    AP: { N: doc.context.register(appearance) },
  });
  // Ajout direct à /Annots : passer par pdf-lib encadrerait le contenu de la page, qu'on ne touche pas ici.
  let annots = page.node.Annots();
  if (!annots) {
    annots = doc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(doc.context.register(annotation));
}

// ---- Point d'entrée ------------------------------------------------------------

/** Clé de contenu : une même image (signature posée sur dix pages) n'est incorporée qu'une fois. */
function imageKey(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 0x01000193);
  return `${data.length}:${hash >>> 0}`;
}

async function embedImage(doc: PDFDocument, data: Uint8Array): Promise<PDFImage> {
  // On se fie à la signature du fichier plutôt qu'au type annoncé.
  const png = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  const jpeg = data[0] === 0xff && data[1] === 0xd8;
  if (!png && !jpeg) throw new ToolError('unsupported', 'Image ni PNG ni JPEG');
  try {
    return png ? await doc.embedPng(data) : await doc.embedJpg(data);
  } catch (err) {
    throw new ToolError('unsupported', (err as Error).message);
  }
}

/**
 * Applique des éléments sur les pages d'un PDF. Coordonnées normalisées dans la
 * page telle qu'elle est affichée (voir overlayTypes.ts). Un texte part du haut
 * de sa boîte et revient à la ligne dans sa largeur ; la hauteur de la boîte
 * n'est pas une limite.
 */
export async function applyOverlays(params: { bytes: Uint8Array; pages: PageOverlays[] }, progress?: Progress): Promise<Uint8Array> {
  const doc = await loadPdf(params.bytes);
  const pages = doc.getPages();
  const fonts = new Map<StandardFonts, PDFFont>();
  const images = new Map<string, PDFImage>();

  // Polices et images sont incorporées d'abord : le dessin, lui, est synchrone.
  for (const entry of params.pages) {
    for (const overlay of entry.overlays) {
      if (overlay.type === 'text') {
        const name = fontNameOf(overlay.font, overlay.bold, overlay.italic);
        if (!fonts.has(name)) fonts.set(name, await doc.embedFont(name));
      } else if (overlay.type === 'image') {
        const key = imageKey(overlay.data);
        if (!images.has(key)) images.set(key, await embedImage(doc, overlay.data));
      }
    }
  }
  const assets: Assets = {
    font: (font, bold, italic) => fonts.get(fontNameOf(font, bold, italic))!,
    image: (data) => images.get(imageKey(data))!,
  };

  params.pages.forEach((entry, index) => {
    const page = pages[entry.page - 1];
    if (page) {
      const drawn = entry.overlays.filter((o): o is Drawable => o.type !== 'note');
      if (drawn.length > 0) {
        const leftover = leftoverPushes(page);
        if (leftover > 0) page.pushOperators(...Array.from({ length: leftover }, popGraphicsState));
        inDisplayFrame(page, (frame) => drawn.forEach((overlay) => drawOverlay(page, frame, overlay, assets)));
      }
      for (const overlay of entry.overlays) if (overlay.type === 'note') addNote(doc, page, overlay);
    }
    progress?.((index + 1) / params.pages.length);
  });
  return savePdf(doc);
}
