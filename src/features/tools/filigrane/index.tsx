// Filigrane : un texte ou une image posés sur les pages, à une position de la
// grille ou répétés en mosaïque, avec un aperçu fidèle sur la vraie page.
import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Type } from 'lucide-react';
import { suggestName } from '@/core/naming';
import { stampText, FONT_CSS, TEXT_BASELINE, watermarkCentres, type StampFont, type WatermarkAnchor } from '@/core/pdf/watermarkLayout';
import { pagesForScope, type PageScope } from '@/core/ranges';
import { formatPercent, useT } from '@/i18n';
import { useToolSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Field, Segmented, Select, Slider, Switch, TextInput } from '@/ui/Fields';
import { toastError } from '@/ui/toast';
import { pdfOp } from '@/workers/client';
import { pickFiles } from '@/features/library/import';
import { inputBytes, pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { OutputFile, ToolProps } from '../types';
import { usePdf, type PageSize } from '../usePdf';
import { AnchorGrid, ColorField } from './controls';
import { loadWatermarkImage, type WatermarkImage } from './image';
import { PagePreview, previewTextWidth, StickyPreview, useWideScreen } from './PagePreview';

const watermark = pdfOp<typeof import('@/core/pdf/watermark')>('watermark');

const ANCHORS: WatermarkAnchor[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
const FONTS: StampFont[] = ['sans', 'serif', 'mono'];
const ANGLES = ['0', '45', '-45', '90'];
/** « −45° », avec un vrai signe moins. */
const degreesLabel = (angle: number | string): string => `${angle}°`.replace('-', '−');

interface Settings {
  kind: 'text' | 'image';
  text: string;
  font: StampFont;
  bold: boolean;
  /** Corps du texte, en points. */
  size: number;
  color: string;
  /** Largeur de l'image, en pourcentage de la largeur de la page. */
  imageWidth: number;
  /** En pourcentage. */
  opacity: number;
  rotation: number;
  position: WatermarkAnchor;
  tile: boolean;
  gap: number;
  scope: PageScope;
}

export default function Filigrane({ inputs, run }: ToolProps) {
  const t = useT();
  const [s, set] = useToolSettings<Settings>('filigrane', {
    kind: 'text',
    text: t('filigrane.defaultText'),
    font: 'sans',
    bold: true,
    size: 48,
    color: '#c62828',
    imageWidth: 40,
    opacity: 30,
    rotation: 45,
    position: 'mc',
    tile: false,
    gap: 60,
    scope: 'all',
  });
  const [custom, setCustom] = useState('');
  const [current, setCurrent] = useState(0);
  const [page, setPage] = useState(1);
  const [image, setImage] = useState<WatermarkImage | null>(null);
  const wide = useWideScreen();
  const batch = inputs.length > 1;
  const input = inputs[Math.min(current, inputs.length - 1)];
  const pdf = usePdf(input.blob);
  const shown = Math.min(page, input.pageCount);

  // L'image n'est jamais mémorisée : son adresse d'aperçu est libérée dès qu'elle ne sert plus.
  useEffect(() => () => (image ? URL.revokeObjectURL(image.url) : undefined), [image]);

  // En lot, une sélection manuelle n'a pas de sens : la même règle vaut pour tous les fichiers.
  const scope: PageScope = batch && s.scope === 'custom' ? 'all' : s.scope;
  const targets = useMemo(() => pagesForScope(scope, input.pageCount, custom), [scope, input.pageCount, custom]);
  const count = targets?.length ?? 0;

  const text = stampText(s.text);
  const replaced = text !== s.text.replace(/\s+/g, ' ').trim();
  const textWidth = useMemo(() => previewTextWidth(text, s.font, s.bold, s.size), [text, s.font, s.bold, s.size]);
  const ready = s.kind === 'text' ? text !== '' : image !== null;
  const layout = { position: s.position, rotation: s.rotation, tile: s.tile, gap: s.gap };

  const chooseImage = async () => {
    const [file] = await pickFiles({ accept: 'image/*', multiple: false });
    if (!file) return;
    try {
      setImage(await loadWatermarkImage(file));
    } catch {
      toastError(t('filigrane.imageError'));
    }
  };

  const start = () =>
    run(async (ctx) => {
      const content =
        s.kind === 'text'
          ? ({ kind: 'text', text, font: s.font, bold: s.bold, size: s.size, color: s.color } as const)
          : ({ kind: 'image', data: image!.data, mime: image!.mime, width: s.imageWidth / 100 } as const);
      const outputs: OutputFile[] = [];
      for (const [i, file] of inputs.entries()) {
        const label = batch ? t('tools.fileOf', { n: i + 1, total: inputs.length }) : undefined;
        ctx.progress(i / inputs.length, label);
        const pages = pagesForScope(scope, file.pageCount, custom) ?? [];
        // Dans un lot, un fichier sans page concernée (une seule page, « pages paires ») est rendu tel quel.
        const blob = pages.length
          ? pdfBlob(
              await watermark(
                'watermarkPdf',
                { bytes: await inputBytes(file), content, opacity: s.opacity / 100, ...layout, pages },
                { signal: ctx.signal, progress: (ratio) => ctx.progress((i + ratio) / inputs.length, label) },
              ),
            )
          : file.blob;
        outputs.push({ name: suggestName(file.name, t('filigrane.suffix')), blob, pageCount: file.pageCount, parentId: file.libraryId });
      }
      return outputs;
    });

  // Calque d'aperçu : mêmes centres, mêmes tailles et même rotation que dans le PDF produit.
  const overlay = (size: PageSize) => {
    if (!ready || !targets?.includes(shown)) return null;
    const width = s.kind === 'text' ? textWidth : (s.imageWidth / 100) * size.width;
    const height = s.kind === 'text' ? s.size : (width * image!.height) / image!.width;
    return watermarkCentres(size, { width, height }, layout).map((centre, i) => {
      const y = size.height - centre.y;
      const transform = `rotate(${-s.rotation} ${centre.x} ${y})`;
      return s.kind === 'text' ? (
        <text
          key={i}
          x={centre.x}
          y={y + TEXT_BASELINE * s.size}
          textAnchor="middle"
          fontSize={s.size}
          fontFamily={FONT_CSS[s.font]}
          fontWeight={s.bold ? 700 : 400}
          fill={s.color}
          fillOpacity={s.opacity / 100}
          transform={transform}
        >
          {text}
        </text>
      ) : (
        <image key={i} href={image!.url} x={centre.x - width / 2} y={y - height / 2} width={width} height={height} preserveAspectRatio="none" opacity={s.opacity / 100} transform={transform} />
      );
    });
  };

  const preview = (
    <div className="flex flex-col gap-3 lg:sticky lg:top-4">
      {batch && (
        <Select
          aria-label={t('tools.previewFile')}
          value={String(Math.min(current, inputs.length - 1))}
          onChange={(v) => {
            setCurrent(Number(v));
            setPage(1);
          }}
          options={inputs.map((f, i) => ({ value: String(i), label: f.name }))}
        />
      )}
      <PagePreview
        key={input.key}
        pdf={pdf}
        pageCount={input.pageCount}
        page={shown}
        onPage={setPage}
        compact={!wide}
        caption={targets && !targets.includes(shown) ? t('filigrane.notOnPage') : undefined}
      >
        {overlay}
      </PagePreview>
      {wide && <p className="text-center text-sm text-ink-soft">{batch ? t('filigrane.hintBatch') : t('filigrane.above')}</p>}
    </div>
  );

  return (
    <ToolLayout
      preview={wide ? preview : undefined}
      options={
        <>
          {!wide && <StickyPreview>{preview}</StickyPreview>}
          <OptionGroup title={t('filigrane.content')}>
            <Segmented<Settings['kind']>
              label={t('filigrane.kind')}
              value={s.kind}
              onChange={(kind) => set({ kind })}
              options={[
                { value: 'text', label: t('filigrane.kindText'), icon: <Type /> },
                { value: 'image', label: t('filigrane.kindImage'), icon: <ImageIcon /> },
              ]}
            />
            {s.kind === 'text' ? (
              <>
                <Field label={t('filigrane.text')} hint={t('filigrane.textHint')}>
                  <TextInput value={s.text} maxLength={80} onChange={(e) => set({ text: e.target.value })} />
                </Field>
                {replaced && text !== '' && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-ink" role="status">{t('filigrane.textReplaced')}</p>}
                <Field label={t('filigrane.font')}>
                  <Select<StampFont> value={s.font} onChange={(font) => set({ font })} options={FONTS.map((f) => ({ value: f, label: t(`filigrane.fonts.${f}`) }))} />
                </Field>
                <Switch checked={s.bold} onChange={(bold) => set({ bold })} label={t('filigrane.bold')} />
                <ColorField label={t('filigrane.color')} value={s.color} onChange={(color) => set({ color })} />
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  {image && <img src={image.url} alt="" className="size-11 shrink-0 rounded-md border border-line bg-white object-contain" />}
                  <Button icon={<ImageIcon />} onClick={chooseImage} className="min-w-0 flex-1">
                    <span className="truncate">{image ? t('filigrane.changeImage') : t('filigrane.chooseImage')}</span>
                  </Button>
                </div>
                {image && <p className="truncate text-sm font-semibold">{image.name}</p>}
                <p className="text-xs text-ink-soft">{t('filigrane.imageHint')}</p>
              </>
            )}
          </OptionGroup>

          <OptionGroup title={t('filigrane.look')}>
            {s.kind === 'text' ? (
              <Slider label={t('filigrane.size')} value={s.size} min={8} max={200} step={2} onChange={(size) => set({ size })} format={(v) => t('filigrane.points', { n: v })} />
            ) : (
              <Slider
                label={t('filigrane.imageWidth')}
                value={s.imageWidth}
                min={5}
                max={100}
                step={5}
                onChange={(imageWidth) => set({ imageWidth })}
                format={(v) => t('filigrane.ofPage', { pct: formatPercent(v / 100) })}
              />
            )}
            <Slider label={t('filigrane.opacity')} value={s.opacity} min={5} max={100} step={5} onChange={(opacity) => set({ opacity })} format={(v) => formatPercent(v / 100)} />
            <Slider label={t('filigrane.rotation')} value={s.rotation} min={-180} max={180} step={5} onChange={(rotation) => set({ rotation })} format={degreesLabel} />
            <Segmented
              size="sm"
              label={t('filigrane.rotationPresets')}
              value={String(s.rotation)}
              onChange={(v) => set({ rotation: Number(v) })}
              options={ANGLES.map((a) => ({ value: a, label: degreesLabel(a) }))}
            />
          </OptionGroup>

          <OptionGroup title={t('filigrane.placement')}>
            <AnchorGrid<WatermarkAnchor>
              label={t('filigrane.placement')}
              value={s.position}
              onChange={(position) => set({ position })}
              disabled={s.tile}
              options={ANCHORS.map((a) => ({ value: a, label: t(`filigrane.anchor.${a}`) }))}
            />
            <Switch checked={s.tile} onChange={(tile) => set({ tile })} label={t('filigrane.tile')} hint={t('filigrane.tileHint')} />
            {s.tile && <Slider label={t('filigrane.gap')} value={s.gap} min={0} max={300} step={10} onChange={(gap) => set({ gap })} format={(v) => t('filigrane.points', { n: v })} />}
          </OptionGroup>

          <OptionGroup title={t('tools.scope.title')}>
            <Select<PageScope>
              aria-label={t('tools.scope.title')}
              value={scope}
              onChange={(next) => set({ scope: next })}
              options={[
                { value: 'all', label: t('tools.scope.all') },
                { value: 'odd', label: t('tools.scope.odd') },
                { value: 'even', label: t('tools.scope.even') },
                ...(batch ? [] : [{ value: 'custom' as const, label: t('tools.scope.custom') }]),
              ]}
            />
            {scope === 'custom' && (
              <Field label={t('tools.scope.pages')} hint={t('tools.scope.pagesHint')}>
                <TextInput value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1-3, 5" aria-invalid={targets === null} />
              </Field>
            )}
            {!wide && <p className="text-sm text-ink-soft">{batch ? t('filigrane.hintBatch') : t('filigrane.above')}</p>}
          </OptionGroup>
        </>
      }
      actionLabel={t('filigrane.action')}
      actionHint={
        targets === null
          ? t('tools.invalidRange')
          : !ready
            ? s.kind === 'text'
              ? t('filigrane.textMissing')
              : t('filigrane.imageMissing')
            : batch
              ? t('tools.batchCount', { count: inputs.length })
              : t('filigrane.summary', { count })
      }
      actionDisabled={targets === null || count === 0 || !ready}
      onAction={start}
    />
  );
}
