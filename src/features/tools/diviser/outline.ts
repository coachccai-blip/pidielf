// Lecture du sommaire d'un PDF avec pdf.js : titre et première page de chaque chapitre.
import { chapterLevel, type Chapter } from '@/core/splitPlan';
import type { PDFDocumentProxy } from '@/lib/pdfjs';

type OutlineSource = Pick<PDFDocumentProxy, 'getOutline' | 'getDestination' | 'getPageIndex'>;

/** Chapitres du sommaire ; liste vide si le PDF n'en a pas ou s'il est illisible. */
export async function readChapters(pdf: OutlineSource): Promise<Chapter[]> {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline || outline.length === 0) return [];
  const chapters: Chapter[] = [];
  for (const item of chapterLevel(outline)) {
    try {
      // Une destination est soit nommée, soit explicite : [page, mode d'affichage, …].
      const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
      const target: unknown = dest?.[0];
      const index = typeof target === 'number' ? target : target && typeof target === 'object' ? await pdf.getPageIndex(target as Parameters<OutlineSource['getPageIndex']>[0]) : null;
      if (index !== null) chapters.push({ title: item.title, page: index + 1 });
    } catch {
      /* destination cassée : l'entrée est ignorée, les autres restent utilisables */
    }
  }
  return chapters;
}
