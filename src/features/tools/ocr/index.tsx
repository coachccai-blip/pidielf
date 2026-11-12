// OCR : rend un PDF scanné cherchable et sélectionnable. Chaque page est
// rendue en image, lue par tesseract.js, puis le texte reconnu est posé en
// couche invisible — la page d'origine reste telle quelle.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock, Copy, Download, FileSearch, Info, SkipForward, TriangleAlert } from 'lucide-react';
import { suggestName } from '@/core/naming';
import type { OcrPage } from '@/core/pdf/ocrLayer';
import { formatPageList, pagesForScope, type PageScope } from '@/core/ranges';
import { currentLang, formatBytes, formatPercent, useT } from '@/i18n';
import { createOcrEngine, ocrDownloadSize, ocrDownloaded, OcrLoadError, ocrScale, type OcrLang } from '@/lib/ocr';
import { openPdf, renderPage, type PDFDocumentProxy } from '@/lib/pdfjs';
import { useToolSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Field, Segmented, Select, Switch, TextInput } from '@/ui/Fields';
import { toastError, toastSuccess } from '@/ui/toast';
import { pdfOp } from '@/workers/client';
import { inputBytes, pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { OutputFile, ToolProps } from '../types';
import { PageThumb, usePdf } from '../usePdf';

const ocrLayer = pdfOp<typeof import('@/core/pdf/ocrLayer')>('ocrLayer');

/** Texte déjà présent dans une page (vide pour une page purement scannée). */
async function pageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('').trim();
}

export default function Ocr({ inputs, run }: ToolProps) {
  const t = useT();
  const input = inputs[0];
  const [settings, setSettings] = useToolSettings('ocr', {
    lang: (currentLang() === 'fr' ? 'fra' : 'eng') as OcrLang,
    skipText: true,
    exportText: false,
  });
  const [scope, setScope] = useState<PageScope>('all');
  const [custom, setCustom] = useState('');
  const [problem, setProblem] = useState<'load' | 'noText' | null>(null);
  const [downloaded, setDownloaded] = useState(true);
  const pdf = usePdf(input.blob);

  // Repère les pages qui contiennent déjà du texte ; `withText` vaut null tant que l'analyse court.
  const [withText, setWithText] = useState<Set<number> | null>(null);
  const [analysed, setAnalysed] = useState(0);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setWithText(null);
    setAnalysed(0);
    void (async () => {
      const found = new Set<number>();
      for (let p = 1; p <= pdf.numPages && !cancelled; p++) {
        if (await pageText(pdf, p).catch(() => '')) found.add(p);
        if (!cancelled && (p % 10 === 0 || p === pdf.numPages)) setAnalysed(p);
      }
      if (!cancelled) setWithText(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  useEffect(() => {
    let cancelled = false;
    void ocrDownloaded(settings.lang).then((ok) => !cancelled && setDownloaded(ok));
    return () => {
      cancelled = true;
    };
  }, [settings.lang]);

  const selected = useMemo(() => pagesForScope(scope, input.pageCount, custom), [scope, input.pageCount, custom]);
  const skipped = useMemo(() => (settings.skipText && withText ? (selected ?? []).filter((p) => withText.has(p)) : []), [settings.skipText, withText, selected]);
  const targets = useMemo(() => (selected ?? []).filter((p) => !skipped.includes(p)), [selected, skipped]);
  const analysing = settings.skipText && withText === null;

  const start = () =>
    run(async (ctx) => {
      setProblem(null);
      const stop = () => new DOMException('Annulé', 'AbortError');
      // Chargement du moteur et écriture finale comptent chacun pour une demi-page dans la progression.
      const ratio = (done: number) => (0.5 + done) / (targets.length + 1);
      ctx.progress(0, t('ocr.loading'));
      const doc = await openPdf(input.blob);
      const pages: OcrPage[] = [];
      const texts = new Map<number, string>();
      let confidence = 0;
      let words = 0;
      try {
        const engine = await createOcrEngine(settings.lang, { signal: ctx.signal, onLoading: (r) => ctx.progress(r * ratio(0), t('ocr.loading')) }).catch((err: unknown) => {
          if (!(err instanceof OcrLoadError)) throw err;
          // Premier usage hors connexion, le plus souvent : on l'explique sur place plutôt que par une erreur générique.
          console.error(err);
          setProblem('load');
          throw stop();
        });
        try {
          for (const [i, pageNumber] of targets.entries()) {
            if (ctx.signal.aborted) throw stop();
            const label = t('tools.pageOf', { n: i + 1, total: targets.length });
            ctx.progress(ratio(i), label);
            const page = await doc.getPage(pageNumber);
            const base = page.getViewport({ scale: 1 });
            const scale = ocrScale(base.width, base.height);
            const canvas = await renderPage(page, { scale });
            const result = await engine.recognize(canvas, Math.round(scale * 72), (r) => ctx.progress(ratio(i + 0.1 + 0.9 * r), label));
            pages.push({ page: pageNumber, width: canvas.width, height: canvas.height, words: result.words });
            texts.set(pageNumber, result.text.trim());
            confidence += result.confidence * result.words.length;
            words += result.words.length;
            // Le canvas est libéré tout de suite : sur téléphone, la mémoire graphique est comptée.
            canvas.width = canvas.height = 0;
            page.cleanup();
          }
        } finally {
          engine.terminate();
        }
        if (words === 0) {
          setProblem('noText');
          throw stop();
        }
        if (settings.exportText) for (const p of skipped) texts.set(p, await pageText(doc, p));
      } finally {
        void doc.loadingTask.destroy();
      }

      ctx.progress(ratio(targets.length), t('ocr.writing'));
      const bytes = await ocrLayer('addTextLayer', { bytes: await inputBytes(input), pages }, { signal: ctx.signal });
      const text = [...texts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([p, body]) => (input.pageCount > 1 ? `— ${t('tools.pageN', { n: p })} —\n\n${body}` : body))
        .join('\n\n\n');
      const outputs: OutputFile[] = [{ name: suggestName(input.name, t('ocr.suffix')), blob: pdfBlob(bytes), pageCount: input.pageCount }];
      if (settings.exportText) outputs.push({ name: suggestName(input.name, t('ocr.suffix'), 'txt'), blob: new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' }) });
      const average = confidence / words / 100;
      const note = [
        t('ocr.noteDone', { count: targets.length }),
        t('ocr.noteWords', { words }),
        skipped.length > 0 && t('ocr.noteSkipped', { count: skipped.length }),
        t('ocr.noteConfidence', { pct: formatPercent(average) }),
        average < 0.7 && t('ocr.noteLow'),
      ];
      return { outputs, note: note.filter(Boolean).join(' '), extra: <RecognisedText text={text} /> };
    });

  const hint =
    selected === null
      ? t('tools.invalidRange')
      : analysing
        ? t('ocr.analysing', { n: analysed, total: input.pageCount })
        : targets.length === 0
          ? t('ocr.nothing')
          : t('ocr.summary', { count: targets.length });

  return (
    <ToolLayout
      preview={
        <div className="flex flex-col gap-3">
          {problem && (
            <p role="alert" className="flex gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
              <span>{t(problem === 'load' ? 'ocr.loadFailed' : 'ocr.noText')}</span>
            </p>
          )}
          <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-soft sm:flex-row sm:items-start" aria-label={t('ocr.previewTitle')}>
            <PageThumb pdf={pdf} page={1} width={220} className="w-32 shrink-0 self-center rounded-sm border border-line sm:w-44 sm:self-start" />
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl">{t('ocr.previewTitle')}</h2>
              <p className="truncate text-sm text-ink-soft">{input.name} · {t('common.pages', { count: input.pageCount })} · {formatBytes(input.blob.size)}</p>
              <ul className="mt-3 flex flex-col gap-2 text-sm" aria-live="polite">
                <li className="flex items-start gap-2">
                  <FileSearch className="mt-0.5 size-4 shrink-0 text-cat-ink" aria-hidden="true" />
                  <span>
                    {analysing
                      ? t('ocr.analysing', { n: analysed, total: input.pageCount })
                      : t('ocr.willRead', { count: targets.length, lang: t(`ocr.langName.${settings.lang}`) })}
                    {!analysing && targets.length > 0 && targets.length < input.pageCount && ` ${t('ocr.pagesList', { list: formatPageList(targets) })}`}
                  </span>
                </li>
                {skipped.length > 0 && (
                  <li className="flex items-start gap-2">
                    <SkipForward className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
                    <span>{t('ocr.willSkip', { count: skipped.length })} {t('ocr.pagesList', { list: formatPageList(skipped) })}</span>
                  </li>
                )}
              </ul>
              <p className="mt-3 text-sm text-ink-soft">{t('ocr.untouched')}</p>
            </div>
          </section>
        </div>
      }
      options={
        <>
          <OptionGroup title={t('ocr.language')}>
            <Segmented<OcrLang>
              label={t('ocr.language')}
              value={settings.lang}
              onChange={(lang) => setSettings({ lang })}
              options={[
                { value: 'fra', label: t('ocr.lang.fra') },
                { value: 'eng', label: t('ocr.lang.eng') },
                { value: 'fra+eng', label: t('ocr.lang.both') },
              ]}
            />
            {settings.lang === 'fra+eng' && <p className="text-xs text-ink-soft">{t('ocr.bothHint')}</p>}
          </OptionGroup>
          <OptionGroup title={t('tools.scope.title')}>
            <Select<PageScope>
              aria-label={t('tools.scope.title')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: t('tools.scope.all') },
                { value: 'custom', label: t('tools.scope.custom') },
              ]}
            />
            {scope === 'custom' && (
              <Field label={t('tools.scope.pages')} hint={t('tools.scope.pagesHint')}>
                <TextInput value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1-3, 5" aria-invalid={selected === null} />
              </Field>
            )}
            <Switch checked={settings.skipText} onChange={(skipText) => setSettings({ skipText })} label={t('ocr.skipText')} hint={t('ocr.skipTextHint')} />
          </OptionGroup>
          <OptionGroup title={t('ocr.output')}>
            <Switch checked={settings.exportText} onChange={(exportText) => setSettings({ exportText })} label={t('ocr.exportText')} hint={t('ocr.exportTextHint')} />
          </OptionGroup>
          <ul className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm">
            {!downloaded && (
              <li className="flex items-start gap-2">
                <Download className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
                <span>{t('ocr.downloadHint', { size: formatBytes(ocrDownloadSize(settings.lang)) })}</span>
              </li>
            )}
            <li className="flex items-start gap-2">
              <Clock className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
              <span>{t('ocr.speedHint')}</span>
            </li>
            <li className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
              <span>{t('ocr.limits')}</span>
            </li>
          </ul>
        </>
      }
      actionLabel={t('ocr.action')}
      actionHint={hint}
      actionDisabled={selected === null || analysing || targets.length === 0}
      onAction={start}
    />
  );
}

/** Texte reconnu, sur l'écran de résultat : à relire d'un coup d'œil ou à copier. */
function RecognisedText({ text }: { text: string }) {
  const t = useT();
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => toastSuccess(t('ocr.copied')),
      () => toastError(t('errors.generic')),
    );
  return (
    <details className="group">
      <summary className="flex min-h-11 list-none items-center justify-between gap-2 rounded-md font-semibold [&::-webkit-details-marker]:hidden">
        {t('ocr.recognised')}
        <ChevronDown className="size-5 transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <pre className="scrollbar-thin mt-2 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 font-sans text-sm whitespace-pre-wrap">{text.length > 20_000 ? `${text.slice(0, 20_000)}…` : text}</pre>
      <Button icon={<Copy />} onClick={copy} className="mt-3">{t('ocr.copy')}</Button>
    </details>
  );
}
