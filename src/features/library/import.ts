// Import de fichiers dans la bibliothèque.
import { t } from '@/i18n';
import { addFile, findDuplicate } from '@/db/files';
import type { FileRecord, ToolId } from '@/db';
import { getSettings, updateSettings } from '@/lib/settings';
import { makeCover, openPdf, PdfOpenError } from '@/lib/pdfjs';
import { navigate, routes } from '@/lib/router';
import { confirm } from '@/ui/dialogs';
import { toast, toastError, toastSuccess } from '@/ui/toast';
import { handOffFiles } from '@/features/tools/handoff';

export const isPdf = (file: File | Blob & { name?: string }): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test((file as File).name ?? '');

export const isImage = (file: File): boolean =>
  file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name);

/** Seuils au-delà desquels on prévient que le traitement peut être lent ou échouer. */
export function isHeavy(size: number): boolean {
  const mobile = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  return size > (mobile ? 100 : 300) * 1024 * 1024;
}

/** Lit les métadonnées d'un PDF : nombre de pages et couverture. */
export async function inspectPdf(blob: Blob, password?: string): Promise<{ pageCount: number; cover: Blob | null; encrypted: boolean }> {
  try {
    const pdf = await openPdf(blob, password);
    try {
      return { pageCount: pdf.numPages, cover: await makeCover(pdf), encrypted: password !== undefined };
    } finally {
      void pdf.loadingTask.destroy();
    }
  } catch (err) {
    if (err instanceof PdfOpenError && (err.code === 'password' || err.code === 'bad-password')) {
      // PDF protégé : il sera déverrouillé à l'ouverture. Le mot de passe n'est jamais enregistré.
      return { pageCount: 0, cover: null, encrypted: true };
    }
    throw err;
  }
}

export interface SaveOptions {
  origin?: 'import' | 'tool';
  tool?: ToolId;
  parentId?: string;
}

/** Enregistre un PDF dans la bibliothèque (sans contrôle de doublon). */
export async function savePdfToLibrary(name: string, blob: Blob, options: SaveOptions = {}): Promise<FileRecord> {
  const info = await inspectPdf(blob);
  const record = await addFile({ name, blob, pageCount: info.pageCount, cover: info.cover, encrypted: info.encrypted, ...options });
  void requestPersistence();
  return record;
}

/** Demande un stockage persistant après le premier import. */
export async function requestPersistence(): Promise<void> {
  if (getSettings().persistAsked) return;
  updateSettings({ persistAsked: true });
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* non pris en charge : la sauvegarde en ZIP reste disponible */
  }
}

/**
 * Point d'entrée unique : sélecteur, glisser-déposer, partage entrant, « Ouvrir avec ».
 * Les PDF rejoignent la bibliothèque ; les images ouvrent l'outil « Images en PDF ».
 */
export async function importFiles(files: File[], options: { openSingle?: boolean } = {}): Promise<FileRecord[]> {
  const pdfs = files.filter(isPdf);
  const images = files.filter((f) => !isPdf(f) && isImage(f));
  const others = files.length - pdfs.length - images.length;
  if (others > 0) toastError(t('library.import.unsupported', { count: others }));

  const added: FileRecord[] = [];
  for (const file of pdfs) {
    try {
      const duplicate = await findDuplicate(file.name, file.size);
      if (duplicate) {
        const ok = await confirm({
          title: t('library.import.duplicateTitle'),
          message: t('library.import.duplicateText', { name: file.name }),
          confirmLabel: t('library.import.duplicateAdd'),
        });
        if (!ok) continue;
      }
      if (isHeavy(file.size)) toast(t('errors.heavy'));
      added.push(await savePdfToLibrary(file.name, file));
    } catch (err) {
      console.error(err);
      toastError(t('library.import.failed', { name: file.name }));
    }
  }

  if (added.length === 1) {
    const [file] = added;
    if (options.openSingle) navigate(routes.reader(file.id));
    else toastSuccess(t('library.import.added', { name: file.name }), { label: t('common.open'), onClick: () => navigate(routes.reader(file.id)) });
  } else if (added.length > 1) {
    toastSuccess(t('library.import.addedMany', { count: added.length }), { label: t('nav.library'), onClick: () => navigate(routes.library) });
  }

  if (images.length > 0) {
    handOffFiles(images);
    navigate(routes.tool('images-en-pdf'));
  }
  return added;
}

/** Ouvre le sélecteur de fichiers du système. */
export function pickFiles(options: { accept?: string; multiple?: boolean; capture?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept ?? 'application/pdf,.pdf';
    input.multiple = options.multiple ?? true;
    if (options.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.append(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
