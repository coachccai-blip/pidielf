// Organiser les pages : reconstruit un document à partir d'un plan
// (ordre, rotations, doublons, pages blanches, pages d'autres PDF).
import { degrees, PDFDocument } from '@cantoo/pdf-lib';
import type { Progress } from '@/workers/protocol';
import { ToolError } from '../errors';
import { loadPdf, normAngle, savePdf } from './load';

export type PlanItem =
  | { kind: 'page'; /** Indice du document source. */ source: number; /** Page (à partir de 1). */ page: number; /** Rotation ajoutée, en degrés. */ rotate?: number }
  | { kind: 'blank'; width: number; height: number };

export async function organizePdf(params: { sources: Uint8Array[]; plan: PlanItem[] }, progress?: Progress): Promise<Uint8Array> {
  if (params.plan.length === 0) throw new ToolError('empty');
  const docs: PDFDocument[] = [];
  for (const bytes of params.sources) docs.push(await loadPdf(bytes));
  const out = await PDFDocument.create();
  for (const [i, item] of params.plan.entries()) {
    if (item.kind === 'blank') {
      out.addPage([item.width, item.height]);
    } else {
      const src = docs[item.source];
      if (!src || item.page < 1 || item.page > src.getPageCount()) continue;
      // Une copie par occurrence : une page dupliquée reste indépendante de l'originale.
      const [page] = await out.copyPages(src, [item.page - 1]);
      if (item.rotate) page.setRotation(degrees(normAngle(page.getRotation().angle + item.rotate)));
      out.addPage(page);
    }
    if (i % 8 === 0) progress?.((i + 1) / params.plan.length);
  }
  if (out.getPageCount() === 0) throw new ToolError('empty');
  return savePdf(out);
}
