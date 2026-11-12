// Préparation des fichiers d'entrée d'un outil : nombre de pages, et
// déverrouillage des PDF protégés (le mot de passe n'est jamais enregistré).
import { db } from '@/db';
import { getFileBlob } from '@/db/files';
import { t } from '@/i18n';
import { ToolError } from '@/core/errors';
import { openPdf, PdfOpenError } from '@/lib/pdfjs';
import { prompt } from '@/ui/dialogs';
import { pdfOp } from '@/workers/client';
import { isPdf } from '@/features/library/import';
import type { ToolMeta } from './registry';
import type { InputFile } from './types';

let counter = 0;
const nextKey = () => `in-${Date.now().toString(36)}-${counter++}`;

const crypto = pdfOp<typeof import('@/core/pdf/crypto')>('crypto');

async function pageCountOf(blob: Blob, password?: string): Promise<number> {
  const pdf = await openPdf(blob, password);
  const count = pdf.numPages;
  void pdf.loadingTask.destroy();
  return count;
}

/** Demande le mot de passe d'un PDF protégé jusqu'à ce qu'il soit bon, ou que l'utilisateur renonce. */
export async function unlockBlob(name: string, blob: Blob): Promise<{ blob: Blob; pageCount: number } | null> {
  let error: string | undefined;
  for (;;) {
    const password = await prompt({
      title: t('tools.password.title'),
      message: t('tools.password.text', { name }),
      label: t('tools.password.label'),
      password: true,
      confirmLabel: t('tools.password.unlock'),
      error,
    });
    if (password === null) return null;
    try {
      const bytes = await crypto('decryptPdf', { bytes: new Uint8Array(await blob.arrayBuffer()), password });
      const clear = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      return { blob: clear, pageCount: await pageCountOf(clear) };
    } catch (err) {
      if (err instanceof ToolError && err.code === 'bad-password') error = t('tools.password.wrong');
      else throw err;
    }
  }
}

async function preparePdf(name: string, blob: Blob, tool: ToolMeta, libraryId?: string): Promise<InputFile | null> {
  try {
    return { key: nextKey(), name, blob, pageCount: await pageCountOf(blob), libraryId };
  } catch (err) {
    if (!(err instanceof PdfOpenError)) throw err;
    if (err.code === 'password' || err.code === 'bad-password') {
      if (tool.keepEncrypted) return { key: nextKey(), name, blob, pageCount: 0, libraryId, encrypted: true };
      const unlocked = await unlockBlob(name, blob);
      return unlocked ? { key: nextKey(), name, blob: unlocked.blob, pageCount: unlocked.pageCount, libraryId } : null;
    }
    throw new ToolError('damaged', err.message);
  }
}

/** Fichiers venus de l'appareil. Renvoie aussi le nombre de fichiers écartés (mauvais type). */
export async function prepareFiles(files: File[], tool: ToolMeta): Promise<{ inputs: InputFile[]; rejected: number }> {
  const inputs: InputFile[] = [];
  let rejected = 0;
  for (const file of files) {
    if (tool.accepts === 'pdf') {
      if (!isPdf(file)) {
        rejected++;
        continue;
      }
      const input = await preparePdf(file.name, file, tool);
      if (input) inputs.push(input);
    } else if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name)) {
      inputs.push({ key: nextKey(), name: file.name, blob: file, pageCount: 0 });
    } else {
      rejected++;
    }
  }
  return { inputs, rejected };
}

/** Fichiers venus de la bibliothèque. */
export async function prepareLibraryFiles(ids: string[], tool: ToolMeta): Promise<InputFile[]> {
  const inputs: InputFile[] = [];
  for (const id of ids) {
    const [record, blob] = await Promise.all([db.files.get(id), getFileBlob(id)]);
    if (!record || !blob) continue;
    const input = await preparePdf(record.name, blob, tool, id);
    if (input) inputs.push(input);
  }
  return inputs;
}

export const inputBytes = async (input: InputFile): Promise<Uint8Array> => new Uint8Array(await input.blob.arrayBuffer());

export const pdfBlob = (bytes: Uint8Array): Blob => new Blob([bytes as BlobPart], { type: 'application/pdf' });
