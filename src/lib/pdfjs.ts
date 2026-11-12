// Accès à pdf.js, chargé à la demande pour garder le premier chargement léger.
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export type { PDFDocumentProxy, PDFPageProxy };

const vendor = `${import.meta.env.BASE_URL}vendor/pdfjs/`;

let lib: Promise<typeof import('pdfjs-dist')> | null = null;

export function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
  );
  return lib;
}

export type PdfErrorCode = 'password' | 'bad-password' | 'invalid' | 'unknown';

export class PdfOpenError extends Error {
  code: PdfErrorCode;
  constructor(code: PdfErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PdfOpenError';
    this.code = code;
  }
}

export async function openPdf(source: Blob | Uint8Array | ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const data =
    source instanceof Blob
      ? new Uint8Array(await source.arrayBuffer())
      : source instanceof Uint8Array
        ? source.slice() // pdf.js transfère le tampon à son worker : on lui donne une copie
        : new Uint8Array(source.slice(0));
  try {
    return await pdfjs.getDocument({
      data,
      password,
      cMapUrl: `${vendor}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${vendor}standard_fonts/`,
      wasmUrl: `${vendor}wasm/`,
    }).promise;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') {
      const code = (err as { code?: number }).code;
      throw new PdfOpenError(code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'bad-password' : 'password');
    }
    if (name === 'InvalidPDFException' || name === 'FormatError') throw new PdfOpenError('invalid');
    throw new PdfOpenError('unknown', (err as Error).message);
  }
}

export interface RenderOptions {
  /** Largeur cible en pixels CSS. */
  width?: number;
  /** Échelle (1 = 72 points par pouce). Prioritaire sur width. */
  scale?: number;
  /** Densité de pixels (plafonnée pour ménager la mémoire). */
  dpr?: number;
  background?: string;
}

/** Rend une page dans un nouveau canvas. */
export async function renderPage(page: PDFPageProxy, options: RenderOptions = {}): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = options.scale ?? (options.width ? options.width / base.width : 1);
  const dpr = options.dpr ?? 1;
  const viewport = page.getViewport({ scale: scale * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, viewport, background: options.background ?? '#ffffff' }).promise;
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas vide'))), type, quality),
  );
}

/** Miniature de couverture (première page). */
export async function makeCover(pdf: PDFDocumentProxy, width = 360): Promise<Blob | null> {
  try {
    const page = await pdf.getPage(1);
    const canvas = await renderPage(page, { width });
    const blob = await canvasToBlob(canvas, 'image/webp', 0.8).catch(() => canvasToBlob(canvas, 'image/jpeg', 0.8));
    canvas.width = 0;
    return blob;
  } catch {
    return null;
  }
}
