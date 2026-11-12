// Données du document ouvert dans le lecteur : tailles des pages, texte, sommaire.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPageText, toRuns, type PageText, type RawTextItem } from '@/core/text';
import type { PDFDocumentProxy } from '@/lib/pdfjs';

export interface PageSize { width: number; height: number }

/**
 * Tailles des pages (en points, rotation comprise). On affiche tout de suite en
 * supposant que toutes les pages ont la taille de la première, puis on corrige
 * au fil de l'eau : un document de 500 pages s'ouvre sans attendre.
 */
export function usePageSizes(pdf: PDFDocumentProxy): PageSize[] {
  const [sizes, setSizes] = useState<PageSize[]>([]);
  useEffect(() => {
    let cancelled = false;
    const count = pdf.numPages;
    const known: PageSize[] = [];
    (async () => {
      const first = await pdf.getPage(1);
      const v = first.getViewport({ scale: 1 });
      const base = { width: v.width, height: v.height };
      for (let i = 0; i < count; i++) known[i] = base;
      if (cancelled) return;
      setSizes([...known]);
      let changed = false;
      for (let i = 2; i <= count; i++) {
        const page = await pdf.getPage(i);
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        if (Math.abs(vp.width - base.width) > 0.5 || Math.abs(vp.height - base.height) > 0.5) {
          known[i - 1] = { width: vp.width, height: vp.height };
          changed = true;
        }
        // Par paquets, pour ne pas provoquer un rendu à chaque page.
        if (changed && (i % 40 === 0 || i === count)) {
          setSizes([...known]);
          changed = false;
        }
        if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pdf]);
  return sizes;
}

/** Texte des pages, extrait à la demande et gardé en mémoire. */
export class TextCache {
  private cache = new Map<number, Promise<PageText>>();
  constructor(private pdf: PDFDocumentProxy) {}

  get(page: number): Promise<PageText> {
    let entry = this.cache.get(page);
    if (!entry) {
      entry = (async () => {
        const p = await this.pdf.getPage(page);
        const content = await p.getTextContent();
        const viewport = p.getViewport({ scale: 1 });
        const items = content.items.filter((it): it is typeof it & RawTextItem => 'str' in it) as unknown as RawTextItem[];
        return buildPageText(toRuns(items, viewport));
      })();
      this.cache.set(page, entry);
      entry.catch(() => this.cache.delete(page));
    }
    return entry;
  }
}

export function useTextCache(pdf: PDFDocumentProxy): TextCache {
  return useMemo(() => new TextCache(pdf), [pdf]);
}

export interface OutlineNode {
  title: string;
  page: number | null;
  children: OutlineNode[];
}

type RawOutline = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;

export async function resolveDest(pdf: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[] | null);
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0];
    if (typeof ref === 'number') return ref + 1;
    if (ref && typeof ref === 'object') return (await pdf.getPageIndex(ref as never)) + 1;
    return null;
  } catch {
    return null;
  }
}

async function buildOutline(pdf: PDFDocumentProxy, items: RawOutline): Promise<OutlineNode[]> {
  const nodes: OutlineNode[] = [];
  for (const item of items ?? []) {
    nodes.push({
      title: item.title?.trim() || '—',
      page: await resolveDest(pdf, item.dest),
      children: await buildOutline(pdf, item.items as RawOutline),
    });
  }
  return nodes;
}

/** Sommaire tiré des signets du PDF (null tant qu'il n'est pas lu, [] s'il n'y en a pas). */
export function useOutline(pdf: PDFDocumentProxy): OutlineNode[] | null {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    pdf
      .getOutline()
      .then((items) => buildOutline(pdf, items))
      .then((nodes) => !cancelled && setOutline(nodes))
      .catch(() => !cancelled && setOutline([]));
    return () => {
      cancelled = true;
    };
  }, [pdf]);
  return outline;
}

/** Estimation du nombre de mots par page, sur un échantillon de pages. */
export function useWordsPerPage(pdf: PDFDocumentProxy, texts: TextCache): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const count = pdf.numPages;
      const sample = [...new Set([2, 3, 5, 8, Math.ceil(count / 2), count - 1].map((p) => Math.min(count, Math.max(1, p))))];
      let words = 0;
      for (const p of sample) {
        const text = await texts.get(p);
        words += text.text.split(/\s+/).filter((w) => w.length > 1).length;
        if (cancelled) return;
      }
      setValue(words / sample.length);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pdf, texts]);
  return value;
}

/** Garde une valeur à jour dans une référence, pour les écouteurs d'événements. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
