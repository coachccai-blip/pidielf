// Panneaux du lecteur : sommaire, miniatures, marque-pages, annotations,
// recherche et réglages d'affichage.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronDown, ChevronUp, FileOutput, Highlighter, PenLine, StickyNote, Trash2, Underline, X } from 'lucide-react';
import { db, type AnnotationRecord, type BookmarkRecord } from '@/db';
import { searchPage, type SearchHit } from '@/core/text';
import { formatDate, formatPercent, useT } from '@/i18n';
import type { PDFDocumentProxy } from '@/lib/pdfjs';
import { updateReaderPrefs, type PaperTheme, type ReaderPrefs } from '@/lib/settings';
import { Button, IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Segmented, Slider, Spinner, Switch } from '@/ui/Fields';
import { Drawer } from '@/ui/Overlay';
import { PageThumb } from '@/features/tools/usePdf';
import type { OutlineNode, TextCache } from './useDocument';

export type PanelTab = 'toc' | 'pages' | 'bookmarks' | 'notes';

// ---- Panneau latéral --------------------------------------------------------

export function SidePanel({
  open,
  onClose,
  tab,
  onTab,
  pdf,
  outline,
  page,
  bookmarks,
  annotations,
  onGo,
  onOpenAnnotation,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  pdf: PDFDocumentProxy;
  outline: OutlineNode[] | null;
  page: number;
  bookmarks: BookmarkRecord[];
  annotations: AnnotationRecord[];
  onGo: (page: number) => void;
  onOpenAnnotation: (id: string) => void;
  onExport: () => void;
}) {
  const t = useT();
  const go = (p: number) => {
    onGo(p);
    onClose();
  };
  return (
    <Drawer open={open} onClose={onClose} title={t('reader.panel.title')}>
      <Segmented<PanelTab>
        label={t('reader.panel.title')}
        size="sm"
        value={tab}
        onChange={onTab}
        options={[
          { value: 'toc', label: t('reader.panel.toc') },
          { value: 'pages', label: t('reader.panel.pages') },
          { value: 'bookmarks', label: t('reader.panel.bookmarks') },
          { value: 'notes', label: t('reader.panel.notes') },
        ]}
      />
      <div className="mt-4 pb-4">
        {tab === 'toc' &&
          (outline === null ? (
            <p className="flex items-center gap-2 text-ink-soft"><Spinner /> {t('common.loading')}</p>
          ) : outline.length === 0 ? (
            <p className="text-ink-soft">{t('reader.panel.noToc')}</p>
          ) : (
            <nav aria-label={t('reader.panel.toc')}>
              <OutlineList nodes={outline} page={page} depth={0} onGo={go} />
            </nav>
          ))}

        {tab === 'pages' && (
          <ul className="grid grid-cols-3 gap-3">
            {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => go(p)}
                  aria-label={t('tools.pageN', { n: p })}
                  aria-current={p === page ? 'page' : undefined}
                  className={cn('flex w-full flex-col items-center gap-1 rounded-md border-2 p-1', p === page ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2')}
                >
                  <PageThumb pdf={pdf} page={p} width={96} className="w-full rounded-sm" />
                  <span className="text-xs font-bold tabular-nums">{p}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === 'bookmarks' &&
          (bookmarks.length === 0 ? (
            <p className="text-ink-soft">{t('reader.panel.noBookmarks')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {bookmarks.map((b) => (
                <li key={b.id} className="flex items-center gap-1 rounded-md border border-line">
                  <button type="button" onClick={() => go(b.page)} className="flex min-h-11 flex-1 items-center gap-3 rounded-md px-3 text-left hover:bg-surface-2">
                    <Bookmark className="size-4 shrink-0 fill-current text-accent" aria-hidden="true" />
                    <span className="font-bold">{t('tools.pageN', { n: b.page })}</span>
                    <span className="text-sm text-ink-soft">{formatDate(b.createdAt)}</span>
                  </button>
                  <IconButton label={t('reader.bookmarkRemove')} onClick={() => void db.bookmarks.delete(b.id)}>
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          ))}

        {tab === 'notes' && (
          <div className="flex flex-col gap-3">
            <Button icon={<FileOutput />} onClick={onExport} className="self-start">{t('reader.export.title')}</Button>
            {annotations.length === 0 ? (
              <p className="text-ink-soft">{t('reader.panel.noNotes')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {annotations.map((a) => {
                  const Icon = a.kind === 'highlight' ? Highlighter : a.kind === 'underline' ? Underline : a.kind === 'ink' ? PenLine : StickyNote;
                  return (
                    <li key={a.id} className="flex items-stretch gap-1 rounded-md border border-line">
                      <button type="button" onClick={() => go(a.page)} className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold text-ink-soft">
                            {t('tools.pageN', { n: a.page })} · {t(`reader.annotations.kinds.${a.kind}`)}
                          </span>
                          {a.quote && <span className="line-clamp-2 text-sm italic">{a.quote}</span>}
                          {a.text && <span className="line-clamp-3 text-sm">{a.text}</span>}
                        </span>
                      </button>
                      <IconButton
                        label={t('reader.annotations.edit')}
                        onClick={() => {
                          onClose();
                          onOpenAnnotation(a.id);
                        }}
                      >
                        <PenLine />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function OutlineList({ nodes, page, depth, onGo }: { nodes: OutlineNode[]; page: number; depth: number; onGo: (p: number) => void }) {
  return (
    <ul className={cn('flex flex-col', depth > 0 && 'ml-4 border-l border-line pl-1')}>
      {nodes.map((node, i) => {
        const next = nodes[i + 1]?.page ?? Infinity;
        const active = node.page !== null && page >= node.page && page < next;
        return (
          <li key={`${i}-${node.title}`}>
            <button
              type="button"
              disabled={node.page === null}
              onClick={() => node.page && onGo(node.page)}
              aria-current={active && depth === 0 ? 'location' : undefined}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50',
                active && depth === 0 && 'bg-accent-soft font-bold',
              )}
            >
              <span className="min-w-0 flex-1 leading-snug">{node.title}</span>
              {node.page !== null && <span className="shrink-0 text-sm text-ink-soft tabular-nums">{node.page}</span>}
            </button>
            {node.children.length > 0 && <OutlineList nodes={node.children} page={page} depth={depth + 1} onGo={onGo} />}
          </li>
        );
      })}
    </ul>
  );
}

// ---- Recherche --------------------------------------------------------------

export interface SearchState { query: string; hits: SearchHit[]; current: number; done: boolean; progress: number }

/** Recherche dans tout le document, page après page, sans bloquer l'interface. */
export function useSearch(pdf: PDFDocumentProxy, texts: TextCache) {
  const [state, setState] = useState<SearchState>({ query: '', hits: [], current: -1, done: true, progress: 0 });
  const token = useRef(0);

  const run = (query: string, fromPage = 1) => {
    const id = ++token.current;
    const q = query.trim();
    if (q.length < 2) {
      setState({ query, hits: [], current: -1, done: true, progress: 0 });
      return;
    }
    setState({ query, hits: [], current: -1, done: false, progress: 0 });
    void (async () => {
      const hits: SearchHit[] = [];
      const count = pdf.numPages;
      for (let p = 1; p <= count; p++) {
        if (token.current !== id) return;
        const text = await texts.get(p).catch(() => null);
        if (text) hits.push(...searchPage(text, p, q));
        if (p % 12 === 0 || p === count || hits.length > 3000) {
          const snapshot = [...hits];
          const done = p === count || hits.length > 3000;
          setState((prev) => {
            if (token.current !== id) return prev;
            // La première occurrence proposée est celle qui suit la page en cours.
            let current = prev.current;
            if (current < 0 && snapshot.length > 0) {
              const next = snapshot.findIndex((h) => h.page >= fromPage);
              if (next >= 0 || done) current = Math.max(0, next);
            }
            return { query, hits: snapshot, current, done, progress: p / count };
          });
          if (done) return;
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    })();
  };

  const step = (delta: number) =>
    setState((prev) => (prev.hits.length === 0 ? prev : { ...prev, current: (prev.current + delta + prev.hits.length) % prev.hits.length }));
  const select = (index: number) => setState((prev) => ({ ...prev, current: index }));
  const clear = () => {
    token.current++;
    setState({ query: '', hits: [], current: -1, done: true, progress: 0 });
  };
  return { state, run, step, select, clear };
}

export function SearchBar({
  search,
  page,
  onClose,
}: {
  search: ReturnType<typeof useSearch>;
  page: number;
  onClose: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(search.state.query);
  const [list, setList] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { state } = search;

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (value !== state.query) search.run(value, page);
    }, 280);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const count = state.hits.length;
  const status =
    value.trim().length < 2
      ? ''
      : count === 0
        ? state.done
          ? t('reader.search.none')
          : t('reader.search.searching')
        : `${state.current + 1} / ${count}${state.done ? '' : '…'}`;

  return (
    <div className="pointer-events-auto border-b border-line bg-surface text-ink shadow-soft" role="search">
      <div className="flex items-center gap-1 px-2 py-1.5 pt-[max(0.375rem,var(--safe-top))]">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('reader.search.label')}</span>
          <input
            ref={input}
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search.step(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder={t('reader.search.placeholder')}
            className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-3"
          />
        </label>
        <span className="min-w-14 px-1 text-center text-sm text-ink-soft tabular-nums" aria-live="polite">{status}</span>
        <IconButton label={t('reader.search.previous')} disabled={count === 0} onClick={() => search.step(-1)}><ChevronUp /></IconButton>
        <IconButton label={t('reader.search.next')} disabled={count === 0} onClick={() => search.step(1)}><ChevronDown /></IconButton>
        <IconButton label={t('reader.search.close')} onClick={onClose}><X /></IconButton>
      </div>
      {count > 0 && (
        <div className="border-t border-line">
          <button
            type="button"
            aria-expanded={list}
            onClick={() => setList(!list)}
            className="flex min-h-10 w-full items-center justify-between px-4 text-sm font-bold text-ink-soft hover:bg-surface-2"
          >
            {t('reader.search.results', { count })}
            {list ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {list && (
            <ul className="scrollbar-thin max-h-[42dvh] overflow-y-auto border-t border-line">
              {state.hits.slice(0, 400).map((hit, i) => (
                <li key={`${hit.page}-${hit.start}`}>
                  <button
                    type="button"
                    onClick={() => {
                      search.select(i);
                      setList(false);
                    }}
                    aria-current={i === state.current || undefined}
                    className={cn('flex min-h-11 w-full gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2', i === state.current && 'bg-accent-soft')}
                  >
                    <span className="w-12 shrink-0 font-bold text-ink-soft tabular-nums">p. {hit.page}</span>
                    <span className="min-w-0 flex-1">
                      {hit.before}
                      <mark className="rounded-sm bg-[#ffd27a] px-0.5 text-[#3d2a00]">{hit.match}</mark>
                      {hit.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Réglages d'affichage -----------------------------------------------------

const papers: Array<{ id: PaperTheme; bg: string; fg: string }> = [
  { id: 'white', bg: '#ffffff', fg: '#1c2321' },
  { id: 'sepia', bg: '#f6ecd6', fg: '#3d3222' },
  { id: 'grey', bg: '#e4e4e0', fg: '#24292a' },
  { id: 'night', bg: '#14191b', fg: '#c9d0cc' },
];

export function DisplaySheet({
  open,
  onClose,
  prefs,
  mode,
  onMode,
  canText,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  prefs: ReaderPrefs;
  mode: 'page' | 'text';
  onMode: (mode: 'page' | 'text') => void;
  canText: boolean;
  wide: boolean;
}) {
  const t = useT();
  const set = updateReaderPrefs;
  return (
    <Drawer open={open} onClose={onClose} title={t('reader.display.title')}>
      <div className="flex flex-col gap-5 pb-4">
        <div>
          <p className="mb-1.5 text-sm font-bold">{t('reader.display.mode')}</p>
          <Segmented<'page' | 'text'>
            label={t('reader.display.mode')}
            value={mode}
            onChange={onMode}
            options={[
              { value: 'page', label: t('reader.display.modePage') },
              { value: 'text', label: t('reader.display.modeText') },
            ]}
          />
          <p className="mt-1.5 text-xs text-ink-soft">{canText ? t('reader.display.modeHint') : t('reader.display.noText')}</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-bold">{t('reader.display.paper')}</p>
          <div role="radiogroup" aria-label={t('reader.display.paper')} className="grid grid-cols-4 gap-2">
            {papers.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={prefs.paper === p.id}
                onClick={() => set({ paper: p.id })}
                className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-xs font-bold', prefs.paper === p.id ? 'border-accent' : 'border-line')}
                style={{ background: p.bg, color: p.fg }}
              >
                <span className="font-display text-lg leading-none">Aa</span>
                {t(`reader.display.papers.${p.id}`)}
              </button>
            ))}
          </div>
        </div>

        <Slider label={t('reader.display.brightness')} min={0.35} max={1} step={0.01} value={prefs.brightness} onChange={(brightness) => set({ brightness })} format={(v) => formatPercent(v)} />
        <Slider label={t('reader.display.warmth')} min={0} max={1} step={0.01} value={prefs.warmth} onChange={(warmth) => set({ warmth })} format={(v) => formatPercent(v)} />

        {mode === 'page' ? (
          <>
            <div>
              <p className="mb-1.5 text-sm font-bold">{t('reader.display.scroll')}</p>
              <Segmented<ReaderPrefs['scroll']>
                label={t('reader.display.scroll')}
                value={prefs.scroll}
                onChange={(scroll) => set({ scroll })}
                options={[
                  { value: 'continuous', label: t('reader.display.continuous') },
                  { value: 'paged', label: t('reader.display.paged') },
                ]}
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-bold">{t('reader.display.fit')}</p>
              <Segmented<ReaderPrefs['fit']>
                label={t('reader.display.fit')}
                value={prefs.fit}
                onChange={(fit) => set({ fit })}
                options={[
                  { value: 'width', label: t('reader.display.fitWidth') },
                  { value: 'page', label: t('reader.display.fitPage') },
                ]}
              />
            </div>
            {wide && <Switch label={t('reader.display.spread')} checked={prefs.spread} onChange={(spread) => set({ spread })} />}
            <Switch label={t('reader.display.crop')} hint={t('reader.display.cropHint')} checked={prefs.cropMargins} onChange={(cropMargins) => set({ cropMargins })} />
            <Switch label={t('reader.display.transitions')} checked={prefs.transitions} onChange={(transitions) => set({ transitions })} />
          </>
        ) : (
          <>
            <div>
              <p className="mb-1.5 text-sm font-bold">{t('reader.display.font')}</p>
              <Segmented<ReaderPrefs['textFont']>
                label={t('reader.display.font')}
                value={prefs.textFont}
                onChange={(textFont) => set({ textFont })}
                options={[
                  { value: 'literata', label: 'Literata' },
                  { value: 'atkinson', label: 'Atkinson' },
                  { value: 'sans', label: 'Nunito' },
                ]}
              />
            </div>
            <Slider label={t('reader.display.size')} min={14} max={32} value={prefs.textSize} onChange={(textSize) => set({ textSize })} format={(v) => `${v} px`} />
            <Slider label={t('reader.display.line')} min={1.2} max={2.2} step={0.05} value={prefs.textLine} onChange={(textLine) => set({ textLine })} format={(v) => v.toFixed(2)} />
            <Slider label={t('reader.display.margins')} min={0} max={3} value={prefs.textMargin} onChange={(textMargin) => set({ textMargin })} />
            <Switch label={t('reader.display.justify')} checked={prefs.textJustify} onChange={(textJustify) => set({ textJustify })} />
          </>
        )}
        <Switch label={t('reader.display.keepAwake')} hint={'wakeLock' in navigator ? undefined : t('reader.display.keepAwakeUnsupported')} checked={prefs.keepAwake} onChange={(keepAwake) => set({ keepAwake })} />
      </div>
    </Drawer>
  );
}

/** Marque-pages du document, triés par page. */
export function useSortedBookmarks(list: BookmarkRecord[] | undefined): BookmarkRecord[] {
  return useMemo(() => [...(list ?? [])].sort((a, b) => a.page - b.page), [list]);
}
