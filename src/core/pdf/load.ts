// Chargement et enregistrement communs à tous les traitements pdf-lib.
import { PDFDocument } from '@cantoo/pdf-lib';
import { classifyError, ToolError } from '../errors';

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const code = classifyError(err);
    if (code === 'encrypted' || code === 'bad-password') throw new ToolError('encrypted');
    if (code === 'memory') throw new ToolError('memory');
    throw new ToolError('damaged', (err as Error).message);
  }
}

export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  doc.setProducer('PidiElf');
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: true });
}

/** Rotation normalisée : 0, 90, 180 ou 270. */
export const normAngle = (angle: number): number => (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
