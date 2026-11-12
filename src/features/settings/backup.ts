// Sauvegarde complète de la bibliothèque (fichiers, annotations, marque-pages,
// étagères, signatures) dans une archive ZIP, et restauration sur un autre appareil.
import { db, type AnnotationRecord, type BookmarkRecord, type FileRecord, type ShelfRecord, type SignatureRecord } from '@/db';
import { unzipBytes, zipEntries, type ZipEntry } from '@/core/zip';
import { downloadBlob } from '@/features/export/actions';

interface Manifest {
  app: 'pidielf';
  version: 1;
  exportedAt: string;
  files: FileRecord[];
  annotations: AnnotationRecord[];
  bookmarks: BookmarkRecord[];
  shelves: ShelfRecord[];
  signatures: Array<Omit<SignatureRecord, 'blob'>>;
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

export async function buildBackup(): Promise<Uint8Array> {
  const [files, annotations, bookmarks, shelves, signatures] = await Promise.all([
    db.files.toArray(),
    db.annotations.toArray(),
    db.bookmarks.toArray(),
    db.shelves.toArray(),
    db.signatures.toArray(),
  ]);
  const manifest: Manifest = {
    app: 'pidielf',
    version: 1,
    exportedAt: new Date().toISOString(),
    files,
    annotations,
    bookmarks,
    shelves,
    signatures: signatures.map(({ blob: _blob, ...rest }) => rest),
  };
  const entries: ZipEntry[] = [{ name: 'pidielf.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }];
  for (const file of files) {
    const blob = await db.blobs.get(file.id);
    if (blob) entries.push({ name: `files/${file.id}`, data: await bytesOf(blob.blob) });
    const cover = await db.covers.get(file.id);
    if (cover) entries.push({ name: `covers/${file.id}`, data: await bytesOf(cover.blob) });
  }
  for (const signature of signatures) entries.push({ name: `signatures/${signature.id}`, data: await bytesOf(signature.blob) });
  return zipEntries(entries);
}

export async function exportBackup(): Promise<void> {
  const data = await buildBackup();
  const name = `pidielf-sauvegarde-${new Date().toISOString().slice(0, 10)}.zip`;
  await downloadBlob(name, new Blob([data as BlobPart], { type: 'application/zip' }));
}

/** Restaure une sauvegarde sans rien écraser : les éléments déjà présents sont conservés. Renvoie le nombre de fichiers ajoutés. */
export async function restoreBackup(archive: Blob): Promise<number> {
  const entries = await unzipBytes(await bytesOf(archive));
  const raw = entries['pidielf.json'];
  if (!raw) throw new Error('Archive sans manifeste');
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as Manifest;
  if (manifest.app !== 'pidielf') throw new Error('Archive inconnue');

  let added = 0;
  await db.transaction('rw', [db.files, db.blobs, db.covers, db.annotations, db.bookmarks, db.shelves, db.signatures], async () => {
    for (const file of manifest.files ?? []) {
      const data = entries[`files/${file.id}`];
      if (!data || (await db.files.get(file.id))) continue;
      await db.files.add(file);
      await db.blobs.put({ id: file.id, blob: new Blob([data as BlobPart], { type: file.mime || 'application/pdf' }) });
      const cover = entries[`covers/${file.id}`];
      if (cover) await db.covers.put({ id: file.id, blob: new Blob([cover as BlobPart]) });
      added++;
    }
    for (const shelf of manifest.shelves ?? []) if (!(await db.shelves.get(shelf.id))) await db.shelves.add(shelf);
    for (const a of manifest.annotations ?? []) if (!(await db.annotations.get(a.id))) await db.annotations.add(a);
    for (const b of manifest.bookmarks ?? []) if (!(await db.bookmarks.get(b.id))) await db.bookmarks.add(b);
    for (const s of manifest.signatures ?? []) {
      const data = entries[`signatures/${s.id}`];
      if (data && !(await db.signatures.get(s.id))) await db.signatures.add({ ...s, blob: new Blob([data as BlobPart], { type: 'image/png' }) });
    }
  });
  return added;
}
