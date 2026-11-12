// Opérations sur la bibliothèque.
import { db, newId, type FileRecord, type ToolId } from './index';

export interface NewFile {
  name: string;
  blob: Blob;
  pageCount: number;
  cover?: Blob | null;
  origin?: 'import' | 'tool';
  tool?: ToolId;
  parentId?: string;
  encrypted?: boolean;
}

export async function addFile(input: NewFile): Promise<FileRecord> {
  const record: FileRecord = {
    id: newId(),
    name: input.name,
    size: input.blob.size,
    mime: input.blob.type || 'application/pdf',
    pageCount: input.pageCount,
    addedAt: Date.now(),
    shelves: [],
    origin: input.origin ?? 'import',
    tool: input.tool,
    parentId: input.parentId,
    encrypted: input.encrypted,
  };
  await db.transaction('rw', db.files, db.blobs, db.covers, async () => {
    await db.files.add(record);
    await db.blobs.add({ id: record.id, blob: input.blob });
    if (input.cover) await db.covers.add({ id: record.id, blob: input.cover });
  });
  return record;
}

export async function getFileBlob(id: string): Promise<Blob | undefined> {
  return (await db.blobs.get(id))?.blob;
}

export async function findDuplicate(name: string, size: number): Promise<FileRecord | undefined> {
  return db.files.where('name').equals(name).and((f) => f.size === size).first();
}

export async function renameFile(id: string, name: string): Promise<void> {
  await db.files.update(id, { name });
}

export async function duplicateFile(id: string, copyName: string): Promise<FileRecord | undefined> {
  const [file, blob, cover] = await Promise.all([db.files.get(id), db.blobs.get(id), db.covers.get(id)]);
  if (!file || !blob) return undefined;
  return addFile({
    name: copyName,
    blob: blob.blob,
    pageCount: file.pageCount,
    cover: cover?.blob,
    origin: file.origin,
    tool: file.tool,
    parentId: file.parentId,
    encrypted: file.encrypted,
  });
}

export async function deleteFiles(ids: string[]): Promise<void> {
  await db.transaction('rw', [db.files, db.blobs, db.covers, db.annotations, db.bookmarks], async () => {
    await db.files.bulkDelete(ids);
    await db.blobs.bulkDelete(ids);
    await db.covers.bulkDelete(ids);
    await db.annotations.where('fileId').anyOf(ids).delete();
    await db.bookmarks.where('fileId').anyOf(ids).delete();
  });
}

export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  await db.files.update(id, { favorite });
}

export async function saveProgress(id: string, page: number, pageCount: number): Promise<void> {
  await db.files.update(id, {
    page,
    progress: pageCount <= 1 ? 1 : (page - 1) / (pageCount - 1),
    openedAt: Date.now(),
  });
}

export async function setShelves(ids: string[], shelfId: string, member: boolean): Promise<void> {
  await db.transaction('rw', db.files, async () => {
    for (const id of ids) {
      const file = await db.files.get(id);
      if (!file) continue;
      const shelves = new Set(file.shelves);
      if (member) shelves.add(shelfId);
      else shelves.delete(shelfId);
      await db.files.update(id, { shelves: [...shelves] });
    }
  });
}

export async function createShelf(name: string): Promise<string> {
  const id = newId();
  await db.shelves.add({ id, name, createdAt: Date.now() });
  return id;
}

export async function deleteShelf(id: string): Promise<void> {
  await db.transaction('rw', db.files, db.shelves, async () => {
    await db.shelves.delete(id);
    const members = await db.files.where('shelves').equals(id).toArray();
    for (const f of members) await db.files.update(f.id, { shelves: f.shelves.filter((s) => s !== id) });
  });
}

export type ReadState = 'unread' | 'reading' | 'done';
export function readState(file: FileRecord): ReadState {
  if (!file.openedAt) return 'unread';
  if ((file.progress ?? 0) >= 0.999) return 'done';
  return 'reading';
}
