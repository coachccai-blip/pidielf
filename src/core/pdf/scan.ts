// Scanner : redressement et rendu d'une page photographiée (calcul pur sur des
// pixels, exécuté dans le worker), puis assemblage des pages en PDF.
import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { applyScanMode, packBilevel, type ScanMode } from '../image/filters';
import { isValidQuad, quadOutputSize, type Quad } from '../image/geometry';
import { warpPerspective } from '../image/warp';
import { savePdf } from './load';

export interface ScanParams {
  /** Photo d'origine : quatre octets par pixel. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  /** Coins de la page, en pixels de la photo. */
  quad: Quad;
  mode: ScanMode;
  /** Plus grand côté de l'image produite, en pixels. */
  maxSide: number;
  /** En noir et blanc, renvoie un bit par pixel (pour le PDF) au lieu de pixels RVBA. */
  pack?: boolean;
}

export interface ScanResult {
  /** Pixels RVBA, ou un bit par pixel si `bilevel`. */
  data: Uint8Array;
  width: number;
  height: number;
  bilevel: boolean;
}

/** Redresse la page désignée par `quad` puis applique le rendu choisi. */
export async function processScan(params: ScanParams): Promise<ScanResult> {
  if (!isValidQuad(params.quad, 1)) throw new ToolError('empty', 'Les coins ne délimitent pas une page.');
  const { width, height } = quadOutputSize(params.quad, params.maxSide);
  const image = warpPerspective(params, params.quad, width, height);
  applyScanMode(image, params.mode);
  if (params.pack && params.mode === 'bw') return { data: packBilevel(image), width, height, bilevel: true };
  // Même mémoire, vue comme Uint8Array : le worker peut la transférer sans copie.
  return { data: new Uint8Array(image.data.buffer), width, height, bilevel: false };
}

export interface ScanPage {
  /** `jpeg` : fichier JPEG ; `bilevel` : un bit par pixel (1 = blanc), lignes complétées à l'octet. */
  kind: 'jpeg' | 'bilevel';
  data: Uint8Array;
  width: number;
  height: number;
}

/** Petit côté d'une page A4, en points : la largeur d'une page scannée en portrait. */
const A4_SHORT = 595.28;

/** Page aux proportions de l'image redressée, dont le petit côté est celui d'un A4. */
export function scanPageSize(width: number, height: number): [number, number] {
  const scale = A4_SHORT / Math.min(width, height);
  return [width * scale, height * scale];
}

export async function scanToPdf(params: { pages: ScanPage[] }, progress?: Progress): Promise<Uint8Array> {
  if (params.pages.length === 0) throw new ToolError('empty');
  const doc = await PDFDocument.create();
  for (const [i, scan] of params.pages.entries()) {
    const [w, h] = scanPageSize(scan.width, scan.height);
    const page = doc.addPage([w, h]);
    if (scan.kind === 'jpeg') {
      page.drawImage(await doc.embedJpg(scan.data), { x: 0, y: 0, width: w, height: h });
    } else {
      // Image 1 bit compressée sans perte : pdf-lib ne sait pas la créer, on écrit l'objet nous-mêmes.
      const stream = doc.context.flateStream(scan.data, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: scan.width,
        Height: scan.height,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 1,
      });
      const name = page.node.newXObject('Scan', doc.context.register(stream));
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, 0, 0), drawObject(name), popGraphicsState());
    }
    progress?.((i + 1) / params.pages.length);
  }
  return savePdf(doc);
}
