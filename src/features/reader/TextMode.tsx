// Mode Texte : le texte du PDF est extrait et remis en forme comme dans un
// livre numérique. C'est une aide à la lecture : sur les mises en page
// complexes le résultat est approximatif, et un appui ramène à la page d'origine.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import { FileText } from 'lucide-react';
import { reflowPage, type Block } from '@/core/text';
import { useT } from '@/i18n';
import type { ReaderPrefs } from '@/lib/settings';
import { useLatest, type TextCache } from './useDocument';
import { pageFigures, type Figure } from './figures';
import type { PDFDocumentProxy } from '@/lib/pdfjs';

export interface TextModeHandle {
  goTo: (page: number) => void;
  turn: (delta: 1 | -1) => void;
}

interface Props {
  pdf: PDFDocumentProxy;
  texts: TextCache;
  pageCount: number;
  prefs: ReaderPrefs;
  initialPage: number;
  onPage: (page: number) => void;
  onTap: (zone: 'left' | 'center' | 'right') => void;
  /** Revient à la page d'origine correspondante. */
  onOriginal: (page: number) => void;
}

type Item = { kind: 'block'; block: Block } | { kind: 'figure'; figure: Figure };
interface PageContent { items: Item[] }

const fonts: Record<ReaderPrefs['textFont'], string> = {
  literata: "'Literata Variable', Georgia, serif",
  atkinson: "'Atkinson Hyperlegible', system-ui, sans-serif",
  sans: 'var(--font-sans)',
};
const widths = ['46rem', '40rem', '34rem', '28rem'];
const paddings = ['0.9rem', '1.25rem', '1.75rem', '2.5rem'];

export const TextMode = forwardRef<TextModeHandle, Props>(function TextMode(
  { pdf, texts, pageCount, prefs, initialPage, onPage, onTap, onOriginal },
  ref,
) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Map<number, PageContent>>(new Map());
  const requested = useRef(new Set<number>());
  const urls = useRef<string[]>([]);
  const current = useRef(initialPage);
  const tap = useLatest(onTap);

  const load = (page: number) => {
    if (requested.current.has(page)) return;
    requested.current.add(page);
    void (async () => {
      const text = await texts.get(page);
      const blocks = reflowPage(text.runs);
      // Les images du document sont replacées dans le fil du texte quand c'est possible.
      const figures = blocks.length > 0 ? await pageFigures(pdf, page).catch(() => []) : [];
      figures.forEach((f) => urls.current.push(f.url));
      const items: Item[] = [
        ...blocks.map((block) => ({ kind: 'block' as const, block })),
        ...figures.map((figure) => ({ kind: 'figure' as const, figure })),
      ].sort((a, b) => (a.kind === 'block' ? a.block.y : a.figure.y) - (b.kind === 'block' ? b.block.y : b.figure.y));
      setPages((prev) => new Map(prev).set(page, { items }));
    })().catch(() => requested.current.delete(page));
  };

  // Les pages sont chargées à l'approche de l'écran.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) load(Number((entry.target as HTMLElement).dataset.page));
      },
      { root, rootMargin: '150% 0px' },
    );
    root.querySelectorAll('section[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const scrollToPage = (page: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`section[data-page="${page}"]`);
    if (el && scroller.current) scroller.current.scrollTop = Math.max(0, el.offsetTop - 56);
  };

  useEffect(() => {
    load(initialPage);
    scrollToPage(initialPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    goTo: (page) => {
      load(page);
      scrollToPage(page);
    },
    turn: (delta) => {
      const el = scroller.current;
      el?.scrollBy({ top: delta * el.clientHeight * 0.88, behavior: prefs.transitions ? 'smooth' : 'auto' });
    },
  }));

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const probe = el.scrollTop + el.clientHeight * 0.25;
    const sections = el.querySelectorAll<HTMLElement>('section[data-page]');
    // Recherche dichotomique : les sections sont dans l'ordre.
    let lo = 0;
    let hi = sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sections[mid].offsetTop <= probe) lo = mid;
      else hi = mid - 1;
    }
    const page = el.scrollTop + el.clientHeight >= el.scrollHeight - 4 ? pageCount : lo + 1;
    if (page !== current.current) {
      current.current = page;
      onPage(page);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    tap.current(ratio < 0.25 ? 'left' : ratio > 0.75 ? 'right' : 'center');
  };

  return (
    <div ref={scroller} onScroll={onScroll} onClick={onClick} tabIndex={-1} className="reflow scrollbar-thin absolute inset-0 overflow-y-auto overscroll-contain outline-none">
      <article
        lang="fr"
        className="mx-auto pt-16 pb-28"
        style={{
          maxWidth: widths[prefs.textMargin] ?? widths[1],
          paddingInline: paddings[prefs.textMargin] ?? paddings[1],
          fontFamily: fonts[prefs.textFont],
          fontSize: prefs.textSize,
          lineHeight: prefs.textLine,
          textAlign: prefs.textJustify ? 'justify' : 'start',
        }}
      >
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
          const content = pages.get(page);
          return (
            <section key={page} data-page={page} style={content ? undefined : { minHeight: '70dvh' }}>
              <button
                type="button"
                onClick={() => onOriginal(page)}
                aria-label={t('reader.text.original', { n: page })}
                title={t('reader.text.original', { n: page })}
                className="page-mark w-full rounded-md hover:text-[var(--paper-ink)]"
              >
                <span className="inline-flex min-h-9 items-center gap-1.5 px-2">
                  <FileText className="size-3.5" aria-hidden="true" /> {t('tools.pageN', { n: page })}
                </span>
              </button>
              {content?.items.length === 0 && <p className="text-center text-[0.85em] text-[var(--paper-soft)]">{t('reader.text.emptyPage')}</p>}
              {content?.items.map((item, i) =>
                item.kind === 'figure' ? (
                  <figure key={i}>
                    <img src={item.figure.url} alt={t('reader.text.figure', { n: page })} width={item.figure.width} height={item.figure.height} loading="lazy" />
                  </figure>
                ) : item.block.kind === 'heading' ? (
                  item.block.level === 2 ? <h2 key={i}>{item.block.text}</h2> : <h3 key={i}>{item.block.text}</h3>
                ) : (
                  <p key={i}>{item.block.text}</p>
                ),
              )}
            </section>
          );
        })}
      </article>
    </div>
  );
});
