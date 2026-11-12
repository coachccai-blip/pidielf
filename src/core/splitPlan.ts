// Plan de découpe de l'outil « Diviser » : quelles pages vont dans quel fichier,
// et comment ces fichiers s'appellent. Fonctions pures, sans PDF ni DOM.
import { padNumber, sanitizeFileName, suggestName, uniqueNames } from './naming';
import { chunkRanges, parseRanges, type PageRange } from './ranges';

export type SplitMode = 'ranges' | 'every' | 'single' | 'chapters';

/** Entrée du sommaire : titre et première page (à partir de 1). */
export interface Chapter { title: string; page: number }

/** Un fichier à produire : pages `from` à `to` incluses, avec le titre du chapitre s'il y en a un. */
export interface SplitPart extends PageRange { title?: string }

/** Au-delà, on prévient avant de produire autant de fichiers. */
export const MANY_PARTS = 200;

/**
 * Niveau du sommaire qui sert de chapitres. Beaucoup de PDF n'ont qu'une entrée
 * racine (le titre du document) : on descend alors jusqu'au premier niveau qui en compte plusieurs.
 */
export function chapterLevel<T extends { items?: T[] }>(outline: T[]): T[] {
  let level = outline;
  while (level.length === 1 && level[0].items && level[0].items.length > 0) level = level[0].items;
  return level;
}

/**
 * Chapitres → parties. Les débuts de chapitre sont triés et dédoublonnés (le
 * premier titre l'emporte) ; les pages qui précèdent le premier chapitre
 * forment leur propre partie, sans titre.
 */
export function chapterParts(chapters: Chapter[], pageCount: number): SplitPart[] {
  const starts = new Map<number, string>();
  for (const c of chapters) {
    if (!Number.isInteger(c.page) || c.page < 1 || c.page > pageCount) continue;
    if (!starts.has(c.page)) starts.set(c.page, c.title.trim());
  }
  const pages = [...starts.keys()].sort((a, b) => a - b);
  if (pages.length === 0) return [];
  const parts: SplitPart[] = pages[0] > 1 ? [{ from: 1, to: pages[0] - 1 }] : [];
  pages.forEach((from, i) => {
    const to = i + 1 < pages.length ? pages[i + 1] - 1 : pageCount;
    parts.push({ from, to, title: starts.get(from) || undefined });
  });
  return parts;
}

/** Un sommaire n'est exploitable que s'il découpe réellement le document. */
export const hasUsableChapters = (chapters: Chapter[], pageCount: number): boolean => chapterParts(chapters, pageCount).length >= 2;

export interface SplitOptions {
  mode: SplitMode;
  pageCount: number;
  /** Saisie libre du mode « plages ». */
  ranges?: string;
  /** Taille des paquets du mode « toutes les N pages ». */
  every?: number;
  chapters?: Chapter[];
}

/** Parties à produire, ou null si les réglages ne sont pas valides. */
export function buildParts(options: SplitOptions): SplitPart[] | null {
  const { mode, pageCount } = options;
  if (pageCount < 1) return null;
  if (mode === 'ranges') return parseRanges(options.ranges ?? '', pageCount);
  if (mode === 'every') {
    const every = options.every ?? 0;
    return Number.isInteger(every) && every >= 1 ? chunkRanges(pageCount, every) : null;
  }
  if (mode === 'single') return chunkRanges(pageCount, 1);
  const parts = chapterParts(options.chapters ?? [], pageCount);
  return parts.length >= 2 ? parts : null;
}

/** Découpe proposée à l'ouverture du mode « plages » : deux moitiés. */
export function defaultRangesText(pageCount: number): string {
  if (pageCount < 2) return '1';
  const half = Math.ceil(pageCount / 2);
  return `${formatRange({ from: 1, to: half })}, ${formatRange({ from: half + 1, to: pageCount })}`;
}

export const partSize = (part: PageRange): number => part.to - part.from + 1;

/** « 4-6 », ou « 4 » pour une seule page. */
export const formatRange = (part: PageRange): string => (part.from === part.to ? `${part.from}` : `${part.from}-${part.to}`);

/** Pages qui ne figurent dans aucune partie (possible seulement avec des plages libres). */
export function uncoveredPages(parts: PageRange[], pageCount: number): number[] {
  const covered = new Uint8Array(pageCount + 1);
  for (const p of parts) covered.fill(1, Math.max(1, p.from), Math.min(pageCount, p.to) + 1);
  const out: number[] = [];
  for (let page = 1; page <= pageCount; page++) if (!covered[page]) out.push(page);
  return out;
}

/** Vrai si la découpe redonne simplement le document entier. */
export const isWholeDocument = (parts: PageRange[], pageCount: number): boolean =>
  parts.length === 1 && parts[0].from === 1 && parts[0].to === pageCount;

/** Titre de chapitre utilisable dans un nom de fichier, ou chaîne vide. */
function titleSlug(title: string | undefined): string {
  if (!title) return '';
  const clean = sanitizeFileName(title.replace(/[._]+/g, ' '));
  // sanitizeFileName renvoie « document » pour un titre vide : ce n'est pas un titre.
  return title.replace(/[\\/:*?"<>|._\s\u0000-\u001f]/g, '') ? clean.slice(0, 60).trim() : '';
}

/**
 * Noms des fichiers produits : « rapport_partie-01.pdf ». Avec `useTitles`, une
 * partie titrée prend le nom de son chapitre : « rapport_02-Introduction.pdf ».
 * Le numéro reste en tête pour garder l'ordre du document dans un dossier.
 */
export function partNames(original: string, parts: SplitPart[], suffix: string, useTitles = false): string[] {
  const total = parts.length;
  return uniqueNames(
    parts.map((part, i) => {
      const n = padNumber(i + 1, total);
      const slug = useTitles ? titleSlug(part.title) : '';
      return suggestName(original, slug ? `${n}-${slug}` : `${suffix}-${n}`);
    }),
  );
}
