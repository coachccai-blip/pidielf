// Le lecteur : une page calme, sans interface visible, qui s'adapte à l'œil.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ALargeSmall, ArrowLeft, Bookmark, BookOpenText, Check, FileOutput, FileText, Highlighter, ListTree, Maximize, Minimize,
  MoreVertical, PenLine, ScanText, Search, StickyNote, Undo2, Wrench, ZoomIn, ZoomOut,
} from 'lucide-react';
import { db, newId, type AnnotationRecord, type FileRecord } from '@/db';
import { saveProgress } from '@/db/files';
import { formatDuration, formatPercent, useT } from '@/i18n';
import type { PDFDocumentProxy } from '@/lib/pdfjs';
import { back, navigate, routes } from '@/lib/router';
import { useSettings } from '@/lib/settings';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Drawer, Menu } from '@/ui/Overlay';
import { toast } from '@/ui/toast';
import { ToolGrid } from '@/features/tools/ToolCard';
import { AnnotationDialog, ExportDialog, HIGHLIGHT_COLORS, SelectionToolbar } from './annotations';
import { PageMode, type PageModeHandle } from './PageMode';
import { colorOf, type InkStyle, type ReaderTool } from './PageView';
import { DisplaySheet, SearchBar, SidePanel, useSearch, useSortedBookmarks, type PanelTab } from './panels';
import { TextMode, type TextModeHandle } from './TextMode';
import { useOutline, usePageSizes, useTextCache, useWordsPerPage } from './useDocument';
import './reader.css';

const WORDS_PER_MINUTE = 230;

export function Reader({ file, blob, pdf }: { file: FileRecord; blob: Blob; pdf: PDFDocumentProxy }) {
  const t = useT();
  const { reader: prefs } = useSettings();
  const pageCount = pdf.numPages;
  const sizes = usePageSizes(pdf);
  const texts = useTextCache(pdf);
  const outline = useOutline(pdf);
  const wordsPerPage = useWordsPerPage(pdf, texts);
  const search = useSearch(pdf, texts);

  const initialPage = Math.min(pageCount, Math.max(1, file.page ?? 1));
  const [page, setPage] = useState(initialPage);
  const [mode, setMode] = useState<'page' | 'text'>('page');
  const [chrome, setChrome] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('toc');
  const [display, setDisplay] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState<'more' | 'annotate' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tool, setTool] = useState<ReaderTool>('none');
  const [ink, setInk] = useState<InkStyle>({ color: 'blue', width: 2 });
  const [editing, setEditing] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [wide, setWide] = useState(window.innerWidth >= 900);

  const root = useRef<HTMLDivElement>(null);
  const pageMode = useRef<PageModeHandle>(null);
  const textMode = useRef<TextModeHandle>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const lastStrokes = useRef<string[]>([]);

  const annotations = useLiveQuery(() => db.annotations.where('fileId').equals(file.id).toArray(), [file.id]) ?? [];
  const bookmarks = useSortedBookmarks(useLiveQuery(() => db.bookmarks.where('fileId').equals(file.id).toArray(), [file.id]));
  const sortedAnnotations = useMemo(() => [...annotations].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt), [annotations]);
  const byPage = useMemo(() => {
    const map = new Map<number, AnnotationRecord[]>();
    for (const a of annotations) {
      const list = map.get(a.page) ?? [];
      list.push(a);
      map.set(a.page, list);
    }
    return map;
  }, [annotations]);
  const bookmarked = bookmarks.find((b) => b.page === page);

  // Le mode Texte n'est proposé que si le PDF contient du texte.
  const canText = wordsPerPage === null ? false : wordsPerPage > 3;

  // ---- Reprise de lecture : la dernière page lue est mémorisée.
  useEffect(() => {
    const timer = setTimeout(() => void saveProgress(file.id, page, pageCount), 400);
    return () => clearTimeout(timer);
  }, [file.id, page, pageCount]);
  useEffect(() => {
    const flush = () => void saveProgress(file.id, pageRef.current, pageCount);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [file.id, pageCount]);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---- Écran maintenu allumé pendant la lecture.
  useEffect(() => {
    if (!prefs.keepAwake || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [prefs.keepAwake]);

  // ---- Plein écran (masqué si le navigateur ne le propose pas).
  const canFullscreen = typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled;
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const p = Math.min(pageCount, Math.max(1, Math.round(target)));
      if (mode === 'page') pageMode.current?.goTo(p);
      else textMode.current?.goTo(p);
      setPage(p);
    },
    [mode, pageCount],
  );
  const turn = useCallback(
    (delta: 1 | -1) => {
      if (mode === 'page') pageMode.current?.turn(delta);
      else textMode.current?.turn(delta);
    },
    [mode],
  );

  const onTap = useCallback(
    (zone: 'left' | 'center' | 'right') => {
      if (zone === 'center') setChrome((c) => !c);
      else {
        setChrome(false);
        turn(zone === 'left' ? -1 : 1);
      }
    },
    [turn],
  );

  const switchMode = useCallback(
    (next: 'page' | 'text') => {
      if (next === 'text' && !canText) {
        toast(t('reader.display.noText'), { action: { label: t('tools.ocr.name'), onClick: () => navigate(routes.tool('ocr', [file.id])) } });
        return;
      }
      setTool('none');
      setMode(next);
    },
    [canText, file.id, t],
  );

  const toggleBookmark = useCallback(async () => {
    const existing = await db.bookmarks.where('fileId').equals(file.id).and((b) => b.page === pageRef.current).first();
    if (existing) await db.bookmarks.delete(existing.id);
    else await db.bookmarks.add({ id: newId(), fileId: file.id, page: pageRef.current, createdAt: Date.now() });
  }, [file.id]);

  const openPanel = (tab: PanelTab) => {
    setPanelTab(tab);
    setPanel(tab);
  };

  const closeSearch = () => {
    setSearching(false);
    search.clear();
  };

  // ---- Annotations : dessin libre et notes posées sur la page.
  const onInk = useCallback(
    async (p: number, stroke: number[][]) => {
      const id = newId();
      lastStrokes.current.push(id);
      await db.annotations.add({ id, fileId: file.id, page: p, createdAt: Date.now(), kind: 'ink', color: ink.color, strokes: [stroke], width: ink.width });
    },
    [file.id, ink],
  );
  const undoStroke = async () => {
    const id = lastStrokes.current.pop();
    if (id) await db.annotations.delete(id);
  };
  const onPlaceNote = useCallback(
    async (p: number, x: number, y: number) => {
      const id = newId();
      await db.annotations.add({ id, fileId: file.id, page: p, createdAt: Date.now(), kind: 'note', color: 'yellow', x, y, text: '' });
      setTool('none');
      setEditing(id);
    },
    [file.id],
  );
  const startTool = (next: ReaderTool) => {
    if (mode !== 'page') setMode('page');
    lastStrokes.current = [];
    setTool(next);
    setChrome(true);
  };

  // ---- Clavier.
  const keys = useRef({ turn, goTo, toggleBookmark, toggleFullscreen, switchMode, mode, pageCount, canFullscreen });
  keys.current = { turn, goTo, toggleBookmark, toggleFullscreen, switchMode, mode, pageCount, canFullscreen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      const k = keys.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearching(true);
        setChrome(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          k.turn(1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          k.turn(-1);
          break;
        case ' ':
          e.preventDefault();
          k.turn(e.shiftKey ? -1 : 1);
          break;
        case 'Home':
          k.goTo(1);
          break;
        case 'End':
          k.goTo(k.pageCount);
          break;
        case '+':
        case '=':
          pageMode.current?.zoomBy(1.2);
          break;
        case '-':
          pageMode.current?.zoomBy(1 / 1.2);
          break;
        case '0':
          pageMode.current?.resetZoom();
          break;
        case 'f':
        case 'F':
          if (k.canFullscreen) k.toggleFullscreen();
          break;
        case 'b':
        case 'B':
          void k.toggleBookmark();
          break;
        case 't':
        case 'T':
          setPanelTab('toc');
          setPanel('toc');
          break;
        case 'm':
        case 'M':
          k.switchMode(k.mode === 'page' ? 'text' : 'page');
          break;
        case 'Escape':
          setTool('none');
          setSearching(false);
          setChrome(true);
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Bas de page discret : numéro, pourcentage lu, temps restant estimé.
  const progress = pageCount <= 1 ? 1 : (page - 1) / (pageCount - 1);
  const remaining = wordsPerPage && wordsPerPage > 3 ? ((pageCount - page) * wordsPerPage) / WORDS_PER_MINUTE : null;
  const footer = [
    t('reader.pageOf', { page, total: pageCount }),
    formatPercent(progress),
    remaining !== null && remaining >= 1 ? t('reader.timeLeft', { time: formatDuration(remaining) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const editingAnnotation = editing ? (annotations.find((a) => a.id === editing) ?? null) : null;
  const currentHit = search.state.current >= 0 ? (search.state.hits[search.state.current] ?? null) : null;
  const title = file.name.replace(/\.pdf$/i, '');
  const toolbarButton = 'text-[inherit]';

  return (
    <div ref={root} className="reader fixed inset-0 flex flex-col overflow-hidden" data-paper={prefs.paper} data-tool={tool}>
      <h1 className="sr-only">{title}</h1>

      <div className="relative min-h-0 flex-1">
        {sizes.length > 0 && mode === 'page' && (
          <PageMode
            ref={pageMode}
            pdf={pdf}
            sizes={sizes}
            texts={texts}
            prefs={prefs}
            initialPage={page}
            annotations={byPage}
            hits={search.state.hits}
            currentHit={currentHit}
            tool={tool}
            ink={ink}
            onPage={setPage}
            onZoom={setZoom}
            onTap={onTap}
            onInk={onInk}
            onPlaceNote={onPlaceNote}
            onOpenAnnotation={setEditing}
          />
        )}
        {mode === 'text' && (
          <TextMode
            ref={textMode}
            pdf={pdf}
            texts={texts}
            pageCount={pageCount}
            prefs={prefs}
            initialPage={page}
            onPage={setPage}
            onTap={onTap}
            onOriginal={(p) => {
              setPage(p);
              setMode('page');
            }}
          />
        )}

        {/* Voile de confort : luminosité et chaleur, indépendantes du système. */}
        <div className="pointer-events-none absolute inset-0 z-20 bg-black" style={{ opacity: 1 - prefs.brightness }} aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 z-20 mix-blend-multiply" style={{ background: 'rgb(255 170 70)', opacity: prefs.warmth * 0.45 }} aria-hidden="true" />

        {/* Bas de page discret, toujours présent. */}
        <p
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(0.3rem,var(--safe-bottom))] text-center text-[0.72rem] font-semibold tabular-nums transition-opacity duration-200',
            chrome ? 'opacity-0' : 'opacity-100',
          )}
          style={{ color: 'var(--paper-soft)', textShadow: '0 0 6px var(--desk), 0 0 6px var(--desk)' }}
        >
          {footer}
        </p>
      </div>

      {/* ---- Barre du haut ---- */}
      <div className={cn('absolute inset-x-0 top-0 z-30 transition-transform duration-200', !chrome && !searching && '-translate-y-full')}>
        {searching ? (
          <SearchBar search={search} page={page} onClose={closeSearch} />
        ) : (
          <header className="flex items-center gap-0.5 border-b border-line bg-surface/95 px-1.5 py-1 pt-[max(0.25rem,var(--safe-top))] text-ink shadow-soft backdrop-blur">
            <IconButton label={t('reader.backToLibrary')} onClick={() => back(routes.library)}><ArrowLeft /></IconButton>
            <p className="min-w-0 flex-1 truncate px-1 font-display text-xl font-semibold" aria-hidden="true">{title}</p>
            <IconButton label={t('reader.search.label')} onClick={() => setSearching(true)}><Search /></IconButton>
            <IconButton label={bookmarked ? t('reader.bookmarkRemove') : t('reader.bookmarkAdd')} active={!!bookmarked} onClick={() => void toggleBookmark()}>
              <Bookmark className={bookmarked ? 'fill-current' : undefined} />
            </IconButton>
            <div className="hidden items-center gap-0.5 md:flex">
              <IconButton label={t('reader.panel.title')} onClick={() => openPanel('toc')}><ListTree /></IconButton>
              <IconButton label={t('reader.display.title')} onClick={() => setDisplay(true)}><ALargeSmall /></IconButton>
              <IconButton label={mode === 'page' ? t('reader.display.modeText') : t('reader.display.modePage')} active={mode === 'text'} onClick={() => switchMode(mode === 'page' ? 'text' : 'page')}>
                {mode === 'page' ? <BookOpenText /> : <FileText />}
              </IconButton>
              <IconButton label={t('reader.annotate')} active={tool !== 'none'} onClick={() => setMenu('annotate')}><Highlighter /></IconButton>
              <IconButton label={t('nav.tools')} onClick={() => setToolsOpen(true)}><Wrench /></IconButton>
            </div>
            <IconButton label={t('reader.more')} onClick={() => setMenu('more')}><MoreVertical /></IconButton>
          </header>
        )}

        {/* Outil d'annotation en cours */}
        {tool !== 'none' && (
          <div className="mx-auto mt-2 flex w-fit max-w-[calc(100%-1rem)] items-center gap-1 rounded-xl border border-line bg-surface p-1 text-ink shadow-lift" role="toolbar" aria-label={t('reader.annotate')}>
            <span className="flex items-center gap-2 px-2 text-sm font-bold">
              {tool === 'ink' ? <PenLine className="size-4" aria-hidden="true" /> : <StickyNote className="size-4" aria-hidden="true" />}
              <span className="hidden sm:inline">{t(tool === 'ink' ? 'reader.annotations.drawHint' : 'reader.annotations.noteHint')}</span>
            </span>
            {tool === 'ink' && (
              <>
                {[...HIGHLIGHT_COLORS, 'black'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={t(`reader.annotations.colors.${c}`)}
                    aria-pressed={ink.color === c}
                    onClick={() => setInk({ ...ink, color: c })}
                    className={cn('grid size-10 place-items-center rounded-md', ink.color === c && 'bg-surface-2 ring-2 ring-accent')}
                  >
                    <span className="size-5 rounded-full" style={{ background: colorOf(c) }} />
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={t('reader.annotations.width')}
                  title={t('reader.annotations.width')}
                  onClick={() => setInk({ ...ink, width: ink.width >= 6 ? 1 : ink.width + (ink.width < 2 ? 1 : 2) })}
                  className="grid size-10 place-items-center rounded-md hover:bg-surface-2"
                >
                  <span className="w-5 rounded-full bg-current" style={{ height: Math.max(2, ink.width * 1.5) }} />
                </button>
                <IconButton size="sm" label={t('reader.annotations.undoStroke')} onClick={() => void undoStroke()} className={toolbarButton}><Undo2 /></IconButton>
              </>
            )}
            <button type="button" onClick={() => setTool('none')} className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-bold text-accent-ink">
              <Check className="size-4" aria-hidden="true" /> {t('common.done')}
            </button>
          </div>
        )}
      </div>

      {/* ---- Barre du bas : progression, et actions à portée de pouce sur mobile ---- */}
      <div className={cn('absolute inset-x-0 bottom-0 z-30 transition-transform duration-200', !chrome && 'translate-y-full')}>
        <div className="border-t border-line bg-surface/95 px-3 pt-1 pb-[max(0.4rem,var(--safe-bottom))] text-ink shadow-soft backdrop-blur">
          <div className="flex items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <span className="sr-only">{t('reader.progress')}</span>
              <input
                type="range"
                min={1}
                max={pageCount}
                value={page}
                disabled={pageCount <= 1}
                onChange={(e) => goTo(e.target.valueAsNumber)}
                aria-valuetext={t('reader.pageOf', { page, total: pageCount })}
                className="h-11 min-w-0 flex-1"
              />
            </label>
            <span className="shrink-0 text-sm font-bold tabular-nums">{page} / {pageCount}</span>
            {mode === 'page' && (
              <div className="hidden items-center md:flex">
                <IconButton size="sm" label={t('reader.zoomOut')} onClick={() => pageMode.current?.zoomBy(1 / 1.2)}><ZoomOut /></IconButton>
                <button type="button" onClick={() => pageMode.current?.resetZoom()} aria-label={`${formatPercent(zoom)} — ${t('reader.zoomReset')}`} title={t('reader.zoomReset')} className="min-h-9 min-w-14 rounded-md px-1 text-sm font-bold tabular-nums hover:bg-surface-2">
                  {formatPercent(zoom)}
                </button>
                <IconButton size="sm" label={t('reader.zoomIn')} onClick={() => pageMode.current?.zoomBy(1.2)}><ZoomIn /></IconButton>
              </div>
            )}
          </div>
          <p className="-mt-1 pb-1 text-center text-xs text-ink-soft tabular-nums md:hidden">{footer}</p>
          <div className="flex justify-around md:hidden">
            <BottomAction label={t('reader.panel.toc')} onClick={() => openPanel('toc')}><ListTree /></BottomAction>
            <BottomAction label={t('reader.display.short')} onClick={() => setDisplay(true)}><ALargeSmall /></BottomAction>
            <BottomAction label={mode === 'page' ? t('reader.display.modeText') : t('reader.display.modePage')} onClick={() => switchMode(mode === 'page' ? 'text' : 'page')}>
              {mode === 'page' ? <BookOpenText /> : <FileText />}
            </BottomAction>
            <BottomAction label={t('reader.annotate')} onClick={() => setMenu('annotate')}><Highlighter /></BottomAction>
            <BottomAction label={t('nav.tools')} onClick={() => setToolsOpen(true)}><Wrench /></BottomAction>
          </div>
        </div>
      </div>

      {mode === 'page' && tool === 'none' && <SelectionToolbar fileId={file.id} onNote={setEditing} />}

      <SidePanel
        open={panel !== null}
        onClose={() => setPanel(null)}
        tab={panelTab}
        onTab={setPanelTab}
        pdf={pdf}
        outline={outline}
        page={page}
        bookmarks={bookmarks}
        annotations={sortedAnnotations}
        onGo={goTo}
        onOpenAnnotation={setEditing}
        onExport={() => {
          setPanel(null);
          setExporting(true);
        }}
      />
      <DisplaySheet open={display} onClose={() => setDisplay(false)} prefs={prefs} mode={mode} onMode={switchMode} canText={canText} wide={wide} />
      <Drawer open={toolsOpen} onClose={() => setToolsOpen(false)} title={t('nav.tools')}>
        <p className="mb-3 text-sm text-ink-soft">{t('reader.toolsHint')}</p>
        {file.encrypted ? <p className="text-ink-soft">{t('reader.toolsProtected')}</p> : null}
        <div className="pb-4">
          <ToolGrid fileIds={[file.id]} compact />
        </div>
      </Drawer>
      <AnnotationDialog annotation={editingAnnotation} onClose={() => setEditing(null)} />
      <ExportDialog open={exporting} onClose={() => setExporting(false)} file={file} blob={blob} annotations={annotations} sizes={sizes} />

      <Menu
        open={menu === 'annotate'}
        onClose={() => setMenu(null)}
        title={t('reader.annotate')}
        anchor={{ x: window.innerWidth - 300, y: 56 }}
        sections={[
          {
            title: t('reader.annotations.selectHint'),
            items: [
              { id: 'ink', label: t('reader.annotations.draw'), icon: <PenLine />, onSelect: () => startTool('ink') },
              { id: 'note', label: t('reader.annotations.placeNote'), icon: <StickyNote />, onSelect: () => startTool('note') },
              { id: 'list', label: t('reader.annotations.list', { count: annotations.length }), icon: <Highlighter />, onSelect: () => openPanel('notes') },
              { id: 'export', label: t('reader.export.title'), icon: <FileOutput />, onSelect: () => setExporting(true) },
            ],
          },
        ]}
      />
      <Menu
        open={menu === 'more'}
        onClose={() => setMenu(null)}
        title={title}
        anchor={{ x: window.innerWidth - 300, y: 56 }}
        sections={[
          {
            items: [
              { id: 'export', label: t('reader.export.title'), icon: <FileOutput />, onSelect: () => setExporting(true) },
              { id: 'bookmarks', label: t('reader.panel.bookmarks'), icon: <Bookmark />, onSelect: () => openPanel('bookmarks') },
              ...(canFullscreen
                ? [{ id: 'fs', label: fullscreen ? t('reader.fullscreenExit') : t('reader.fullscreen'), icon: fullscreen ? <Minimize /> : <Maximize />, onSelect: toggleFullscreen }]
                : []),
              ...(!canText && wordsPerPage !== null
                ? [{ id: 'ocr', label: t('reader.ocrOffer'), icon: <ScanText />, onSelect: () => navigate(routes.tool('ocr', [file.id])) }]
                : []),
            ],
          },
        ]}
      />
    </div>
  );
}

function BottomAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[0.68rem] font-bold text-ink-soft hover:bg-surface-2 [&>svg]:size-5">
      {children}
      <span className="max-w-[4.5rem] truncate">{label}</span>
    </button>
  );
}
