// Pivoter : rotation de 90°, 180° ou 270° sur les pages choisies.
import { degrees } from '@cantoo/pdf-lib';
import { loadPdf, normAngle, savePdf } from './load';

export async function rotatePdf(params: { bytes: Uint8Array; angle: number; pages?: number[] }): Promise<Uint8Array> {
  const doc = await loadPdf(params.bytes);
  const all = doc.getPages();
  const targets = params.pages ?? all.map((_, i) => i + 1);
  for (const n of targets) {
    const page = all[n - 1];
    if (!page) continue;
    page.setRotation(degrees(normAngle(page.getRotation().angle + params.angle)));
  }
  return savePdf(doc);
}
