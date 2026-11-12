// Base locale (IndexedDB) : fichiers, couvertures, annotations, marque-pages,
// étagères et signatures. Rien ne quitte l'appareil.
import Dexie, { type EntityTable } from 'dexie';

export type ToolId =
  | 'fusionner' | 'diviser' | 'organiser' | 'pivoter'
  | 'compresser' | 'ocr'
  | 'pdf-en-images' | 'images-en-pdf' | 'scanner'
  | 'editer' | 'filigrane' | 'numeros'
  | 'signer' | 'proteger' | 'deverrouiller'
  | 'annotations';

export interface FileRecord {
  id: string;
  name: string;
  size: number;
  mime: string;
  pageCount: number;
  addedAt: number;
  openedAt?: number;
  /** Dernière page lue (à partir de 1). */
  page?: number;
  /** Progression de lecture, de 0 à 1. */
  progress?: number;
  favorite?: boolean;
  shelves: string[];
  origin: 'import' | 'tool';
  tool?: ToolId;
  /** Fichier d'origine dont celui-ci est une version dérivée. */
  parentId?: string;
  encrypted?: boolean;
}

export interface BlobRecord { id: string; blob: Blob }

/** Coordonnées normalisées (0 à 1) dans la page telle qu'affichée, origine en haut à gauche. */
export interface NRect { x: number; y: number; w: number; h: number }

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface AnnotationRecord {
  id: string;
  fileId: string;
  page: number;
  createdAt: number;
  /** `marker` : surlignage libre, tracé au surligneur ; `ink` : dessin au trait. */
  kind: 'highlight' | 'underline' | 'note' | 'ink' | 'marker';
  color: HighlightColor | string;
  /** Surlignage, soulignement : rectangles couvrant le texte. */
  rects?: NRect[];
  /** Texte sélectionné (surlignage) pour la liste et l'export. */
  quote?: string;
  /** Contenu de la note (note libre, ou commentaire attaché à un surlignage). */
  text?: string;
  /** Note libre : position de l'épingle. */
  x?: number;
  y?: number;
  /** Dessin libre : traits, chacun étant une suite de points [x, y]. */
  strokes?: number[][][];
  /** Épaisseur du trait, en points PDF. */
  width?: number;
}

export interface BookmarkRecord { id: string; fileId: string; page: number; createdAt: number }
export interface ShelfRecord { id: string; name: string; createdAt: number }
export interface SignatureRecord {
  id: string;
  kind: 'signature' | 'initials';
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

export class PidiElfDB extends Dexie {
  files!: EntityTable<FileRecord, 'id'>;
  blobs!: EntityTable<BlobRecord, 'id'>;
  covers!: EntityTable<BlobRecord, 'id'>;
  annotations!: EntityTable<AnnotationRecord, 'id'>;
  bookmarks!: EntityTable<BookmarkRecord, 'id'>;
  shelves!: EntityTable<ShelfRecord, 'id'>;
  signatures!: EntityTable<SignatureRecord, 'id'>;

  constructor() {
    super('pidielf');
    this.version(1).stores({
      files: 'id, name, addedAt, openedAt, parentId, *shelves',
      blobs: 'id',
      covers: 'id',
      annotations: 'id, fileId, [fileId+page]',
      bookmarks: 'id, fileId',
      shelves: 'id, name',
      signatures: 'id, createdAt',
    });
  }
}

export const db = new PidiElfDB();

export const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** « Tout effacer » : bibliothèque, annotations, signatures. */
export async function wipeDatabase(): Promise<void> {
  await db.delete();
  await db.open();
}
