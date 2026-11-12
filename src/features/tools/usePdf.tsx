// Aperçus pour les outils : ouverture d'un PDF et miniatures de pages,
// rendues seulement quand elles deviennent visibles.
import { useEffect, useRef, useState } from 'react';
import { openPdf, type PDFDocumentProxy } from '@/lib/pdfjs';
import { cn } from '@/ui/cn';

/** Ouvre un PDF avec pdf.js ; le referme quand le composant disparaît. */
export function usePdf(blob: Blob | null | undefined): PDFDocumentProxy | null {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (!blob) {
      setPdf(null);
      return;
    }
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    openPdf(blob)
      .then((doc) => {
        opened = doc;
        if (cancelled) void doc.loadingTask.destroy();
        else setPdf(doc);
      })
      .catch(() => setPdf(null));
    return () => {
      cancelled = true;
      setPdf(null);
      void opened?.loadingTask.destroy();
    };
  }, [blob]);
  return pdf;
}

// File d'attente : deux rendus à la fois, pour ne pas bloquer un téléphone.
const queue: Array<() => Promise<void>> = [];
let running = 0;
function schedule(task: () => Promise<void>): void {
  queue.push(task);
  pump();
}
function pump(): void {
  while (running < 2 && queue.length > 0) {
    const task = queue.shift()!;
    running++;
    void task().finally(() => {
      running--;
      pump();
    });
  }
}

export interface PageSize { width: number; height: number }

/** Taille d'une page en points, rotation comprise. */
export function usePageSize(pdf: PDFDocumentProxy | null, pageNumber: number): PageSize | null {
  const [size, setSize] = useState<PageSize | null>(null);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void pdf.getPage(pageNumber).then((page) => {
      const v = page.getViewport({ scale: 1 });
      if (!cancelled) setSize({ width: v.width, height: v.height });
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);
  return size;
}

/**
 * Miniature d'une page. `rotate` ajoute une rotation d'aperçu (en degrés) sans
 * relancer le rendu. `width` est la largeur de rendu en pixels CSS.
 */
export function PageThumb({
  pdf,
  page,
  width = 160,
  rotate = 0,
  className,
  onSize,
}: {
  pdf: PDFDocumentProxy | null;
  page: number;
  width?: number;
  rotate?: number;
  className?: string;
  onSize?: (size: PageSize) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(1.414);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !visible) return;
    let cancelled = false;
    setReady(false);
    schedule(async () => {
      if (cancelled) return;
      try {
        const p = await pdf.getPage(page);
        const base = p.getViewport({ scale: 1 });
        if (cancelled) return;
        setRatio(base.height / base.width);
        onSize?.({ width: base.width, height: base.height });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = p.getViewport({ scale: (width / base.width) * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await p.render({ canvas, viewport, background: '#ffffff' }).promise;
        if (!cancelled) setReady(true);
      } catch {
        /* page illisible : la vignette reste vide */
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, page, visible, width]);

  const quarter = ((rotate % 360) + 360) % 180 === 90;
  return (
    <div
      ref={holder}
      className={cn('relative grid place-items-center overflow-hidden', className)}
      style={{ aspectRatio: quarter ? `${ratio} / 1` : `1 / ${ratio}` }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn('bg-white shadow-soft transition-[transform,opacity] duration-200', ready ? 'opacity-100' : 'opacity-0')}
        style={{
          width: quarter ? `${ratio * 100}%` : '100%',
          transform: rotate ? `rotate(${rotate}deg)` : undefined,
        }}
      />
      {!ready && <div className="absolute inset-0 animate-pulse rounded-sm bg-surface-2" aria-hidden="true" />}
    </div>
  );
}
