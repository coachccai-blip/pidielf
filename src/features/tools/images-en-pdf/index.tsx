// Images en PDF : une image par page, dans l'ordre choisi, avec format de page,
// orientation et marges. L'aperçu montre les pages telles qu'elles sortiront.
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowRight, GripVertical, ImageOff, Plus, Trash2 } from 'lucide-react';
import { suggestName } from '@/core/naming';
import { layoutImage, type PageFormat, type PageMargin, type PageOrientation, type PageSetup } from '@/core/pdf/imagesLayout';
import { useT } from '@/i18n';
import { prepareForPdf, releasePrepared, useLoadedImages, type Loaded, type PreparedImage } from '@/lib/images';
import { useToolSettings } from '@/lib/settings';
import { Button, IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Segmented, Spinner } from '@/ui/Fields';
import { pdfOp } from '@/workers/client';
import { pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { InputFile, ToolProps } from '../types';

const op = pdfOp<typeof import('@/core/pdf/imagesToPdf')>('imagesToPdf');

const defaults: PageSetup = { format: 'a4', orientation: 'auto', margin: 'small' };

export default function ImagesEnPdf({ inputs, setInputs, addMore, run }: ToolProps) {
  const t = useT();
  const [page, setPage] = useToolSettings<PageSetup>('images-en-pdf', defaults);
  const loaded = useLoadedImages(inputs, prepareForPdf, releasePrepared);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ready = inputs.flatMap((input) => {
    const entry = loaded[input.key];
    return entry?.status === 'ready' ? [{ input, image: entry.value }] : [];
  });
  const failed = inputs.filter((input) => loaded[input.key]?.status === 'error').length;
  const pending = inputs.length - ready.length - failed;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setInputs(arrayMove(inputs, inputs.findIndex((i) => i.key === active.id), inputs.findIndex((i) => i.key === over.id)));
  };
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to >= 0 && to < inputs.length) setInputs(arrayMove(inputs, index, to));
  };

  const start = () =>
    run(async (ctx) => {
      const total = ready.length;
      const images = await Promise.all(
        ready.map(async ({ image }) => ({ data: new Uint8Array(await image.blob.arrayBuffer()), mime: image.mime, width: image.width, height: image.height })),
      );
      const bytes = await op('imagesToPdf', { images, page }, {
        signal: ctx.signal,
        progress: (ratio) => ctx.progress(ratio, t('tools.pageOf', { n: Math.min(total, Math.floor(ratio * total) + 1), total })),
      });
      return {
        outputs: [{ name: suggestName(ready[0].input.name, t('images-en-pdf.suffix')), blob: pdfBlob(bytes), pageCount: total }],
        note: failed > 0 ? t('images-en-pdf.skippedNote', { count: failed }) : undefined,
      };
    });

  const hint =
    pending > 0
      ? t('images-en-pdf.preparing')
      : ready.length === 0
        ? t('images-en-pdf.noneReadable')
        : [t('images-en-pdf.summary', { count: ready.length }), failed > 0 ? t('images-en-pdf.skipped', { count: failed }) : ''].filter(Boolean).join(' ');

  const numberOf = new Map(ready.map((r, i) => [r.input.key, i + 1]));
  return (
    <ToolLayout
      wide
      preview={
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">{t('images-en-pdf.hint')}</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={inputs.map((i) => i.key)} strategy={rectSortingStrategy}>
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {inputs.map((input, index) => (
                  <Card
                    key={input.key}
                    input={input}
                    entry={loaded[input.key]}
                    number={numberOf.get(input.key) ?? null}
                    page={page}
                    first={index === 0}
                    last={index === inputs.length - 1}
                    onMove={(delta) => move(index, delta)}
                    onRemove={() => setInputs(inputs.filter((i) => i.key !== input.key))}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          <Button icon={<Plus />} onClick={addMore} className="self-start">{t('tools.addFiles')}</Button>
        </div>
      }
      options={
        <>
          <OptionGroup title={t('images-en-pdf.format')}>
            <Segmented<PageFormat>
              label={t('images-en-pdf.format')}
              value={page.format}
              onChange={(format) => setPage({ format })}
              options={[
                { value: 'a4', label: t('images-en-pdf.formatA4') },
                { value: 'letter', label: t('images-en-pdf.formatLetter') },
                { value: 'fit', label: t('images-en-pdf.formatFit') },
              ]}
            />
            {page.format === 'fit' && <p className="text-sm text-ink-soft">{t('images-en-pdf.formatFitHint')}</p>}
          </OptionGroup>
          {page.format !== 'fit' && (
            <OptionGroup title={t('images-en-pdf.orientation')}>
              <Segmented<PageOrientation>
                label={t('images-en-pdf.orientation')}
                value={page.orientation}
                onChange={(orientation) => setPage({ orientation })}
                options={[
                  { value: 'auto', label: t('images-en-pdf.orientationAuto') },
                  { value: 'portrait', label: t('images-en-pdf.portrait') },
                  { value: 'landscape', label: t('images-en-pdf.landscape') },
                ]}
              />
              {page.orientation === 'auto' && <p className="text-sm text-ink-soft">{t('images-en-pdf.orientationAutoHint')}</p>}
            </OptionGroup>
          )}
          <OptionGroup title={t('images-en-pdf.margins')}>
            <Segmented<PageMargin>
              label={t('images-en-pdf.margins')}
              value={page.margin}
              onChange={(margin) => setPage({ margin })}
              options={[
                { value: 'none', label: t('images-en-pdf.marginNone') },
                { value: 'small', label: t('images-en-pdf.marginSmall') },
                { value: 'large', label: t('images-en-pdf.marginLarge') },
              ]}
            />
          </OptionGroup>
          <p className="text-sm text-ink-soft">{t('images-en-pdf.fitNote')}</p>
        </>
      }
      actionLabel={t('images-en-pdf.action')}
      actionHint={hint}
      actionDisabled={pending > 0 || ready.length === 0}
      onAction={start}
    />
  );
}

/** Maquette d'une page : l'image y occupe exactement la place qu'elle aura dans le PDF. */
function PageMock({ image, page, alt }: { image: PreparedImage; page: PageSetup; alt: string }) {
  const l = layoutImage(image.width, image.height, page);
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <div
      className="relative overflow-hidden rounded-[2px] bg-white shadow-soft ring-1 ring-line transition-all duration-200"
      style={{ aspectRatio: `${l.pageWidth} / ${l.pageHeight}`, width: l.pageWidth >= l.pageHeight ? '100%' : pct(l.pageWidth, l.pageHeight) }}
    >
      <img
        src={image.thumbUrl}
        alt={alt}
        draggable={false}
        className="absolute max-w-none transition-all duration-200"
        style={{
          left: pct(l.x, l.pageWidth),
          top: pct(l.pageHeight - l.y - l.height, l.pageHeight),
          width: pct(l.width, l.pageWidth),
          height: pct(l.height, l.pageHeight),
        }}
      />
    </div>
  );
}

function Card({
  input,
  entry,
  number,
  page,
  first,
  last,
  onMove,
  onRemove,
}: {
  input: InputFile;
  entry: Loaded<PreparedImage> | undefined;
  /** Numéro de la page dans le PDF ; null si l'image n'y figurera pas. */
  number: number | null;
  page: PageSetup;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: input.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface p-1.5 shadow-soft', isDragging && 'relative z-10 shadow-lift')}
    >
      <div className="rounded-md bg-surface-2">
        <div className="flex items-center justify-between pr-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t('tools.dragHandle', { name: input.name })}
            className="grid size-11 cursor-grab touch-none place-items-center rounded-md text-ink-soft hover:bg-line active:cursor-grabbing"
          >
            <GripVertical className="size-5" />
          </button>
          {number !== null && (
            <span className="grid size-7 place-items-center rounded-full bg-cat text-xs font-bold text-cat-ink ring-1 ring-cat-ink/20" aria-hidden="true">{number}</span>
          )}
        </div>
        <div className="grid aspect-square place-items-center px-2 pb-2">
          {entry?.status === 'ready' ? (
            <PageMock image={entry.value} page={page} alt={t('images-en-pdf.pageLabel', { n: number ?? 0, name: input.name })} />
          ) : entry?.status === 'error' ? (
            <p role="alert" className="flex flex-col items-center gap-1.5 text-center text-xs font-semibold text-danger">
              <ImageOff className="size-6" aria-hidden="true" />
              {t(entry.reason === 'heic' ? 'images-en-pdf.errorHeic' : 'images-en-pdf.errorUnsupported')}
            </p>
          ) : (
            <span role="status" className="flex flex-col items-center gap-2 text-center text-xs text-ink-soft">
              <Spinner />
              {t('images-en-pdf.loading')}
            </span>
          )}
        </div>
      </div>
      <p className="mt-1.5 truncate px-1 text-sm font-semibold" title={input.name}>{input.name}</p>
      <p className="min-h-4 truncate px-1 text-xs text-ink-soft">
        {entry?.status === 'ready' && `${entry.value.width} × ${entry.value.height} px${entry.value.converted ? ` · ${t('images-en-pdf.converted')}` : ''}`}
      </p>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="flex">
          <IconButton label={t('images-en-pdf.moveBefore', { name: input.name })} disabled={first} onClick={() => onMove(-1)}><ArrowLeft /></IconButton>
          <IconButton label={t('images-en-pdf.moveAfter', { name: input.name })} disabled={last} onClick={() => onMove(1)}><ArrowRight /></IconButton>
        </span>
        <IconButton label={t('tools.remove', { name: input.name })} onClick={onRemove} className="text-danger"><Trash2 /></IconButton>
      </div>
    </li>
  );
}
