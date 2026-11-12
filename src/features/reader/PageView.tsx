// Une page du document : rendu net, couche de texte sélectionnable, liens,
// occurrences de recherche et annotations.
import { memo, useEffect, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';
import type { AnnotationRecord, NRect } from '@/db';
import { useT } from '@/i18n';
import { loadPdfjs, type PDFDocumentProxy } from '@/lib/pdfjs';
import { cn } from '@/ui/cn';
import { resolveDest, type PageSize } from './useDocument';

export interface Crop { x: number; y: number; w: number; h: number }
export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

export type ReaderTool = 'none' | 'ink' | 'marker' | 'note';
/** Style du trait en cours ; `marker` : surligneur (large, translucide, couleur pastel). */
export interface InkStyle { color: string; width: number; marker?: boolean }

interface LinkArea { rect: NRect; url?: string; dest?: unknown }

// Plafond de pixels par page : au-delà, les navigateurs mobiles refusent le canvas.
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const MAX_PIXELS = coarse ? 9_000_000 : 20_000_000;

export const inkPath = (stroke: number[][], w: number, h: number): string => {
  if (stroke.length === 0) return '';
  const p = stroke.map(([x, y]) => [x * w, y * h]);
  if (p.length === 1) return `M${p[0][0]} ${p[0][1]}l0.01 0`;
  let d = `M${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
  // Lissage : courbes passant par les milieux des segments.
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2;
    const my = (p[i][1] + p[i + 1][1]) / 2;
    d += `Q${p[i][0].toFixed(2)} ${p[i][1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const last = p[p.length - 1];
  return `${d}L${last[0].toFixed(2)} ${last[1].toFixed(2)}`;
};

/** Texte écrit de haut en bas (page dont le contenu est couché) : le trait de soulignement longe le côté. */
export const isVertical = (r: NRect, size: PageSize): boolean => r.h * size.height > r.w * size.width * 2.5;

export const inkColors: Record<string, string> = {
  yellow: '#e0a800',
  green: '#2f8f46',
  blue: '#2b6fc2',
  pink: '#d6457f',
  black: '#1c2321',
};
export const colorOf = (c: string): string => inkColors[c] ?? c;

/** Couleurs pastel du surligneur. */
export const pastelColors: Record<string, string> = { yellow: '#ffdd57', green: '#8cde96', blue: '#8cc6ff', pink: '#ffa0c8' };
export const pastelOf = (c: string): string => pastelColors[c] ?? c;

interface Props {
  pdf: PDFDocumentProxy;
  page: number;
  size: PageSize;
  /** Pixels CSS par point PDF. */
  scale: number;
  crop: Crop;
  annotations: AnnotationRecord[];
  hits: NRect[][];
  /** Rang de l'occurrence courante dans cette page, ou -1. */
  currentHit: number;
  tool: ReaderTool;
  ink: InkStyle;
  onInk: (page: number, stroke: number[][]) => void;
  onPlaceNote: (page: number, x: number, y: number) => void;
  onOpenAnnotation: (id: string) => void;
  onNavigate: (page: number) => void;
}

export const PageView = memo(function PageView({
  pdf, page, size, scale, crop, annotations, hits, currentHit, tool, ink, onInk, onPlaceNote, onOpenAnnotation, onNavigate,
}: Props) {
  const t = useT();
  const canvasHolder = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<LinkArea[]>([]);
  const [drawing, setDrawing] = useState<number[][] | null>(null);
  const drawingRef = useRef<number[][] | null>(null);

  // Rendu : on garde l'ancien canvas (étiré) tant que le nouveau n'est pas prêt.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const wanted = scale * dpr;
  const capped = Math.min(wanted, Math.sqrt(MAX_PIXELS / (size.width * size.height)));
  const renderScale = Math.round(capped * 20) / 20;
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const timer = setTimeout(async () => {
      try {
        const p = await pdf.getPage(page);
        if (cancelled) return;
        const viewport = p.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.setAttribute('aria-hidden', 'true');
        task = p.render({ canvas, viewport, background: '#ffffff' });
        await task.promise;
        if (cancelled) {
          canvas.width = 0;
          return;
        }
        const holder = canvasHolder.current;
        if (!holder) return;
        const old = holder.firstElementChild as HTMLCanvasElement | null;
        holder.replaceChildren(canvas);
        if (old) old.width = 0;
      } catch {
        /* rendu annulé ou page illisible */
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [pdf, page, renderScale]);

  // Libère la mémoire du canvas quand la page sort de l'écran.
  useEffect(() => {
    const holder = canvasHolder.current;
    return () => {
      const canvas = holder?.firstElementChild as HTMLCanvasElement | null;
      if (canvas) canvas.width = 0;
    };
  }, []);

  // Couche de texte et liens : une seule fois par page, l'échelle passe par une variable CSS.
  useEffect(() => {
    let cancelled = false;
    let layer: { cancel: () => void } | null = null;
    (async () => {
      const [pdfjs, p] = await Promise.all([loadPdfjs(), pdf.getPage(page)]);
      if (cancelled || !textRef.current) return;
      const viewport = p.getViewport({ scale: 1 });
      const textLayer = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: textRef.current, viewport });
      layer = textLayer;
      await textLayer.render();
      if (cancelled) return;
      const annots = (await p.getAnnotations()) as Array<{ subtype: string; rect?: number[]; url?: string; unsafeUrl?: string; dest?: unknown }>;
      if (cancelled) return;
      const areas: LinkArea[] = [];
      for (const a of annots) {
        if (a.subtype !== 'Link' || !a.rect || (!a.url && !a.dest)) continue;
        const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
        const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
        areas.push({
          rect: {
            x: Math.min(x1, x2) / viewport.width,
            y: Math.min(y1, y2) / viewport.height,
            w: Math.abs(x2 - x1) / viewport.width,
            h: Math.abs(y2 - y1) / viewport.height,
          },
          url: a.url,
          dest: a.dest,
        });
      }
      setLinks(areas);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.cancel();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      textRef.current?.replaceChildren();
    };
  }, [pdf, page]);

  const w = size.width * scale;
  const h = size.height * scale;
  const pct = (r: NRect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

  const point = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const box = e.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))];
  };

  return (
    <div
      data-page={page}
      className="relative shrink-0 overflow-hidden rounded-[3px] shadow-soft"
      style={{ width: crop.w * w, height: crop.h * h }}
    >
      <div
        className="pdf-sheet absolute"
        style={
          {
            left: -crop.x * w,
            top: -crop.y * h,
            width: w,
            height: h,
            '--total-scale-factor': scale,
            '--scale-round-x': '1px',
            '--scale-round-y': '1px',
          } as React.CSSProperties
        }
      >
        <div ref={canvasHolder} className="absolute inset-0" />

        {/* Surlignages et occurrences : sous le texte, pour ne pas gêner la sélection. */}
        <div className="absolute inset-0" aria-hidden="true">
          {annotations.map((a) =>
            a.kind === 'highlight'
              ? a.rects?.map((r, i) => <div key={`${a.id}-${i}`} className={cn('hl', `hl-${a.color}`)} style={pct(r)} />)
              : a.kind === 'underline'
                ? a.rects?.map((r, i) => <div key={`${a.id}-${i}`} className={cn('ul', isVertical(r, size) && 'ul-v')} style={{ ...pct(r), color: colorOf(a.color) }} />)
                : null,
          )}
          {/* Surlignage libre : une seule couche translucide, pour que les traits qui se croisent ne foncent pas. */}
          <svg className="marker-layer absolute inset-0 size-full" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
            {annotations.map((a) =>
              a.kind === 'marker'
                ? a.strokes?.map((s, i) => (
                    <path key={`${a.id}-${i}`} d={inkPath(s, size.width, size.height)} fill="none" stroke={pastelOf(a.color)} strokeWidth={a.width ?? 14} strokeLinecap="round" strokeLinejoin="round" />
                  ))
                : null,
            )}
            {drawing && ink.marker && <path d={inkPath(drawing, size.width, size.height)} fill="none" stroke={pastelOf(ink.color)} strokeWidth={ink.width} strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
          {hits.map((rects, i) =>
            rects.map((r, k) => <div key={`${i}-${k}`} className={cn('search-hit', i === currentHit && 'current')} style={pct(r)} />),
          )}
        </div>

        <div ref={textRef} className="textLayer" />

        {links.map((link, i) => (
          <a
            key={i}
            href={link.url ?? '#'}
            target={link.url ? '_blank' : undefined}
            rel={link.url ? 'noopener noreferrer' : undefined}
            aria-label={link.url ?? t('reader.internalLink')}
            className="absolute z-[3] rounded-sm hover:bg-[rgb(60_130_246/0.15)]"
            style={pct(link.rect)}
            onClick={(e) => {
              if (link.url) return;
              e.preventDefault();
              void resolveDest(pdf, link.dest).then((target) => target && onNavigate(target));
            }}
          />
        ))}

        {/* Dessins libres */}
        <svg className="pointer-events-none absolute inset-0 z-[3] size-full" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
          {annotations.map((a) =>
            a.kind === 'ink'
              ? a.strokes?.map((s, i) => (
                  <path key={`${a.id}-${i}`} d={inkPath(s, size.width, size.height)} fill="none" stroke={colorOf(a.color)} strokeWidth={a.width ?? 2} strokeLinecap="round" strokeLinejoin="round" />
                ))
              : null,
          )}
          {drawing && !ink.marker && <path d={inkPath(drawing, size.width, size.height)} fill="none" stroke={colorOf(ink.color)} strokeWidth={ink.width} strokeLinecap="round" strokeLinejoin="round" />}
        </svg>

        {/* Notes : épingles */}
        {annotations.map((a) => {
          const anchor = a.kind === 'note' ? { x: a.x ?? 0, y: a.y ?? 0 } : a.text && a.rects?.[0] ? { x: a.rects[0].x + a.rects[0].w, y: a.rects[0].y } : null;
          if (!anchor) return null;
          return (
            <button
              key={a.id}
              type="button"
              data-annot={a.id}
              aria-label={t('reader.annotations.openNote', { text: (a.text ?? '').slice(0, 60) })}
              onClick={(e) => {
                e.stopPropagation();
                onOpenAnnotation(a.id);
              }}
              className="absolute z-[4] grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
            >
              <span className="grid size-7 place-items-center rounded-full border border-[#8a6d00] bg-[#ffe27a] text-[#5c4700] shadow-soft">
                <StickyNote className="size-4" aria-hidden="true" />
              </span>
            </button>
          );
        })}

        {/* Capture des gestes pendant un dessin ou la pose d'une note */}
        {tool !== 'none' && (
          <div
            className={cn('absolute inset-0 z-[5]', tool === 'note' ? 'cursor-copy' : 'cursor-crosshair touch-none')}
            onClick={(e) => {
              e.stopPropagation();
              if (tool === 'note') onPlaceNote(page, ...point(e));
            }}
            onPointerDown={(e) => {
              if (tool === 'note' || (e.pointerType === 'mouse' && e.button !== 0)) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drawingRef.current = [point(e)];
              setDrawing(drawingRef.current);
            }}
            onPointerMove={(e) => {
              if (!drawingRef.current) return;
              const [x, y] = point(e);
              const last = drawingRef.current[drawingRef.current.length - 1];
              if (Math.hypot((x - last[0]) * w, (y - last[1]) * h) < 1.5) return;
              drawingRef.current = [...drawingRef.current, [x, y]];
              setDrawing(drawingRef.current);
            }}
            onPointerUp={() => {
              const stroke = drawingRef.current;
              drawingRef.current = null;
              setDrawing(null);
              if (stroke && stroke.length > 0) onInk(page, stroke);
            }}
            onPointerCancel={() => {
              drawingRef.current = null;
              setDrawing(null);
            }}
          />
        )}
      </div>
    </div>
  );
});
