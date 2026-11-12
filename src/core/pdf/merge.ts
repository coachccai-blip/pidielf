// Fusionner : réunit plusieurs PDF, en ne gardant au besoin que certaines pages.
import { PDFDocument } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { loadPdf, savePdf } from './load';

export interface MergeSource {
  bytes: Uint8Array;
  /** Pages à garder (à partir de 1), dans l'ordre voulu. Toutes si absent. */
  pages?: number[];
}

export async function mergePdfs(params: { files: MergeSource[] }, progress?: Progress): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  let done = 0;
  for (const file of params.files) {
    const src = await loadPdf(file.bytes);
    const count = src.getPageCount();
    const indices = (file.pages ?? Array.from({ length: count }, (_, i) => i + 1))
      .filter((p) => p >= 1 && p <= count)
      .map((p) => p - 1);
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    progress?.(++done / params.files.length);
  }
  if (out.getPageCount() === 0) throw new ToolError('empty');
  return savePdf(out);
}
