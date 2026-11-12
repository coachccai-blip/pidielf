// Numéros de page : position, format, numéro de départ, pages exclues et
// marges miroir, avec un aperçu sur la vraie page.
import { useMemo, useState } from 'react';
import { suggestName } from '@/core/naming';
import { formatPageNumber, numberAnchor, numberingPlan, type NumberEdge, type NumberFormat, type NumberSide } from '@/core/pdf/pageNumbersLayout';
import { FONT_CSS, stampText, type StampFont } from '@/core/pdf/watermarkLayout';
import { parsePageList } from '@/core/ranges';
import { useT } from '@/i18n';
import { useToolSettings } from '@/lib/settings';
import { Field, NumberInput, Select, Slider, Switch, TextInput } from '@/ui/Fields';
import { pdfOp } from '@/workers/client';
import { AnchorGrid, ColorField } from '../filigrane/controls';
import { PagePreview, previewTextWidth, StickyPreview, useWideScreen } from '../filigrane/PagePreview';
import { inputBytes, pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { OutputFile, ToolProps } from '../types';
import { usePdf, type PageSize } from '../usePdf';

const pageNumbers = pdfOp<typeof import('@/core/pdf/pageNumbers')>('pageNumbers');

type Spot = `${NumberEdge}-${NumberSide}`;
const SPOTS: Spot[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const FORMATS: NumberFormat[] = ['n', 'n-total', 'prefix-n'];
const FONTS: StampFont[] = ['sans', 'serif', 'mono'];
const MM = 72 / 25.4;
/** Repère d'aperçu autour du numéro : toujours tracé sur une page blanche, d'où une couleur fixe. */
const MARK = '#4b3391';

interface Settings {
  edge: NumberEdge;
  side: NumberSide;
  mirror: boolean;
  /** Distance au bord, en millimètres. */
  margin: number;
  format: NumberFormat;
  /** Mot devant le numéro ; null tant que l'utilisateur garde celui de la langue de l'interface. */
  prefix: string | null;
  start: number;
  countExcluded: boolean;
  font: StampFont;
  bold: boolean;
  size: number;
  color: string;
}

export default function Numeros({ inputs, run }: ToolProps) {
  const t = useT();
  const [s, set] = useToolSettings<Settings>('numeros', {
    edge: 'bottom',
    side: 'center',
    mirror: false,
    margin: 10,
    format: 'n',
    prefix: null,
    start: 1,
    countExcluded: false,
    font: 'sans',
    bold: false,
    size: 11,
    color: '#000000',
  });
  // Les pages exclues dépendent du document : elles ne sont pas mémorisées.
  const [exclude, setExclude] = useState('');
  const [current, setCurrent] = useState(0);
  const [page, setPage] = useState(1);
  const wide = useWideScreen();
  const batch = inputs.length > 1;
  const input = inputs[Math.min(current, inputs.length - 1)];
  const pdf = usePdf(input.blob);
  const shown = Math.min(page, input.pageCount);

  const prefix = stampText(s.prefix ?? t('numeros.pageWord'));
  // En lot, la liste est lue par rapport au plus long fichier ; chaque fichier ignore les pages qu'il n'a pas.
  const longest = Math.max(...inputs.map((f) => f.pageCount));
  const excluded = useMemo(() => (exclude.trim() ? parsePageList(exclude, longest) : []), [exclude, longest]);
  const numbering = { start: s.start, format: s.format, prefix, exclude: excluded ?? [], countExcluded: s.countExcluded, side: s.side, mirror: s.mirror };
  const plan = numberingPlan(input.pageCount, numbering);
  const count = plan.filter(Boolean).length;
  const label = plan[shown - 1];
  const margin = s.margin * MM;

  const start = () =>
    run(async (ctx) => {
      const outputs: OutputFile[] = [];
      for (const [i, file] of inputs.entries()) {
        const fileLabel = batch ? t('tools.fileOf', { n: i + 1, total: inputs.length }) : undefined;
        ctx.progress(i / inputs.length, fileLabel);
        // Dans un lot, un fichier dont toutes les pages sont exclues est rendu tel quel.
        const blob = numberingPlan(file.pageCount, numbering).some(Boolean)
          ? pdfBlob(
              await pageNumbers(
                'numberPages',
                { bytes: await inputBytes(file), ...numbering, edge: s.edge, margin, font: s.font, bold: s.bold, size: s.size, color: s.color },
                { signal: ctx.signal, progress: (ratio) => ctx.progress((i + ratio) / inputs.length, fileLabel) },
              ),
            )
          : file.blob;
        outputs.push({ name: suggestName(file.name, t('numeros.suffix')), blob, pageCount: file.pageCount, parentId: file.libraryId });
      }
      return outputs;
    });

  // Calque d'aperçu : le numéro à sa place exacte, entouré pour rester repérable sur une petite vignette.
  const overlay = (size: PageSize) => {
    if (!label) return null;
    const anchor = numberAnchor(size, s.edge, label.side, margin, s.size);
    const y = size.height - anchor.y;
    const width = previewTextWidth(label.text, s.font, s.bold, s.size);
    const left = label.side === 'left' ? anchor.x : label.side === 'right' ? anchor.x - width : anchor.x - width / 2;
    // Sur un téléphone la vignette est petite : le repère est élargi pour rester visible.
    const pad = Math.max(s.size * 0.6, size.width * (wide ? 0.012 : 0.03));
    return (
      <>
        <rect
          x={left - pad}
          y={y - s.size * 0.72 - pad}
          width={width + 2 * pad}
          height={s.size * 0.72 + 2 * pad}
          rx={pad / 2}
          fill="none"
          stroke={MARK}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={anchor.x}
          y={y}
          textAnchor={label.side === 'left' ? 'start' : label.side === 'right' ? 'end' : 'middle'}
          fontSize={s.size}
          fontFamily={FONT_CSS[s.font]}
          fontWeight={s.bold ? 700 : 400}
          fill={s.color}
        >
          {label.text}
        </text>
      </>
    );
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
        caption={label ? t('numeros.previewNumber', { text: label.text, where: t(`numeros.where.${s.edge}-${label.side}`) }) : t('numeros.previewNone')}
      >
        {overlay}
      </PagePreview>
      {wide && batch && <p className="text-center text-sm text-ink-soft">{t('numeros.hintBatch')}</p>}
    </div>
  );

  return (
    <ToolLayout
      preview={wide ? preview : undefined}
      options={
        <>
          {!wide && <StickyPreview>{preview}</StickyPreview>}
          <OptionGroup title={t('numeros.position')}>
            <AnchorGrid<Spot>
              label={t('numeros.position')}
              value={`${s.edge}-${s.side}`}
              onChange={(spot) => {
                const [edge, side] = spot.split('-') as [NumberEdge, NumberSide];
                set({ edge, side });
              }}
              options={SPOTS.map((spot) => ({ value: spot, label: t(`numeros.positions.${spot}`) }))}
            />
            <Switch
              checked={s.mirror}
              onChange={(mirror) => set({ mirror })}
              label={t('numeros.mirror')}
              hint={s.mirror && s.side === 'center' ? t('numeros.mirrorCentered') : t('numeros.mirrorHint')}
            />
            <Slider label={t('numeros.margin')} value={s.margin} min={3} max={40} onChange={(next) => set({ margin: next })} format={(v) => t('numeros.millimetres', { n: v })} />
          </OptionGroup>

          <OptionGroup title={t('numeros.numbering')}>
            <Field label={t('numeros.format')}>
              <Select<NumberFormat>
                value={s.format}
                onChange={(format) => set({ format })}
                options={FORMATS.map((f) => ({ value: f, label: formatPageNumber(f, 3, 12, prefix) }))}
              />
            </Field>
            {s.format === 'prefix-n' && (
              <Field label={t('numeros.prefix')} hint={t('numeros.prefixHint')}>
                <TextInput value={s.prefix ?? t('numeros.pageWord')} maxLength={30} onChange={(e) => set({ prefix: e.target.value })} />
              </Field>
            )}
            <Field label={t('numeros.start')}>
              <NumberInput value={s.start} min={0} max={99999} onChange={(v) => set({ start: Math.round(v) })} />
            </Field>
            <Field label={t('numeros.exclude')} hint={excluded === null ? t('numeros.excludeInvalid') : t('numeros.excludeHint')}>
              <TextInput value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="1" inputMode="text" aria-invalid={excluded === null} />
            </Field>
            {excluded !== null && excluded.length > 0 && (
              <Switch
                checked={s.countExcluded}
                onChange={(countExcluded) => set({ countExcluded })}
                label={t('numeros.countExcluded')}
                hint={s.countExcluded ? t('numeros.countExcludedHint') : t('numeros.sequenceHint')}
              />
            )}
          </OptionGroup>

          <OptionGroup title={t('numeros.style')}>
            <Field label={t('numeros.font')}>
              <Select<StampFont> value={s.font} onChange={(font) => set({ font })} options={FONTS.map((f) => ({ value: f, label: t(`numeros.fonts.${f}`) }))} />
            </Field>
            <Slider label={t('numeros.size')} value={s.size} min={6} max={36} onChange={(size) => set({ size })} format={(v) => t('numeros.points', { n: v })} />
            <Switch checked={s.bold} onChange={(bold) => set({ bold })} label={t('numeros.bold')} />
            <ColorField label={t('numeros.color')} value={s.color} onChange={(color) => set({ color })} />
            {!wide && batch && <p className="text-sm text-ink-soft">{t('numeros.hintBatch')}</p>}
          </OptionGroup>
        </>
      }
      actionLabel={t('numeros.action')}
      actionHint={
        excluded === null
          ? t('numeros.excludeInvalid')
          : batch
            ? t('tools.batchCount', { count: inputs.length })
            : count === 0
              ? t('numeros.noneLeft')
              : t('numeros.summary', { count })
      }
      actionDisabled={excluded === null || (!batch && count === 0)}
      onAction={start}
    />
  );
}
