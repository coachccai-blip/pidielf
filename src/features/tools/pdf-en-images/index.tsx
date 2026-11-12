// PDF en images : chaque page devient un JPG, un PNG ou un WebP à la résolution
// choisie ; ou bien les images contenues dans le PDF sont récupérées une à une.
import { useEffect, useMemo, useState } from 'react';
import { Images, TriangleAlert } from 'lucide-react';
import { ToolError } from '@/core/errors';
import { planRender, type RenderPlan } from '@/core/image/size';
import { padNumber, sanitizeFileName, splitName } from '@/core/naming';
import { pagesForScope, type PageScope } from '@/core/ranges';
import { formatBytes, useT } from '@/i18n';
import { canvasBlob, canvasLimits, releaseCanvas, supportsWebp } from '@/lib/images';
import { openPdf, renderPage, type PDFDocumentProxy } from '@/lib/pdfjs';
import { useToolSettings } from '@/lib/settings';
import { cn } from '@/ui/cn';
import { Field, Segmented, Select, Slider, Spinner, Switch, TextInput } from '@/ui/Fields';
import { toastError } from '@/ui/toast';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { OutputFile, ToolProps } from '../types';
import { usePdf } from '../usePdf';
import { extractPageImages, newMemory, type ExtractedImage } from './extract';

type Mode = 'pages' | 'extract';
type Format = 'jpg' | 'png' | 'webp';
type Dpi = '72' | '150' | '300';

const MIME: Record<Format, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** Pages analysées pour l'aperçu des images contenues. */
const PREVIEW_PAGES = 5;
const PREVIEW_IMAGES = 12;

const aborted = () => new DOMException('Annulé', 'AbortError');

export default function PdfEnImages({ inputs, run }: ToolProps) {
  const t = useT();
  const input = inputs[0];
  const pdf = usePdf(input.blob);
  const [settings, setSettings] = useToolSettings('pdf-en-images', {
    mode: 'pages' as Mode,
    format: 'jpg' as Format,
    dpi: '150' as Dpi,
    quality: 85,
    skipSmall: true,
  });
  const [scope, setScope] = useState<PageScope>('all');
  const [custom, setCustom] = useState('');
  const webp = useWebp();

  // Le WebP n'est proposé que si le navigateur sait vraiment l'écrire.
  const format: Format = settings.format === 'webp' && !webp ? 'jpg' : settings.format;
  const lossy = format !== 'png';
  const dpi = Number(settings.dpi);
  const quality = settings.quality / 100;
  const pages = useMemo(() => pagesForScope(scope, input.pageCount, custom), [scope, input.pageCount, custom]);
  const count = pages?.length ?? 0;
  const base = splitName(input.name).base || 'document';

  const exportPages = () =>
    run(async (ctx) => {
      const doc = await openPdf(input.blob);
      try {
        const list = pages ?? [];
        const limits = canvasLimits();
        const outputs: OutputFile[] = [];
        let reduced = 0;
        for (const [i, n] of list.entries()) {
          if (ctx.signal.aborted) throw aborted();
          ctx.progress(i / list.length, t('tools.pageOf', { n: i + 1, total: list.length }));
          const page = await doc.getPage(n);
          const size = page.getViewport({ scale: 1 });
          const plan = planRender(size.width, size.height, dpi, limits);
          const canvas = await renderPage(page, { scale: plan.scale });
          try {
            const blob = await canvasBlob(canvas, MIME[format], lossy ? quality : undefined);
            outputs.push({ name: sanitizeFileName(`${base}_${t('pdf-en-images.pageWord')}-${padNumber(n, input.pageCount)}.${format}`), blob });
          } finally {
            // Un seul canvas en mémoire à la fois.
            releaseCanvas(canvas);
            page.cleanup();
          }
          if (plan.reduced) reduced++;
        }
        return { outputs, note: reduced > 0 ? t('pdf-en-images.reducedNote', { count: reduced }) : undefined };
      } finally {
        void doc.loadingTask.destroy();
      }
    });

  const extractImages = () =>
    run(async (ctx) => {
      const doc = await openPdf(input.blob);
      try {
        const list = pages ?? [];
        const memory = newMemory();
        const found: ExtractedImage[] = [];
        for (const [i, n] of list.entries()) {
          if (ctx.signal.aborted) throw aborted();
          ctx.progress(i / list.length, t('tools.pageOf', { n: i + 1, total: list.length }));
          found.push(...(await extractPageImages(await doc.getPage(n), { skipSmall: settings.skipSmall, memory })));
        }
        if (found.length === 0) {
          // Le message générique de la coquille ne dit pas pourquoi : on le précise.
          toastError(t('pdf-en-images.noImages'));
          throw new ToolError('empty', 'Aucune image incorporée dans les pages choisies.');
        }
        return found.map((image, k) => ({
          name: sanitizeFileName(`${base}_${t('pdf-en-images.imageWord')}-${padNumber(k + 1, found.length)}.${image.ext}`),
          blob: image.blob,
        }));
      } finally {
        void doc.loadingTask.destroy();
      }
    });

  const extract = settings.mode === 'extract';
  return (
    <ToolLayout
      preview={
        extract ? (
          <ExtractPreview pdf={pdf} pages={pages ?? []} skipSmall={settings.skipSmall} />
        ) : (
          <PagePreview pdf={pdf} page={pages?.[0]} dpi={dpi} mime={MIME[format]} quality={lossy ? quality : undefined} count={count} />
        )
      }
      options={
        <>
          <OptionGroup title={t('pdf-en-images.mode')}>
            <Segmented<Mode>
              label={t('pdf-en-images.mode')}
              value={settings.mode}
              onChange={(mode) => setSettings({ mode })}
              options={[
                { value: 'pages', label: t('pdf-en-images.modePages') },
                { value: 'extract', label: t('pdf-en-images.modeExtract') },
              ]}
            />
            <p className="text-sm text-ink-soft">{t(extract ? 'pdf-en-images.modeExtractHint' : 'pdf-en-images.modePagesHint')}</p>
          </OptionGroup>

          {!extract && (
            <>
              <OptionGroup title={t('pdf-en-images.format')}>
                <Segmented<Format>
                  label={t('pdf-en-images.format')}
                  value={format}
                  onChange={(f) => setSettings({ format: f })}
                  options={[
                    { value: 'jpg', label: 'JPG' },
                    { value: 'png', label: 'PNG' },
                    ...(webp ? [{ value: 'webp' as const, label: 'WebP' }] : []),
                  ]}
                />
                <p className="text-sm text-ink-soft">{t(`pdf-en-images.format${format === 'jpg' ? 'Jpg' : format === 'png' ? 'Png' : 'Webp'}Hint`)}</p>
              </OptionGroup>
              <OptionGroup title={t('pdf-en-images.resolution')}>
                <Segmented<Dpi>
                  label={t('pdf-en-images.resolution')}
                  value={settings.dpi}
                  onChange={(d) => setSettings({ dpi: d })}
                  options={(['72', '150', '300'] as const).map((d) => ({ value: d, label: t('pdf-en-images.dpi', { n: d }) }))}
                />
                <p className="text-sm text-ink-soft">{t(`pdf-en-images.dpi${settings.dpi}Hint`)}</p>
                {lossy && (
                  <Slider label={t('pdf-en-images.quality')} value={settings.quality} onChange={(q) => setSettings({ quality: q })} min={50} max={100} step={5} format={(v) => `${v} %`} />
                )}
              </OptionGroup>
            </>
          )}

          <OptionGroup title={t('tools.scope.title')}>
            <Select<PageScope>
              aria-label={t('tools.scope.title')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: t('tools.scope.all') },
                { value: 'odd', label: t('tools.scope.odd') },
                { value: 'even', label: t('tools.scope.even') },
                { value: 'custom', label: t('tools.scope.custom') },
              ]}
            />
            {scope === 'custom' && (
              <Field label={t('tools.scope.pages')} hint={t('tools.scope.pagesHint')}>
                <TextInput value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1-3, 5" aria-invalid={pages === null} />
              </Field>
            )}
          </OptionGroup>

          {extract && (
            <Switch checked={settings.skipSmall} onChange={(skipSmall) => setSettings({ skipSmall })} label={t('pdf-en-images.skipSmall')} hint={t('pdf-en-images.skipSmallHint')} />
          )}
        </>
      }
      actionLabel={t(extract ? 'pdf-en-images.actionExtract' : 'pdf-en-images.actionPages')}
      actionHint={
        pages === null
          ? t('tools.invalidRange')
          : extract
            ? t('pdf-en-images.summaryExtract', { count })
            : t('pdf-en-images.summaryPages', { count, format: format === 'webp' ? 'WebP' : format.toUpperCase() })
      }
      actionDisabled={count === 0}
      onAction={extract ? extractImages : exportPages}
    />
  );
}

function useWebp(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void supportsWebp().then((value) => !cancelled && setOk(value));
    return () => {
      cancelled = true;
    };
  }, []);
  return ok;
}

interface Shot {
  url: string;
  page: number;
  size: number;
  plan: RenderPlan;
}

/**
 * Aperçu fidèle : la première page choisie est rendue à la résolution demandée
 * puis encodée dans le format voulu ; c'est ce fichier qui est affiché.
 */
function PagePreview({
  pdf,
  page,
  dpi,
  mime,
  quality,
  count,
}: {
  pdf: PDFDocumentProxy | null;
  page: number | undefined;
  dpi: number;
  mime: string;
  quality: number | undefined;
  count: number;
}) {
  const t = useT();
  const [rendered, setRendered] = useState<{ canvas: HTMLCanvasElement; page: number; plan: RenderPlan } | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);

  // Rendu de la page : refait seulement si la page ou la résolution change.
  useEffect(() => {
    if (!pdf || !page) return;
    let cancelled = false;
    let canvas: HTMLCanvasElement | null = null;
    setBusy(true);
    setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const proxy = await pdf.getPage(page);
        const size = proxy.getViewport({ scale: 1 });
        const plan = planRender(size.width, size.height, dpi, canvasLimits());
        const drawn = await renderPage(proxy, { scale: plan.scale });
        if (cancelled) {
          releaseCanvas(drawn);
          return;
        }
        canvas = drawn;
        setRendered({ canvas: drawn, page, plan });
      } catch {
        if (!cancelled) {
          setFailed(true);
          setBusy(false);
        }
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (canvas) releaseCanvas(canvas);
    };
  }, [pdf, page, dpi]);

  // Encodage : refait quand le format ou la qualité change, sans redessiner la page.
  useEffect(() => {
    if (!rendered || rendered.canvas.width === 0) return;
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      // Canvas libéré entre-temps : un nouveau rendu est en route, il relancera l'encodage.
      if (rendered.canvas.width === 0) return;
      try {
        const blob = await canvasBlob(rendered.canvas, mime, quality);
        if (cancelled) return;
        setShot({ url: URL.createObjectURL(blob), page: rendered.page, size: blob.size, plan: rendered.plan });
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rendered, mime, quality]);

  // L'ancienne image est libérée dès qu'une nouvelle la remplace.
  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  if (!page) return null;
  return (
    <figure className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
      <div className="relative grid min-h-48 place-items-center">
        {shot && !failed ? (
          <img
            src={shot.url}
            alt={t('pdf-en-images.previewAlt', { n: shot.page })}
            className={cn('max-h-[48dvh] max-w-full rounded-[2px] lg:max-h-[62dvh] bg-white object-contain shadow-soft transition-opacity duration-150', busy && 'opacity-60')}
          />
        ) : failed ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-semibold text-danger">
            <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
            {t('pdf-en-images.previewFailed')}
          </p>
        ) : null}
        {busy && (
          <span role="status" className={cn('flex items-center gap-2 text-sm text-ink-soft', shot && 'absolute top-2 right-2 rounded-full bg-surface px-3 py-1.5 shadow-soft')}>
            <Spinner /> {t('pdf-en-images.previewLoading')}
          </span>
        )}
      </div>
      {shot && !failed && (
        <figcaption className="flex flex-col gap-1 text-sm">
          <p className="font-bold">{t('pdf-en-images.previewTitle', { n: shot.page })}</p>
          <p className="text-ink-soft tabular-nums">
            {t('pdf-en-images.previewSize', { width: shot.plan.width, height: shot.plan.height })} · {t('pdf-en-images.previewWeight', { size: formatBytes(shot.size) })}
          </p>
          {count > 1 && <p className="text-ink-soft tabular-nums">{t('pdf-en-images.estimate', { count, size: formatBytes(shot.size * count) })}</p>}
          {shot.plan.reduced && (
            <p role="status" className="mt-1 flex gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('pdf-en-images.reduced', { dpi: shot.plan.dpi, wanted: dpi })}
            </p>
          )}
        </figcaption>
      )}
    </figure>
  );
}

interface Found {
  url: string;
  width: number;
  height: number;
}

/** Aperçu des images contenues : les premières pages choisies sont analysées. */
function ExtractPreview({ pdf, pages, skipSmall }: { pdf: PDFDocumentProxy | null; pages: number[]; skipSmall: boolean }) {
  const t = useT();
  const [found, setFound] = useState<Found[] | null>(null);
  const sample = pages.slice(0, PREVIEW_PAGES);
  const sampleKey = sample.join(',');

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    const urls: string[] = [];
    setFound(null);
    void (async () => {
      const memory = newMemory();
      const images: Found[] = [];
      try {
        for (const n of sampleKey ? sampleKey.split(',').map(Number) : []) {
          if (cancelled) return;
          for (const image of await extractPageImages(await pdf.getPage(n), { skipSmall, memory })) {
            const url = URL.createObjectURL(image.blob);
            urls.push(url);
            images.push({ url, width: image.width, height: image.height });
          }
        }
      } catch {
        /* page illisible : l'aperçu montre ce qui a été trouvé jusque-là */
      }
      if (!cancelled) setFound(images);
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pdf, sampleKey, skipSmall]);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex gap-2.5 rounded-xl bg-cat px-3.5 py-3 text-sm text-cat-ink">
        <Images className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        {t('pdf-en-images.extractHonest')}
      </p>
      <section className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3" aria-live="polite">
        {found === null ? (
          <p role="status" className="flex min-h-24 items-center justify-center gap-2 text-sm text-ink-soft">
            <Spinner /> {t('pdf-en-images.extractScanning')}
          </p>
        ) : (
          <>
            <p className="text-sm font-bold">{found.length > 0 ? t('pdf-en-images.extractFound', { count: found.length }) : t('pdf-en-images.extractNoneYet')}</p>
            {found.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {found.slice(0, PREVIEW_IMAGES).map((image, i) => (
                  <li key={image.url} className="flex flex-col items-center gap-1">
                    <span className="relative aspect-square w-full rounded-md bg-surface">
                      <img
                        src={image.url}
                        alt={t('pdf-en-images.extractImageAlt', { n: i + 1, width: image.width, height: image.height })}
                        className="absolute inset-1.5 size-[calc(100%-0.75rem)] object-contain"
                      />
                    </span>
                    <span className="text-xs text-ink-soft tabular-nums">{image.width} × {image.height}</span>
                  </li>
                ))}
              </ul>
            )}
            {pages.length > sample.length && <p className="text-sm text-ink-soft">{t('pdf-en-images.extractPartial', { n: sample.length })}</p>}
          </>
        )}
      </section>
    </div>
  );
}
