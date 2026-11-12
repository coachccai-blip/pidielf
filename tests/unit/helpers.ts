import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from '@cantoo/pdf-lib';
import { setQpdfWasmUrl } from '@/core/qpdf';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const fixturePath = (name: string): string => join(here, '..', 'fixtures', name);

export async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath(name)));
}

/** qpdf.wasm est lu depuis node_modules pendant les tests. */
export function useNodeQpdf(): void {
  setQpdfWasmUrl(require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'));
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

export async function rotations(bytes: Uint8Array): Promise<number[]> {
  return (await PDFDocument.load(bytes)).getPages().map((p) => p.getRotation().angle);
}

export async function pageSizes(bytes: Uint8Array): Promise<Array<[number, number]>> {
  return (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
}

/** Texte brut des flux de contenu d'une page (les fixtures ne sont pas compressées côté texte). */
export const isPdf = (bytes: Uint8Array): boolean => new TextDecoder('latin1').decode(bytes.slice(0, 5)) === '%PDF-';
