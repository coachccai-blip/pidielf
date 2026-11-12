// Diviser : découpe un PDF par plages, toutes les N pages, page par page ou
// selon les chapitres du sommaire, avec un aperçu des coupes.
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronsUp } from 'lucide-react';
import { formatPageList } from '@/core/ranges';
import {
  MANY_PARTS, buildParts, defaultRangesText, formatRange, hasUsableChapters, isWholeDocument, partNames, partSize, uncoveredPages,
  type Chapter, type SplitMode, type SplitPart,
} from '@/core/splitPlan';
import { useT } from '@/i18n';
import type { PDFDocumentProxy } from '@/lib/pdfjs';
import { useToolSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Field, NumberInput, Spinner, Switch, TextInput } from '@/ui/Fields';
import { pdfOp } from '@/workers/client';
import { inputBytes, pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { ToolProps } from '../types';
import { PageThumb, usePdf } from '../usePdf';
import { readChapters } from './outline';

const split = pdfOp<typeof import('@/core/pdf/split')>('split');

// L'outil est remonté quand on revient du résultat vers les réglages : la
// saisie des plages du fichier en cours est gardée ici pour ne pas la perdre.
let draft: { key: string; text: string } | null = null;

/** Parties affichées d'emblée ; les suivantes viennent à la demande (aperçu fluide sur un long document). */
const PARTS_STEP = 48;
/** Une partie plus longue est repliée : on ne montre que ses premières et dernières pages, là où passent les coupes. */
const FOLD_OVER = 10;
const FOLD_HEAD = 4;
const FOLD_TAIL = 3;

const DESKTOP = '(min-width: 1024px)';
/** Sur téléphone, les réglages passent au-dessus de l'aperçu : on choisit la découpe avant de la regarder. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = matchMedia(DESKTOP);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => matchMedia(DESKTOP).matches,
  );
}

export default function Diviser(props: ToolProps) {
  return <Splitter key={props.inputs[0].key} {...props} />;
}

function Splitter({ inputs, run }: ToolProps) {
  const t = useT();
  const input = inputs[0];
  const pdf = usePdf(input.blob);
  const desktop = useIsDesktop();
  const group = useId();
  const [settings, setSettings] = useToolSettings('diviser', { mode: 'ranges' as SplitMode, every: 2, chapterNames: true });
  const [rangesText, setRangesText] = useState(() => (draft?.key === input.key ? draft.text : defaultRangesText(input.pageCount)));
  // undefined : sommaire en cours de lecture.
  const [chapters, setChapters] = useState<Chapter[]>();

  useEffect(() => {
    draft = { key: input.key, text: rangesText };
  }, [input.key, rangesText]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void readChapters(pdf).then((list) => {
      if (!cancelled) setChapters(list);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const usable = !!chapters && hasUsableChapters(chapters, input.pageCount);
  // Le dernier réglage était « chapitres » mais ce PDF n'a pas de sommaire : on revient aux plages.
  const mode: SplitMode = settings.mode === 'chapters' && chapters && !usable ? 'ranges' : settings.mode;
  const waiting = mode === 'chapters' && !chapters;
  const every = Math.max(1, Math.floor(settings.every) || 1);

  const parts = useMemo(
    () => (waiting ? null : buildParts({ mode, pageCount: input.pageCount, ranges: rangesText, every, chapters })),
    [waiting, mode, input.pageCount, rangesText, every, chapters],
  );
  const suffix = t('diviser.suffix');
  const names = useMemo(
    () => (parts ? partNames(input.name, parts, suffix, mode === 'chapters' && settings.chapterNames) : []),
    [parts, input.name, suffix, mode, settings.chapterNames],
  );

  const start = () => {
    if (!parts) return;
    run(async (ctx) => {
      const ranges = parts.map(({ from, to }) => ({ from, to }));
      const files = await split('splitPdf', { bytes: await inputBytes(input), ranges }, ctx);
      return files.map((bytes, i) => ({ name: names[i], blob: pdfBlob(bytes), pageCount: partSize(parts[i]) }));
    });
  };

  const hint = waiting
    ? t('diviser.readingOutline')
    : !parts
      ? t('tools.invalidRange')
      : parts.length > MANY_PARTS
        ? t('diviser.manyFiles', { count: parts.length })
        : isWholeDocument(parts, input.pageCount)
          ? t('diviser.whole')
          : t('diviser.summary', { count: parts.length });

  const controls = (
    <>
      <OptionGroup title={t('diviser.mode.title')}>
        <ModeOption name={group} checked={mode === 'ranges'} onSelect={() => setSettings({ mode: 'ranges' })} label={t('diviser.mode.ranges')} hint={t('diviser.mode.rangesHint')} />
        <ModeOption name={group} checked={mode === 'every'} onSelect={() => setSettings({ mode: 'every' })} label={t('diviser.mode.every')} hint={t('diviser.mode.everyHint')} />
        <ModeOption name={group} checked={mode === 'single'} onSelect={() => setSettings({ mode: 'single' })} label={t('diviser.mode.single')} hint={t('diviser.mode.singleHint')} />
        <ModeOption
          name={group}
          checked={mode === 'chapters'}
          onSelect={() => setSettings({ mode: 'chapters' })}
          label={t('diviser.mode.chapters')}
          hint={t('diviser.mode.chaptersHint')}
          // Le mode reste visible même sans sommaire, avec la raison de son indisponibilité.
          unavailable={!chapters ? t('diviser.readingOutline') : !usable ? t('diviser.noOutline') : undefined}
        />
      </OptionGroup>

      {mode === 'ranges' && (
        <Field label={t('diviser.rangesLabel')} hint={t('diviser.rangesHelp')}>
          <TextInput
            value={rangesText}
            onChange={(e) => setRangesText(e.target.value)}
            placeholder="1-3, 5, 8-"
            inputMode="text"
            autoComplete="off"
            aria-invalid={!parts}
            className="aria-[invalid=true]:border-danger"
          />
        </Field>
      )}
      {mode === 'every' && (
        <Field label={t('diviser.everyLabel')}>
          <NumberInput value={every} onChange={(v) => setSettings({ every: Math.max(1, Math.round(v)) })} min={1} max={Math.max(1, input.pageCount)} inputMode="numeric" />
        </Field>
      )}
      {mode === 'chapters' && usable && (
        <Switch
          checked={settings.chapterNames}
          onChange={(v) => setSettings({ chapterNames: v })}
          label={t('diviser.chapterNames')}
          hint={t('diviser.chapterNamesHint')}
        />
      )}

      {names.length > 0 && (
        <p className="text-sm break-words text-ink-soft">
          {names.length === 1 ? t('diviser.nameOne', { name: names[0] }) : t('diviser.names', { first: names[0], last: names[names.length - 1] })}
        </p>
      )}
    </>
  );

  return (
    <ToolLayout
      wide
      preview={
        <div className="flex flex-col gap-5">
          {!desktop && <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-soft">{controls}</div>}
          {waiting ? (
            <p className="flex items-center gap-3 py-10 text-ink-soft" role="status"><Spinner /> {t('diviser.readingOutline')}</p>
          ) : parts ? (
            // La clé remet l'aperçu à zéro (parties affichées, parties dépliées) quand on change de mode.
            <Cuts key={mode} pdf={pdf} parts={parts} pageCount={input.pageCount} />
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong p-4 text-ink-soft">{t('diviser.invalid')}</p>
          )}
        </div>
      }
      options={desktop ? controls : undefined}
      actionLabel={t('diviser.action')}
      actionHint={hint}
      actionDisabled={!parts}
      onAction={start}
    />
  );
}

function ModeOption({ name, checked, onSelect, label, hint, unavailable }: { name: string; checked: boolean; onSelect: () => void; label: string; hint: string; unavailable?: string }) {
  const title = useId();
  const note = useId();
  const noted = checked || !!unavailable;
  return (
    <label
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150',
        checked ? 'border-cat-ink bg-cat text-cat-ink' : 'border-line',
        unavailable ? 'cursor-not-allowed border-dashed' : 'cursor-pointer',
      )}
    >
      {/* Nom et description séparés : la précision n'est lue qu'une fois par les lecteurs d'écran. */}
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={!!unavailable}
        onChange={onSelect}
        aria-labelledby={title}
        aria-describedby={noted ? note : undefined}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span id={title} className={cn('block font-semibold', unavailable && 'text-ink-soft')}>{label}</span>
        {noted && <span id={note} className={cn('block text-sm', !checked && 'text-ink-soft')}>{unavailable ?? hint}</span>}
      </span>
    </label>
  );
}

function Cuts({ pdf, parts, pageCount }: { pdf: PDFDocumentProxy | null; parts: SplitPart[]; pageCount: number }) {
  const t = useT();
  const [limit, setLimit] = useState(PARTS_STEP);
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  const left = useMemo(() => uncoveredPages(parts, pageCount), [parts, pageCount]);
  const rest = parts.length - limit;

  const toggle = (index: number) => {
    const next = new Set(unfolded);
    if (!next.delete(index)) next.add(index);
    setUnfolded(next);
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="diviser-apercu">
      <h2 id="diviser-apercu" className="text-xl">{t('diviser.preview')}</h2>
      <ol className="flex flex-wrap items-start gap-x-2 gap-y-3">
        {parts.slice(0, limit).map((part, index) => (
          <Part key={index} pdf={pdf} part={part} index={index} open={unfolded.has(index)} onToggle={() => toggle(index)} />
        ))}
      </ol>
      {rest > 0 && (
        <Button className="self-start" onClick={() => setLimit(limit + PARTS_STEP)}>
          {t('diviser.moreParts', { count: Math.min(PARTS_STEP, rest), rest })}
        </Button>
      )}
      {left.length > 0 && <p className="text-sm text-ink-soft">{t('diviser.uncovered', { pages: formatPageList(left) })}</p>}
    </section>
  );
}

/** Un fichier à venir : encadré, numéroté, avec ses pages. */
function Part({ pdf, part, index, open, onToggle }: { pdf: PDFDocumentProxy | null; part: SplitPart; index: number; open: boolean; onToggle: () => void }) {
  const t = useT();
  const n = index + 1;
  const size = partSize(part);
  const folded = size > FOLD_OVER && !open;
  const pages = (from: number, count: number) => Array.from({ length: count }, (_, k) => from + k);
  const head = folded ? pages(part.from, FOLD_HEAD) : pages(part.from, size);
  const tail = folded ? pages(part.to - FOLD_TAIL + 1, FOLD_TAIL) : [];
  const range = size === 1 ? t('diviser.pageOne', { page: part.from }) : t('diviser.pageRange', { range: formatRange(part) });

  return (
    <li className="max-w-full min-w-[5.5rem] rounded-lg border border-line-strong bg-surface p-2 shadow-soft">
      {/* w-0 + min-w-full : l'en-tête se plie à la largeur des miniatures, pour des parties d'une page toutes de même largeur. */}
      <p className="mb-2 flex w-0 min-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded-sm bg-cat px-1.5 py-0.5 font-bold text-cat-ink">{t('diviser.part', { n })}</span>
        <span className="text-ink-soft">{range}</span>
        {part.title && <span className="max-w-full min-w-0 truncate font-semibold" title={part.title}>{part.title}</span>}
      </p>
      <ul className="flex flex-wrap gap-2">
        {head.map((page) => <Sheet key={page} pdf={pdf} page={page} />)}
        {folded && (
          <Cell>
            <FoldButton label={t('diviser.unfold', { count: size - FOLD_HEAD - FOLD_TAIL, n })} onClick={onToggle}>
              +{size - FOLD_HEAD - FOLD_TAIL}
            </FoldButton>
          </Cell>
        )}
        {tail.map((page) => <Sheet key={page} pdf={pdf} page={page} />)}
        {size > FOLD_OVER && open && (
          <Cell>
            <FoldButton label={t('diviser.fold', { n })} onClick={onToggle}><ChevronsUp className="size-5" aria-hidden="true" /></FoldButton>
          </Cell>
        )}
      </ul>
    </li>
  );
}

const Cell = ({ children, label }: { children: ReactNode; label?: string }) => (
  <li className="w-[4.25rem] sm:w-20" aria-label={label}>{children}</li>
);

function Sheet({ pdf, page }: { pdf: PDFDocumentProxy | null; page: number }) {
  const t = useT();
  return (
    <Cell label={t('tools.pageN', { n: page })}>
      <span className="grid aspect-square w-full place-items-center rounded-md bg-surface-2 p-1">
        <PageThumb pdf={pdf} page={page} width={96} contain />
      </span>
      <span className="mt-0.5 block text-center text-xs font-bold text-ink-soft tabular-nums" aria-hidden="true">{page}</span>
    </Cell>
  );
}

function FoldButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid aspect-square w-full place-items-center rounded-md border border-dashed border-line-strong text-sm font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-2"
    >
      {children}
    </button>
  );
}
