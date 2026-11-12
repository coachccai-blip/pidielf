// Mode Page : le PDF tel quel, avec défilement continu ou page par page,
// double page, zoom (pincement, double appui, molette), rognage des marges.
// Seules les pages visibles et leurs voisines sont rendues.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationRecord, NRect } from '@/db';
import type { SearchHit } from '@/core/text';
import { renderPage, type PDFDocumentProxy } from '@/lib/pdfjs';
import type { ReaderPrefs } from '@/lib/settings';
import { cn } from '@/ui/cn';
import { FULL, PageView, type Crop, type InkStyle, type ReaderTool } from './PageView';
import { useLatest, type PageSize, type TextCache } from './useDocument';

export interface PageModeHandle {
  goTo: (page: number) => void;
  turn: (delta: 1 | -1) => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
}

interface Props {
  pdf: PDFDocumentProxy;
  sizes: PageSize[];
  texts: TextCache;
  prefs: ReaderPrefs;
  initialPage: number;
  annotations: Map<number, AnnotationRecord[]>;
  hits: SearchHit[];
  currentHit: SearchHit | null;
  tool: ReaderTool;
  ink: InkStyle;
  onPage: (page: number) => void;
  onZoom: (zoom: number) => void;
  onTap: (zone: 'left' | 'center' | 'right') => void;
  onInk: (page: number, stroke: number[][]) => void;
  onPlaceNote: (page: number, x: number, y: number) => void;
  onOpenAnnotation: (id: string) => void;
}

interface Row { pages: number[]; top: number; left: number; width: number; height: number; scale: number }
interface Layout { rows: Row[]; width: number; height: number; rowOf: number[] }
interface Anchor { row: number; fy: number; vy: number; cx: number; vx: number; left?: (row: Row) => number }

const GAP = 12;
const MAX_PAGE_WIDTH = 980;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const EMPTY_ANNOTATIONS: AnnotationRecord[] = [];
const EMPTY_HITS: NRect[][] = [];

/** Cadre du contenu d'une page, mesuré sur un rendu basse définition. */
async function contentBox(pdf: PDFDocumentProxy, pageNumber: number): Promise<Crop | null> {
  const page = await pdf.getPage(pageNumber);
  const canvas = await renderPage(page, { width: 110 });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < 238 || data[i + 1] < 238 || data[i + 2] < 238) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  canvas.width = 0;
  if (maxX < 0) return null;
  return { x: minX / width, y: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height };
}

/** Rognage commun au document : l'union des cadres d'un échantillon de pages, pour ne jamais couper de contenu. */
function useCrop(pdf: PDFDocumentProxy, enabled: boolean): Crop {
  const [crop, setCrop] = useState<Crop>(FULL);
  useEffect(() => {
    if (!enabled) {
      setCrop(FULL);
      return;
    }
    let cancelled = false;
    (async () => {
      const count = pdf.numPages;
      const sample = new Set<number>();
      for (let i = 1; i <= Math.min(6, count); i++) sample.add(i);
      for (let i = 1; i <= 8; i++) sample.add(Math.max(1, Math.round((count * i) / 9)));
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of sample) {
        const box = await contentBox(pdf, p).catch(() => null);
        if (cancelled) return;
        if (!box) continue;
        x0 = Math.min(x0, box.x);
        y0 = Math.min(y0, box.y);
        x1 = Math.max(x1, box.x + box.w);
        y1 = Math.max(y1, box.y + box.h);
      }
      if (x1 <= x0 || y1 <= y0) return;
      const pad = 0.02;
      const x = Math.max(0, x0 - pad);
      const y = Math.max(0, y0 - pad);
      setCrop({ x, y, w: Math.min(1, x1 + pad) - x, h: Math.min(1, y1 + pad) - y });
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, enabled]);
  return crop;
}

export const PageMode = forwardRef<PageModeHandle, Props>(function PageMode(
  { pdf, sizes, texts, prefs, initialPage, annotations, hits, currentHit, tool, ink, onPage, onZoom, onTap, onInk, onPlaceNote, onOpenAnnotation },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  const [current, setCurrent] = useState(Math.max(1, initialPage));
  const anchor = useRef<Anchor | null>(null);
  const ready = useRef(false);
  const paged = prefs.scroll === 'paged';
  const spread = prefs.spread && box.w >= 900;
  const cropAll = useCrop(pdf, prefs.cropMargins);
  const pad = box.w < 640 ? 8 : 20;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => onZoom(zoom), [zoom, onZoom]);

  // Le rognage ne s'applique qu'aux pages de même format que la première.
  const cropOf = useCallback(
    (index: number): Crop => {
      const s = sizes[index];
      const ref0 = sizes[0];
      if (!s || !ref0 || cropAll === FULL) return FULL;
      return Math.abs(s.width - ref0.width) < 2 && Math.abs(s.height - ref0.height) < 2 ? cropAll : FULL;
    },
    [sizes, cropAll],
  );

  const layout = useMemo<Layout>(() => {
    const rows: Row[] = [];
    const rowOf: number[] = [];
    if (sizes.length === 0 || box.w === 0) return { rows, width: 0, height: 0, rowOf };
    const groups: number[][] = [];
    if (spread) for (let i = 0; i < sizes.length; i += 2) groups.push(i + 1 < sizes.length ? [i, i + 1] : [i]);
    else for (let i = 0; i < sizes.length; i++) groups.push([i]);

    let top = pad;
    let maxWidth = 0;
    for (const group of groups) {
      const natural = group.map((i) => ({ w: sizes[i].width * cropOf(i).w, h: sizes[i].height * cropOf(i).h }));
      const naturalW = natural.reduce((sum, n) => sum + n.w, 0);
      const naturalH = Math.max(...natural.map((n) => n.h));
      const gaps = (group.length - 1) * GAP;
      // Sur grand écran, une page ajustée à la largeur resterait trop grande pour lire confortablement.
      const fitW = Math.min((box.w - pad * 2 - gaps) / naturalW, (MAX_PAGE_WIDTH * group.length) / naturalW);
      const fitH = (box.h - pad * 2) / naturalH;
      const fit = prefs.fit === 'page' || paged ? Math.min(fitW, prefs.fit === 'page' ? fitH : fitW) : fitW;
      const scale = Math.max(0.05, fit * zoom);
      const width = naturalW * scale + gaps;
      const height = naturalH * scale;
      group.forEach((i) => (rowOf[i] = rows.length));
      rows.push({ pages: group, top, left: 0, width, height, scale });
      maxWidth = Math.max(maxWidth, width);
      top += height + GAP;
    }
    const width = Math.max(box.w, maxWidth + pad * 2);
    for (const row of rows) row.left = Math.max(pad, (width - row.width) / 2);
    return { rows, width, height: top - GAP + pad, rowOf };
  }, [sizes, box, zoom, prefs.fit, paged, spread, pad, cropOf]);

  const layoutRef = useLatest(layout);
  const currentRef = useLatest(current);
  const zoomRef = useLatest(zoom);
  const boxRef = useLatest(box);

  const currentRow = layout.rowOf[current - 1] ?? 0;

  // ---- Ancrage : on garde le même point du document sous le doigt quand la mise en page change.
  const captureAnchor = useCallback(
    (vx?: number, vy?: number): Anchor | null => {
      const el = scroller.current;
      const l = layoutRef.current;
      if (!el || l.rows.length === 0) return null;
      const fx = vx ?? el.clientWidth / 2;
      const fy = vy ?? 0;
      const y = el.scrollTop + fy;
      let index = paged ? (l.rowOf[currentRef.current - 1] ?? 0) : l.rows.findIndex((r) => r.top + r.height + GAP > y);
      if (index < 0) index = l.rows.length - 1;
      const row = l.rows[index];
      const rowTop = paged ? Math.max(pad, (Math.max(el.clientHeight, row.height + pad * 2) - row.height) / 2) : row.top;
      return { row: index, fy: (y - rowTop) / row.height, vy: fy, cx: (el.scrollLeft + fx - row.left) / row.width, vx: fx };
    },
    [layoutRef, currentRef, paged, pad],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || layout.rows.length === 0) return;
    if (!ready.current) {
      // Première mise en page : on reprend à la dernière page lue.
      ready.current = true;
      const row = layout.rows[layout.rowOf[Math.min(sizes.length, Math.max(1, initialPage)) - 1] ?? 0];
      if (!paged && row) el.scrollTop = row.top - pad;
      return;
    }
    const a = anchor.current;
    if (!a) return;
    const row = layout.rows[Math.min(a.row, layout.rows.length - 1)];
    const rowTop = paged ? Math.max(pad, (Math.max(el.clientHeight, row.height + pad * 2) - row.height) / 2) : row.top;
    el.scrollTop = rowTop + a.fy * row.height - a.vy;
    el.scrollLeft = a.left ? a.left(row) : row.left + a.cx * row.width - a.vx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    anchor.current = captureAnchor();
    if (paged) return;
    // Par paliers d'un quart d'écran : inutile de recalculer à chaque pixel.
    const step = Math.max(80, el.clientHeight / 4);
    setScrollTop(Math.round(el.scrollTop / step) * step);
    const probe = el.scrollTop + el.clientHeight * 0.3;
    const l = layoutRef.current;
    let index = l.rows.findIndex((r) => r.top + r.height + GAP > probe);
    if (index < 0) index = l.rows.length - 1;
    const page = (l.rows[index]?.pages[0] ?? 0) + 1;
    // Tout en bas, la dernière page compte comme atteinte.
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    const next = atEnd ? sizes.length : page;
    if (next !== currentRef.current) {
      setCurrent(next);
      onPage(next);
    }
  };

  const applyZoom = useCallback(
    (next: number, focal?: { vx: number; vy: number }, left?: Anchor['left']) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      const a = captureAnchor(focal?.vx, focal?.vy ?? boxRef.current.h / 2);
      if (a && left) a.left = left;
      anchor.current = a;
      setZoom(Math.abs(clamped - 1) < 0.03 ? 1 : clamped);
    },
    [captureAnchor, boxRef],
  );

  const goTo = useCallback(
    (page: number) => {
      const target = Math.min(sizes.length, Math.max(1, page));
      const el = scroller.current;
      const l = layoutRef.current;
      if (!el || l.rows.length === 0) return;
      if (paged) {
        anchor.current = null;
        el.scrollTop = 0;
      } else {
        const row = l.rows[l.rowOf[target - 1] ?? 0];
        el.scrollTop = row.top - pad;
      }
      if (target !== currentRef.current) {
        setCurrent(target);
        onPage(target);
      }
    },
    [sizes.length, layoutRef, currentRef, paged, pad, onPage],
  );

  const turn = useCallback(
    (delta: 1 | -1) => {
      const el = scroller.current;
      if (!el) return;
      if (paged) {
        const l = layoutRef.current;
        const row = l.rowOf[currentRef.current - 1] ?? 0;
        const next = l.rows[row + delta];
        if (next) goTo(next.pages[0] + 1);
      } else {
        el.scrollBy({ top: delta * el.clientHeight * 0.88, behavior: prefs.transitions ? 'smooth' : 'auto' });
      }
    },
    [paged, layoutRef, currentRef, goTo, prefs.transitions],
  );

  useImperativeHandle(ref, () => ({ goTo, turn, zoomBy: (f) => applyZoom(zoomRef.current * f), resetZoom: () => applyZoom(1) }), [goTo, turn, applyZoom, zoomRef]);

  // Aller à l'occurrence de recherche courante.
  useEffect(() => {
    if (!currentHit) return;
    const el = scroller.current;
    const l = layoutRef.current;
    const row = l.rows[l.rowOf[currentHit.page - 1] ?? 0];
    if (!el || !row) return;
    if (paged) {
      goTo(currentHit.page);
      return;
    }
    const size = sizes[currentHit.page - 1];
    const c = cropOf(currentHit.page - 1);
    const y = row.top + ((currentHit.rects[0]?.y ?? 0) - c.y) * size.height * row.scale;
    if (y < el.scrollTop + 60 || y > el.scrollTop + el.clientHeight - 120) el.scrollTop = Math.max(0, y - el.clientHeight * 0.35);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHit]);

  // ---- Double appui : zoome sur le paragraphe touché.
  const zoomOnParagraph = useCallback(
    async (clientX: number, clientY: number) => {
      const el = scroller.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const focal = { vx: clientX - rect.left, vy: clientY - rect.top };
      if (zoomRef.current > 1.05) {
        applyZoom(1, focal);
        return;
      }
      const target = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-page]');
      const pageNumber = target ? Number(target.dataset.page) : 0;
      if (!target || !pageNumber) {
        applyZoom(2, focal);
        return;
      }
      const sheet = target.firstElementChild!.getBoundingClientRect();
      const nx = (clientX - sheet.left) / sheet.width;
      const ny = (clientY - sheet.top) / sheet.height;
      const text = await texts.get(pageNumber).catch(() => null);
      const runs = text?.runs.filter((r) => r.str.trim()) ?? [];
      const hit = runs.find((r) => ny >= r.y - r.h * 0.3 && ny <= r.y + r.h * 1.3 && nx >= r.x - 0.03 && nx <= r.x + r.w + 0.03);
      if (!hit) {
        applyZoom(2, focal);
        return;
      }
      // Le bloc : les lignes voisines qui se recouvrent horizontalement avec la ligne touchée.
      let x0 = hit.x, x1 = hit.x + hit.w, top = hit.y, bottom = hit.y + hit.h;
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of runs) {
          const overlaps = r.x < x1 + 0.02 && r.x + r.w > x0 - 0.02;
          const near = r.y + r.h > top - hit.h * 1.6 && r.y < bottom + hit.h * 1.6;
          if (overlaps && near && (r.x < x0 || r.x + r.w > x1 || r.y < top || r.y + r.h > bottom)) {
            x0 = Math.min(x0, r.x);
            x1 = Math.max(x1, r.x + r.w);
            top = Math.min(top, r.y);
            bottom = Math.max(bottom, r.y + r.h);
            grew = true;
          }
        }
      }
      const index = pageNumber - 1;
      const size = sizes[index];
      const c = cropOf(index);
      const row = layoutRef.current.rows[layoutRef.current.rowOf[index]];
      const margin = 10;
      const wantedScale = (el.clientWidth - margin * 2) / ((x1 - x0) * size.width);
      const next = Math.min(4, Math.max(1.3, (wantedScale / row.scale) * zoomRef.current));
      const before = row.pages.slice(0, row.pages.indexOf(index)).reduce((sum, i) => sum + sizes[i].width * cropOf(i).w, 0);
      applyZoom(next, focal, (r) => r.left + (before + (x0 - c.x) * size.width) * r.scale + row.pages.indexOf(index) * GAP - margin);
    },
    [applyZoom, texts, sizes, cropOf, layoutRef, zoomRef],
  );

  // ---- Gestes : appui (zones), double appui, pincement, balayage, molette + Ctrl.
  const handlers = useLatest({ onTap, onOpenAnnotation, turn, zoomOnParagraph, applyZoom, annotations, tool, paged });
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    let tapTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTap = { time: 0, x: 0, y: 0 };
    let pinch: { distance: number; zoom: number; cx: number; cy: number; scale: number } | null = null;
    let swipe: { x: number; y: number; time: number } | null = null;

    const annotationAt = (clientX: number, clientY: number): string | null => {
      const target = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-page]');
      if (!target) return null;
      const sheet = target.firstElementChild!.getBoundingClientRect();
      const nx = (clientX - sheet.left) / sheet.width;
      const ny = (clientY - sheet.top) / sheet.height;
      const list = handlers.current.annotations.get(Number(target.dataset.page)) ?? [];
      for (const a of list) {
        if (a.rects?.some((r) => nx >= r.x && nx <= r.x + r.w && ny >= r.y - 0.004 && ny <= r.y + r.h + 0.004)) return a.id;
        if (a.kind === 'ink' && a.strokes?.some((s) => s.some(([x, y]) => Math.hypot((x - nx) * sheet.width, (y - ny) * sheet.height) < 14))) return a.id;
      }
      return null;
    };

    const onClick = (e: MouseEvent) => {
      const h = handlers.current;
      if (h.tool !== 'none') return;
      const target = e.target as HTMLElement;
      if (target.closest('a, button, [data-annot]')) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const now = performance.now();
      const double = now - lastTap.time < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32;
      lastTap = { time: now, x: e.clientX, y: e.clientY };
      if (tapTimer) clearTimeout(tapTimer);
      if (double) {
        lastTap.time = 0;
        void h.zoomOnParagraph(e.clientX, e.clientY);
        return;
      }
      const { clientX, clientY } = e;
      // On attend un instant : un second appui en ferait un double appui.
      tapTimer = setTimeout(() => {
        const hc = handlers.current;
        const id = annotationAt(clientX, clientY);
        if (id) {
          hc.onOpenAnnotation(id);
          return;
        }
        const rect = el.getBoundingClientRect();
        const ratio = (clientX - rect.left) / rect.width;
        hc.onTap(ratio < 0.25 ? 'left' : ratio > 0.75 ? 'right' : 'center');
      }, 230);
    };

    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect();
        pinch = {
          distance: distance(e.touches),
          zoom: zoomRef.current,
          cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
          cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
          scale: 1,
        };
        swipe = null;
        inner.style.transformOrigin = `${el.scrollLeft + pinch.cx}px ${el.scrollTop + pinch.cy}px`;
        inner.style.willChange = 'transform';
      } else if (e.touches.length === 1) {
        swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: performance.now() };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const raw = distance(e.touches) / pinch.distance;
      pinch.scale = Math.min(MAX_ZOOM / pinch.zoom, Math.max(MIN_ZOOM / pinch.zoom, raw));
      // Pendant le geste, une simple transformation : le rendu net suit au relâchement.
      inner.style.transform = `scale(${pinch.scale})`;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (pinch) {
        if (e.touches.length < 2) {
          const p = pinch;
          pinch = null;
          inner.style.transform = '';
          inner.style.willChange = '';
          if (Math.abs(p.scale - 1) > 0.02) handlers.current.applyZoom(p.zoom * p.scale, { vx: p.cx, vy: p.cy });
        }
        return;
      }
      const h = handlers.current;
      if (swipe && h.paged && h.tool === 'none' && zoomRef.current <= 1.02 && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - swipe.x;
        const dy = e.changedTouches[0].clientY - swipe.y;
        if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.8 && performance.now() - swipe.time < 700) {
          lastTap.time = 0;
          h.turn(dx < 0 ? 1 : -1);
        }
      }
      swipe = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      handlers.current.applyZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01), { vx: e.clientX - rect.left, vy: e.clientY - rect.top });
    };

    el.addEventListener('click', onClick);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      if (tapTimer) clearTimeout(tapTimer);
      el.removeEventListener('click', onClick);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [handlers, zoomRef]);

  // ---- Pages à rendre : les visibles et leurs voisines.
  const visible = useMemo(() => {
    if (layout.rows.length === 0) return [];
    if (paged) return [currentRow];
    const from = scrollTop - box.h;
    const to = scrollTop + box.h * 2;
    const out: number[] = [];
    for (let i = 0; i < layout.rows.length; i++) {
      const r = layout.rows[i];
      if (r.top + r.height < from) continue;
      if (r.top > to) break;
      out.push(i);
    }
    return out;
  }, [layout, paged, currentRow, scrollTop, box.h]);

  const hitsByPage = useMemo(() => {
    const map = new Map<number, NRect[][]>();
    for (const hit of hits) {
      const list = map.get(hit.page) ?? [];
      list.push(hit.rects);
      map.set(hit.page, list);
    }
    return map;
  }, [hits]);

  const pagedRow = paged ? layout.rows[currentRow] : null;
  const contentHeight = pagedRow ? Math.max(box.h, pagedRow.height + pad * 2) : layout.height;
  const contentWidth = pagedRow ? Math.max(box.w, pagedRow.width + pad * 2) : layout.width;

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      tabIndex={-1}
      className={cn('scrollbar-thin absolute inset-0 overflow-auto overscroll-contain outline-none', tool === 'ink' && 'touch-pan-y')}
    >
      <div ref={content} className="relative" style={{ width: contentWidth, height: contentHeight }}>
        {visible.map((index) => {
          const row = layout.rows[index];
          const top = pagedRow ? Math.max(pad, (contentHeight - row.height) / 2) : row.top;
          return (
            <div
              key={paged ? `p${index}` : index}
              className={cn('absolute flex items-center', paged && prefs.transitions && 'animate-fade-in')}
              style={{ top, left: row.left, width: row.width, height: row.height, gap: GAP }}
            >
              {row.pages.map((i) => (
                <PageView
                  key={i}
                  pdf={pdf}
                  page={i + 1}
                  size={sizes[i]}
                  scale={row.scale}
                  crop={cropOf(i)}
                  annotations={annotations.get(i + 1) ?? EMPTY_ANNOTATIONS}
                  hits={hitsByPage.get(i + 1) ?? EMPTY_HITS}
                  currentHit={currentHit?.page === i + 1 ? currentHit.index : -1}
                  tool={tool}
                  ink={ink}
                  onInk={onInk}
                  onPlaceNote={onPlaceNote}
                  onOpenAnnotation={onOpenAnnotation}
                  onNavigate={goTo}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});
