// Éditeur de page partagé par « Éditer » et « Signer » : une page à la fois,
// rendue par pdf.js, avec par-dessus les éléments que l'on pose, déplace et
// redimensionne. Seule la page courante est rendue.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Redo2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { formatPercent, useT } from '@/i18n';
import type { PDFDocumentProxy } from '@/lib/pdfjs';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Spinner } from '@/ui/Fields';
import { PageThumb } from '../usePdf';
import { ElementView, elementName } from './ElementView';
import { boundsOf, dragHandle, keepsRatio, moved, type EditorDefaults, type EditorElement, type PageSize } from './model';
import { SelectionFrame } from './SelectionFrame';
import { textElement } from './shapes';
import { TextEditor } from './TextEditor';
import type { Editor } from './useEditor';
import { useGestures } from './useGestures';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** Plafond de pixels du rendu : au-delà, on réduit la densité plutôt que de saturer la mémoire d'un téléphone. */
const MAX_PIXELS = 12_000_000;

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Taille en points de la page demandée (rotation comprise) ; `null` tant qu'elle n'est pas connue. */
function usePageBox(pdf: PDFDocumentProxy | null, pageNumber: number): PageSize | null {
  const [box, setBox] = useState<{ page: number; size: PageSize } | null>(null);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void pdf.getPage(pageNumber).then((page) => {
      const v = page.getViewport({ scale: 1 });
      if (!cancelled) setBox({ page: pageNumber, size: { width: v.width, height: v.height } });
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);
  return box?.page === pageNumber ? box.size : null;
}

/** Rendu net de la page : à la densité de l'écran, refait quand le zoom change. */
function PageCanvas({ pdf, page, width, height }: { pdf: PDFDocumentProxy; page: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    // Petit délai : pendant un zoom répété, on ne rend que la dernière taille.
    const timer = setTimeout(async () => {
      try {
        const proxy = await pdf.getPage(page);
        if (cancelled) return;
        const base = proxy.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(MAX_PIXELS / (width * height)));
        const viewport = proxy.getViewport({ scale: (width / base.width) * dpr });
        // Rendu hors écran, puis copie : l'ancienne image reste visible entre-temps.
        const buffer = document.createElement('canvas');
        buffer.width = Math.max(1, Math.floor(viewport.width));
        buffer.height = Math.max(1, Math.floor(viewport.height));
        const render = proxy.render({ canvas: buffer, viewport, background: '#ffffff' });
        task = render;
        await render.promise;
        const canvas = ref.current;
        if (cancelled || !canvas) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        canvas.getContext('2d')!.drawImage(buffer, 0, 0);
        buffer.width = 0;
      } catch {
        /* rendu annulé ou page illisible : la surface reste blanche */
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [pdf, page, width, height]);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;
}

function PageNav({ editor, pdf, pageCount }: { editor: Editor; pdf: PDFDocumentProxy | null; pageCount: number }) {
  const t = useT();
  const strip = useRef<HTMLOListElement>(null);

  // La vignette de la page courante reste visible, sans faire défiler l'écran lui-même.
  useEffect(() => {
    const list = strip.current;
    const item = list?.children[editor.page - 1] as HTMLElement | undefined;
    if (!list || !item) return;
    const left = item.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + item.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: left - (list.clientWidth - item.offsetWidth) / 2, behavior: 'smooth' });
    }
  }, [editor.page]);

  return (
    <nav aria-label={t('editor.pages')} className="flex flex-col gap-2">
      <div className="flex items-center justify-center gap-1">
        <IconButton label={t('editor.previousPage')} disabled={editor.page <= 1} onClick={() => editor.setPage(editor.page - 1)}>
          <ChevronLeft />
        </IconButton>
        <p className="min-w-32 text-center text-sm font-bold tabular-nums" aria-live="polite">
          {t('tools.pageOf', { n: editor.page, total: pageCount })}
        </p>
        <IconButton label={t('editor.nextPage')} disabled={editor.page >= pageCount} onClick={() => editor.setPage(editor.page + 1)}>
          <ChevronRight />
        </IconButton>
      </div>
      <ol ref={strip} className="scrollbar-thin flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => {
          const count = editor.pages[n]?.length ?? 0;
          const current = n === editor.page;
          return (
            <li key={n} className="shrink-0">
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                aria-label={count > 0 ? t('editor.pageWithElements', { n, count }) : t('tools.pageN', { n })}
                onClick={() => editor.setPage(n)}
                className={cn(
                  'relative flex w-14 flex-col items-center gap-0.5 rounded-md border-2 p-1 transition-colors duration-150',
                  current ? 'border-cat-ink bg-cat' : 'border-transparent bg-surface-2',
                )}
              >
                <PageThumb pdf={pdf} page={n} width={48} className="w-full" />
                <span className={cn('text-xs font-bold tabular-nums', current ? 'text-cat-ink' : 'text-ink-soft')}>{n}</span>
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.7rem] leading-5 font-bold text-accent-ink" aria-hidden="true">
                    {count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageEditor({
  editor,
  pdf,
  pageCount,
  defaults,
  toolbar,
}: {
  editor: Editor;
  pdf: PDFDocumentProxy | null;
  pageCount: number;
  defaults: EditorDefaults;
  /** Palette d'outils, affichée au-dessus de la page. */
  toolbar?: ReactNode;
}) {
  const t = useT();
  const helpId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [zoom, setZoom] = useState(1);
  const desktop = useMedia('(min-width: 1024px)');
  const coarse = useMedia('(pointer: coarse)');
  const pageSize = usePageBox(pdf, editor.page);
  const { drawing, createAtCenter, handlers } = useGestures({ editor, surface, pageSize, defaults });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setAvailable(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Zoom 100 % : la page occupe la largeur disponible ; sur grand écran, elle reste entière à l'écran.
  let fit = available;
  if (pageSize && desktop) fit = Math.min(available, Math.max(420, ((window.innerHeight - 250) * pageSize.width) / pageSize.height));
  const width = Math.max(0, Math.round(fit * zoom));
  const height = pageSize ? (width * pageSize.height) / pageSize.width : 0;
  const scale = pageSize ? width / pageSize.width : 1;

  useEffect(() => {
    // Hauteur d'écran réellement libre : sur mobile, le bas est occupé par la barre d'action et la navigation.
    const band = () => ({ top: 12, bottom: window.innerHeight - (desktop ? 16 : 250) });
    editor.view.current = pageSize
      ? {
          pageSize,
          visibleCenter: () => {
            const r = surface.current?.getBoundingClientRect();
            const { top, bottom } = band();
            // Page hors de l'écran : on vise son premier tiers, que `reveal` amènera en vue.
            if (!r || r.width === 0 || Math.min(r.bottom, bottom) - Math.max(r.top, top) < 60) return { x: 0.5, y: 0.3 };
            const cy = (Math.max(r.top, top) + Math.min(r.bottom, bottom)) / 2;
            const cx = (Math.max(r.left, 0) + Math.min(r.right, window.innerWidth)) / 2;
            return { x: Math.min(0.95, Math.max(0.05, (cx - r.left) / r.width)), y: Math.min(0.95, Math.max(0.05, (cy - r.top) / r.height)) };
          },
          reveal: (at) => {
            const r = surface.current?.getBoundingClientRect();
            if (!r) return;
            const { top, bottom } = band();
            const y = r.top + at.y * r.height;
            if (y < top + 50 || y > bottom - 50) window.scrollBy({ top: y - (top + bottom) / 2, behavior: 'smooth' });
          },
        }
      : null;
  }, [editor.view, pageSize, desktop]);

  // Un doigt posé sur un élément le déplace : l'écran ne doit pas défiler à sa place. `touch-action` ne suffit
  // pas sur les éléments SVG dans tous les navigateurs ; on refuse donc le défilement dès le toucher.
  const ready = !!pdf && !!pageSize && width > 0;
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      if ((e.target as Element).closest?.('[data-el], [data-handle]')) e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => el.removeEventListener('touchstart', onTouchStart);
  }, [ready]);

  const selected = editor.selected;
  const editing = editor.elements.find((el) => el.id === editor.editingId);

  // Annonce de la sélection, et focus sur l'élément quand on travaille au clavier dans la page.
  const selectedName = selected ? elementName(selected, t) : null;
  useEffect(() => {
    if (!editor.selectedId || !selectedName) return;
    editor.announce(t('editor.selected', { name: selectedName }));
    const root = surface.current;
    if (root?.contains(document.activeElement)) root.querySelector<SVGGElement>(`[data-el="${editor.selectedId}"]`)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.selectedId]);

  const stepZoom = (direction: 1 | -1) => {
    const index = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + direction))]);
  };

  const removeSelected = () => {
    if (!selected) return;
    editor.remove(selected.id);
    editor.announce(t('editor.deleted'));
    surface.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('textarea') || !pageSize) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (selected?.type === 'text' && editor.mode.kind === 'select') editor.setEditing(selected.id);
      else if (editor.mode.kind !== 'select') createAtCenter();
      else return;
      e.preventDefault();
      return;
    }
    if (!selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[e.key];
    if (!arrow) return;
    e.preventDefault();
    // Pas d'un point, ou de dix avec Maj ; avec Alt, les flèches redimensionnent.
    const step = e.shiftKey ? 10 : 1;
    const dx = (arrow[0] * step) / pageSize.width;
    const dy = (arrow[1] * step) / pageSize.height;
    let next: EditorElement;
    if (!e.altKey) next = moved(selected, dx, dy);
    else if (selected.type === 'line' || selected.type === 'arrow') next = dragHandle(selected, 'p2', { x: selected.x2 + dx, y: selected.y2 + dy }, 1, false);
    else {
      const b = boundsOf(selected);
      const ratio = pageSize.width / pageSize.height;
      next =
        selected.type === 'text' && dy === 0
          ? dragHandle(selected, 'e', { x: b.x + b.w + dx, y: b.y }, ratio, false)
          : dragHandle(selected, 'se', { x: b.x + b.w + dx, y: b.y + b.h + dy }, ratio, keepsRatio(selected));
    }
    editor.replace(next, { group: e.altKey ? 'key-resize' : 'key-move' });
  };

  const cursor = editor.mode.kind === 'draw' ? 'crosshair' : editor.mode.kind === 'text' ? 'text' : editor.mode.kind === 'place' ? 'copy' : undefined;
  // Sans sélection ni outil de tracé, la page laisse défiler l'écran ; sinon les gestes lui sont réservés.
  const touchAction = editor.mode.kind === 'select' && !editor.selectedId ? 'manipulation' : 'none';

  return (
    <div className="flex flex-col gap-3">
      {toolbar}
      <div className="flex items-center gap-1">
        <IconButton label={t('editor.undo')} disabled={!editor.canUndo} onClick={() => { editor.undo(); editor.announce(t('editor.undone')); }}>
          <Undo2 />
        </IconButton>
        <IconButton label={t('editor.redo')} disabled={!editor.canRedo} onClick={() => { editor.redo(); editor.announce(t('editor.redone')); }}>
          <Redo2 />
        </IconButton>
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <IconButton label={t('editor.zoomOut')} disabled={zoom <= ZOOMS[0]} onClick={() => stepZoom(-1)}>
          <ZoomOut />
        </IconButton>
        <button
          type="button"
          onClick={() => setZoom(1)}
          aria-label={t('editor.zoomReset', { zoom: formatPercent(zoom) })}
          title={t('editor.zoomFit')}
          className="min-h-11 min-w-14 rounded-md px-1 text-sm font-semibold tabular-nums hover:bg-surface-2"
        >
          {formatPercent(zoom)}
        </button>
        <IconButton label={t('editor.zoomIn')} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => stepZoom(1)}>
          <ZoomIn />
        </IconButton>
      </div>

      <div ref={scroller} className="scrollbar-thin overflow-auto rounded-lg border border-line bg-surface-2 p-2 sm:p-4">
        {ready && pdf && pageSize ? (
          <div
            ref={surface}
            data-editor-surface
            tabIndex={0}
            role="group"
            aria-label={t('editor.surface', { n: editor.page, total: pageCount })}
            aria-describedby={helpId}
            className="relative mx-auto bg-white shadow-soft select-none"
            style={{ width, height, touchAction, cursor }}
            onKeyDown={onKeyDown}
            {...handlers}
          >
            <PageCanvas pdf={pdf} page={editor.page} width={width} height={height} />
            <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-label={t('editor.elements')}>
              {editor.elements.map((el) => (
                <ElementView key={el.id} el={el} width={width} height={height} scale={scale} pageSize={pageSize} editor={editor} />
              ))}
              {drawing && (
                <ElementView el={{ ...drawing, id: 'drawing' } as EditorElement} width={width} height={height} scale={scale} pageSize={pageSize} editor={editor} interactive={false} />
              )}
            </svg>
            {selected && !editing && <SelectionFrame el={selected} width={width} height={height} coarse={coarse} />}
            {editing?.type === 'text' && (
              <TextEditor
                key={editing.id}
                left={editing.x * width}
                top={editing.y * height}
                width={(editing.autoWidth ? 1 - editing.x : editing.w) * width}
                scale={scale}
                style={editing}
                initial={editing.text}
                onDone={(text, byKey) => {
                  editor.setEditing(null);
                  if (!text.trim()) editor.remove(editing.id);
                  else if (text !== editing.text) editor.patch(editing.id, { text });
                  if (byKey) (surface.current?.querySelector<SVGGElement>(`[data-el="${editing.id}"]`) ?? surface.current)?.focus({ preventScroll: true });
                }}
              />
            )}
            {editor.draft && (
              <TextEditor
                key="draft"
                left={editor.draft.at.x * width}
                top={editor.draft.at.y * height}
                width={(editor.draft.width ?? 1 - editor.draft.at.x) * width}
                scale={scale}
                style={{ font: defaults.font, size: editor.draft.size ?? defaults.size, color: defaults.textColor }}
                initial=""
                onDone={(text, byKey) => {
                  const draft = editor.draft!;
                  editor.setDraft(null);
                  // Le focus revient sur la page : il passera au nouvel élément dès sa sélection.
                  if (byKey) surface.current?.focus({ preventScroll: true });
                  if (text.trim()) editor.add([textElement(text, draft.at, defaults, pageSize, { width: draft.width, size: draft.size })]);
                }}
              />
            )}
          </div>
        ) : (
          <div className="grid h-72 place-items-center" role="status" aria-label={t('common.loading')}>
            <Spinner />
          </div>
        )}
      </div>
      <p id={helpId} className="sr-only">{t('editor.keyboardHelp')}</p>
      <p className="sr-only" aria-live="polite">{editor.announcement}</p>
      {pageCount > 1 && <PageNav editor={editor} pdf={pdf} pageCount={pageCount} />}
    </div>
  );
}
