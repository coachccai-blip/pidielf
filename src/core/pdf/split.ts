// Diviser : découpe un PDF en plusieurs fichiers, selon des plages de pages.
import { PDFDocument } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import type { PageRange } from '../ranges';
import { ToolError } from '../errors';
import { loadPdf, savePdf } from './load';

export async function splitPdf(params: { bytes: Uint8Array; ranges: PageRange[] }, progress?: Progress): Promise<Uint8Array[]> {
  const src = await loadPdf(params.bytes);
  const count = src.getPageCount();
  if (params.ranges.length === 0) throw new ToolError('empty');
  const outputs: Uint8Array[] = [];
  for (const [i, range] of params.ranges.entries()) {
    const from = Math.max(1, Math.min(range.from, range.to));
    const to = Math.min(count, Math.max(range.from, range.to));
    const indices = Array.from({ length: to - from + 1 }, (_, k) => from - 1 + k);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    outputs.push(await savePdf(out));
    progress?.((i + 1) / params.ranges.length);
  }
  return outputs;
}
