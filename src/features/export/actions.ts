// Actions d'export communes à l'écran de résultat et à la fiche d'un fichier.
import { zipEntries } from '@/core/zip';

export interface NamedBlob { name: string; blob: Blob }

interface SaveFilePicker {
  (options: { suggestedName: string; types?: Array<{ description?: string; accept: Record<string, string[]> }> }): Promise<FileSystemFileHandle>;
}

const mimeFor = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    { pdf: 'application/pdf', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', md: 'text/markdown' }[
      ext ?? ''
    ] ?? 'application/octet-stream'
  );
};

/**
 * Télécharge un fichier. Sur bureau compatible, ouvre « Enregistrer sous » ;
 * sinon, téléchargement classique. Renvoie false si l'utilisateur annule.
 */
export async function downloadBlob(name: string, blob: Blob): Promise<boolean> {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  const desktop = !matchMedia('(pointer: coarse)').matches;
  if (picker && desktop && window.self === window.top) {
    try {
      const ext = name.includes('.') ? `.${name.split('.').pop()}` : '';
      const handle = await picker({
        suggestedName: name,
        types: ext ? [{ accept: { [mimeFor(name)]: [ext] } }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return false;
      // Autre erreur (droits, navigateur) : on retombe sur le téléchargement classique.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

const toFile = (item: NamedBlob): File => new File([item.blob], item.name, { type: item.blob.type || mimeFor(item.name) });

/** Vrai si le navigateur sait partager des fichiers (feuille de partage du système). */
export function canShareFiles(items: NamedBlob[] = [{ name: 'a.pdf', blob: new Blob([''], { type: 'application/pdf' }) }]): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: items.map(toFile) });
  } catch {
    return false;
  }
}

export async function shareFiles(items: NamedBlob[]): Promise<boolean> {
  try {
    await navigator.share({ files: items.map(toFile), title: items.length === 1 ? items[0].name : undefined });
    return true;
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return false;
    throw err;
  }
}

export async function zipBlobs(items: NamedBlob[]): Promise<Blob> {
  const entries = await Promise.all(
    items.map(async (item) => ({ name: item.name, data: new Uint8Array(await item.blob.arrayBuffer()) })),
  );
  const data = await zipEntries(entries);
  return new Blob([data as BlobPart], { type: 'application/zip' });
}
