// Aperçu en direct d'une page, avec un calque dessiné par-dessus (filigrane,
// numéro de page) dans les mêmes unités que le PDF : des points.
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '@/i18n';
import type { PDFDocumentProxy } from '@/lib/pdfjs';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { FONT_CSS, type StampFont } from '@/core/pdf/watermarkLayout';
import { PageThumb, usePageSize, type PageSize } from '../usePdf';

let ruler: CanvasRenderingContext2D | null = null;

/** Largeur d'un texte en points, mesurée avec la police d'écran équivalente à la police du PDF. */
export function previewTextWidth(text: string, font: StampFont, bold: boolean, size: number): number {
  ruler ??= document.createElement('canvas').getContext('2d');
  if (!ruler) return text.length * size * 0.55;
  ruler.font = `${bold ? 'bold ' : ''}100px ${FONT_CSS[font]}`;
  return (ruler.measureText(text).width * size) / 100;
}

const WIDE = '(min-width: 1024px)';

/** Vrai quand l'aperçu et les réglages tiennent côte à côte (même seuil que ToolLayout). */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const query = matchMedia(WIDE);
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

/**
 * Sur un petit écran, l'aperçu se range en tête du panneau de réglages et y
 * reste accroché : on voit l'effet de chaque réglage sans remonter la page.
 */
export function StickyPreview({ children }: { children: ReactNode }) {
  return <div className="sticky top-0 z-10 -mx-4 -mt-4 rounded-t-xl border-b border-line bg-surface px-2 py-3">{children}</div>;
}

export function PagePreview({
  pdf,
  pageCount,
  page,
  onPage,
  compact,
  caption,
  children,
}: {
  pdf: PDFDocumentProxy | null;
  pageCount: number;
  page: number;
  onPage: (page: number) => void;
  /** Aperçu réduit, pour rester visible au-dessus des réglages sur un téléphone. */
  compact?: boolean;
  /** Précision affichée sous la page (ce que cette page reçoit). */
  caption?: string;
  /** Contenu SVG du calque ; le repère est celui de la page affichée, en points, origine en haut à gauche. */
  children: (size: PageSize) => ReactNode;
}) {
  const t = useT();
  const size = usePageSize(pdf, page);
  const ratio = size ? size.width / size.height : 1 / 1.414;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex w-full items-center justify-center gap-1">
        <IconButton label={t('filigrane.previous')} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </IconButton>
        {/* La largeur découle de la hauteur disponible : une page en portrait ne déborde jamais de l'écran. */}
        <div className="flex min-w-0 flex-1 justify-center">
          <div
            className="relative overflow-hidden rounded-sm border border-line bg-white shadow-soft"
            style={{ width: `min(100%, calc(${compact ? '30vh' : 'min(68vh, 44rem)'} * ${ratio}))` }}
          >
            <PageThumb pdf={pdf} page={page} width={compact ? 280 : 560} />
            {size && (
              <svg viewBox={`0 0 ${size.width} ${size.height}`} className="absolute inset-0 size-full" aria-hidden="true">
                {children(size)}
              </svg>
            )}
          </div>
        </div>
        <IconButton label={t('filigrane.next')} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </IconButton>
      </div>
      <p className={cn('text-center text-ink-soft', compact ? 'text-xs' : 'text-sm')} aria-live="polite">
        <span className="font-bold tabular-nums">{t('tools.pageOf', { n: page, total: pageCount })}</span>
        {caption && <span> · {caption}</span>}
      </p>
    </div>
  );
}
