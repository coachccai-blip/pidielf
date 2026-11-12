// Scanner : des photos de pages deviennent un PDF. Pour chaque page, on ajuste
// quatre coins (perspective redressée), on choisit un rendu, on réordonne.
import { useEffect, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Camera, Crop, GripVertical, ImageOff, ImagePlus, RotateCw, ScanText, Trash2, TriangleAlert } from 'lucide-react';
import type { ScanMode } from '@/core/image/filters';
import { defaultQuad, isValidQuad, rotateQuad90, scaleQuad, type Quad } from '@/core/image/geometry';
import type { ScanPage } from '@/core/pdf/scan';
import { useT } from '@/i18n';
import {
  canvasBlob, decodeImage, drawToCanvas, isSmallDevice, pixelsToCanvas, readPixels, releaseCanvas, useLoadedImages,
  type Loaded, type QuarterTurn,
} from '@/lib/images';
import { navigate, routes } from '@/lib/router';
import { useToolSettings } from '@/lib/settings';
import { Button, IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Segmented, Spinner } from '@/ui/Fields';
import { Dialog } from '@/ui/Overlay';
import { pdfOp } from '@/workers/client';
import { pickFiles } from '@/features/library/import';
import { handOffInputs } from '../handoff';
import { pdfBlob, prepareFiles } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { InputFile, OutputFile, ToolProps } from '../types';
import { CornerEditor } from './CornerEditor';

const scan = pdfOp<typeof import('@/core/pdf/scan')>('scan');

/** Tailles de travail, en pixels (plus grand côté). */
const PREVIEW_SIDE = 1280;
const THUMB_SIDE = 360;
const JPEG_QUALITY = 0.88;

/** Photo décodée, gardée à deux petites tailles : l'original n'est relu qu'à la création du PDF. */
interface ScanSource {
  preview: HTMLCanvasElement;
  thumb: HTMLCanvasElement;
}

async function loadSource(file: { blob: Blob; name: string }): Promise<ScanSource> {
  const bitmap = await decodeImage(file.blob, file.name);
  try {
    return { preview: drawToCanvas(bitmap, { maxSide: PREVIEW_SIDE }), thumb: drawToCanvas(bitmap, { maxSide: THUMB_SIDE }) };
  } finally {
    bitmap.close();
  }
}

function releaseSource(source: ScanSource): void {
  releaseCanvas(source.preview);
  releaseCanvas(source.thumb);
}

/** Réglages propres à une page. */
interface Adjustment {
  rotation: QuarterTurn;
  /** Coins en coordonnées normalisées de la photo tournée. */
  quad: Quad;
}

const UNTOUCHED: Adjustment = { rotation: 0, quad: defaultQuad() };

// Les réglages des pages survivent au passage par l'écran de résultat : l'outil
// y est démonté, et « Modifier les réglages » ne doit pas faire perdre les coins.
const remembered = new Map<string, Adjustment>();

export default function Scanner({ tool, inputs, setInputs, addMore, run }: ToolProps) {
  const t = useT();
  const [settings, setSettings] = useToolSettings('scanner', { mode: 'color' as ScanMode });
  const sources = useLoadedImages(inputs, loadSource, releaseSource);
  const [adjustments, setAdjustments] = useState<Record<string, Adjustment>>(() => {
    const keys = new Set(inputs.map((i) => i.key));
    for (const key of [...remembered.keys()]) if (!keys.has(key)) remembered.delete(key);
    return Object.fromEntries(remembered);
  });
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const viewport = useViewportHeight();
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const adjustmentOf = (key: string): Adjustment => adjustments[key] ?? UNTOUCHED;
  const adjust = (key: string, patch: Partial<Adjustment>) => {
    const next = { ...adjustmentOf(key), ...patch };
    remembered.set(key, next);
    setAdjustments((prev) => ({ ...prev, [key]: next }));
  };

  // Seules les photos lisibles deviennent des pages, numérotées dans l'ordre de la liste.
  const pages = inputs.flatMap((input) => {
    const entry = sources[input.key];
    return entry?.status === 'ready' ? [{ input, source: entry.value, ...adjustmentOf(input.key) }] : [];
  });
  const numberOf = new Map(pages.map((p, i) => [p.input.key, i + 1]));
  const failed = inputs.filter((input) => sources[input.key]?.status === 'error').length;
  const pending = inputs.length - pages.length - failed;
  const invalid = pages.find((p) => !isValidQuad(p.quad));
  const current = pages.find((p) => p.input.key === currentKey) ?? pages[0];
  const editing = pages.find((p) => p.input.key === editingKey);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setInputs(arrayMove(inputs, inputs.findIndex((i) => i.key === active.id), inputs.findIndex((i) => i.key === over.id)));
  };
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to >= 0 && to < inputs.length) setInputs(arrayMove(inputs, index, to));
  };

  const takePhoto = async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: false, capture: true });
    if (files.length === 0) return;
    const { inputs: added } = await prepareFiles(files, tool);
    setInputs([...inputsRef.current, ...added]);
    if (added[0]) setCurrentKey(added[0].key);
  };

  const start = () =>
    run(async (ctx) => {
      const small = isSmallDevice();
      // La photo est relue en grand ; le résultat est plafonné pour rester léger et tenir en mémoire.
      const sourceSide = small ? 2400 : 3200;
      const outputSide = small ? 1800 : 2200;
      const out: ScanPage[] = [];
      for (const [i, page] of pages.entries()) {
        if (ctx.signal.aborted) throw new DOMException('Annulé', 'AbortError');
        ctx.progress(i / pages.length, t('tools.pageOf', { n: i + 1, total: pages.length }));
        const bitmap = await decodeImage(page.input.blob, page.input.name);
        let pixels: ImageData;
        try {
          const canvas = drawToCanvas(bitmap, { maxSide: sourceSide, rotation: page.rotation });
          pixels = readPixels(canvas);
          releaseCanvas(canvas);
        } finally {
          bitmap.close();
        }
        const result = await scan(
          'processScan',
          { data: pixels.data, width: pixels.width, height: pixels.height, quad: scaleQuad(page.quad, pixels.width, pixels.height), mode: settings.mode, maxSide: outputSide, pack: true },
          { signal: ctx.signal },
        );
        if (result.bilevel) {
          out.push({ kind: 'bilevel', data: result.data, width: result.width, height: result.height });
        } else {
          const canvas = pixelsToCanvas(result.data, result.width, result.height);
          const blob = await canvasBlob(canvas, 'image/jpeg', JPEG_QUALITY);
          releaseCanvas(canvas);
          out.push({ kind: 'jpeg', data: new Uint8Array(await blob.arrayBuffer()), width: result.width, height: result.height });
        }
      }
      ctx.progress(0.97);
      const bytes = await scan('scanToPdf', { pages: out }, { signal: ctx.signal });
      const output: OutputFile = { name: `${t('scanner.suffix')}_${today()}.pdf`, blob: pdfBlob(bytes), pageCount: out.length };
      return { outputs: [output], extra: <OcrOffer output={output} /> };
    });

  const hint =
    pending > 0
      ? t('scanner.preparing')
      : pages.length === 0
        ? t('scanner.noneReadable')
        : invalid
          ? t('scanner.fixCorners', { n: numberOf.get(invalid.input.key) ?? 1 })
          : [t('scanner.summary', { count: pages.length }), failed > 0 ? t('scanner.skipped', { count: failed }) : ''].filter(Boolean).join(' ');

  return (
    <>
      <ToolLayout
        wide
        preview={
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-soft">{t('scanner.hint')}</p>
            {current && (
              <section className="flex flex-col items-center gap-3 rounded-xl bg-surface-2 p-3" aria-label={t('scanner.preview', { n: numberOf.get(current.input.key) ?? 1 })}>
                <ScanView
                  source={current.source.preview}
                  rotation={current.rotation}
                  quad={current.quad}
                  mode={settings.mode}
                  maxSide={1000}
                  label={t('scanner.preview', { n: numberOf.get(current.input.key) ?? 1 })}
                  className="max-h-[44dvh] min-h-40 lg:max-h-[58dvh]"
                />
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{t('tools.pageOf', { n: numberOf.get(current.input.key) ?? 1, total: pages.length })}</p>
                  <Button variant="cat" icon={<Crop />} onClick={() => setEditingKey(current.input.key)}>{t('scanner.adjust')}</Button>
                </div>
              </section>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={inputs.map((i) => i.key)} strategy={verticalListSortingStrategy}>
                <ol className="flex flex-col gap-2">
                  {inputs.map((input, index) => (
                    <Row
                      key={input.key}
                      input={input}
                      entry={sources[input.key]}
                      adjustment={adjustmentOf(input.key)}
                      mode={settings.mode}
                      number={numberOf.get(input.key) ?? null}
                      selected={current?.input.key === input.key}
                      first={index === 0}
                      last={index === inputs.length - 1}
                      onSelect={() => setCurrentKey(input.key)}
                      onEdit={() => {
                        setCurrentKey(input.key);
                        setEditingKey(input.key);
                      }}
                      onMove={(delta) => move(index, delta)}
                      onRemove={() => setInputs(inputs.filter((i) => i.key !== input.key))}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
            <div className="flex flex-wrap gap-2">
              <Button icon={<Camera />} onClick={() => void takePhoto()}>{t('scanner.takePhoto')}</Button>
              <Button icon={<ImagePlus />} onClick={addMore}>{t('scanner.addPhotos')}</Button>
            </div>
          </div>
        }
        options={
          <OptionGroup title={t('scanner.render')}>
            <Segmented<ScanMode>
              label={t('scanner.render')}
              value={settings.mode}
              onChange={(mode) => setSettings({ mode })}
              options={[
                { value: 'color', label: t('scanner.color') },
                { value: 'grey', label: t('scanner.grey') },
                { value: 'bw', label: t('scanner.bw') },
              ]}
            />
            <p className="text-sm">{t(`scanner.${settings.mode}Hint`)}</p>
            <p className="text-sm text-ink-soft">{t('scanner.allPages')} {t('scanner.ocrNote')}</p>
          </OptionGroup>
        }
        actionLabel={t('scanner.action')}
        actionHint={hint}
        actionDisabled={pending > 0 || pages.length === 0 || !!invalid}
        onAction={start}
      />

      <Dialog
        open={!!editing}
        onClose={() => setEditingKey(null)}
        title={t('scanner.editTitle', { n: editing ? (numberOf.get(editing.input.key) ?? 1) : 1 })}
        size="lg"
        footer={
          editing && (
            <>
              <IconButton
                variant="soft"
                label={t('scanner.rotate')}
                onClick={() => adjust(editing.input.key, { rotation: ((editing.rotation + 90) % 360) as QuarterTurn, quad: rotateQuad90(editing.quad) })}
              >
                <RotateCw />
              </IconButton>
              <Button onClick={() => adjust(editing.input.key, { quad: defaultQuad() })}>{t('scanner.reset')}</Button>
              <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => setEditingKey(null)}>{t('common.done')}</Button>
            </>
          )
        }
      >
        {editing && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-soft">
              {t('scanner.editHint')} <span className="hidden pointer-fine:inline">{t('scanner.editKeys')}</span>
            </p>
            <CornerEditor
              source={editing.source.preview}
              rotation={editing.rotation}
              quad={editing.quad}
              onChange={(quad) => adjust(editing.input.key, { quad })}
              // Hauteur de l'écran moins l'en-tête, la consigne et le pied de la fenêtre.
              maxHeight={Math.min(640, Math.max(220, viewport * 0.92 - 250))}
            />
            <p role="status" className={cn('flex min-h-6 items-center gap-2 text-sm font-semibold text-danger', isValidQuad(editing.quad) && 'invisible')}>
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              {t('scanner.editInvalid')}
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}

/** Page redressée et filtrée, calculée hors du fil principal à partir d'une photo réduite. */
function ScanView({
  source,
  rotation,
  quad,
  mode,
  maxSide,
  label,
  className,
}: {
  source: HTMLCanvasElement;
  rotation: QuarterTurn;
  quad: Quad;
  mode: ScanMode;
  maxSide: number;
  /** Description pour les lecteurs d'écran ; sans elle, l'image est décorative. */
  label?: string;
  className?: string;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const valid = isValidQuad(quad);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const rotated = drawToCanvas(source, { rotation });
    const pixels = readPixels(rotated);
    releaseCanvas(rotated);
    scan('processScan', { data: pixels.data, width: pixels.width, height: pixels.height, quad: scaleQuad(quad, pixels.width, pixels.height), mode, maxSide })
      .then((result) => {
        const el = canvas.current;
        if (cancelled || !el) return;
        el.width = result.width;
        el.height = result.height;
        el.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(result.data.buffer as ArrayBuffer), result.width, result.height), 0, 0);
        setReady(true);
      })
      .catch(() => {
        /* calcul interrompu (annulation d'un traitement) : l'aperçu précédent reste affiché */
      });
    return () => {
      cancelled = true;
    };
  }, [source, rotation, quad, mode, maxSide, valid]);

  if (!valid) {
    return (
      <p className={cn('flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-danger', className)}>
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {t('scanner.invalidShort')}
      </p>
    );
  }
  return (
    <span className={cn('relative grid place-items-center', className)}>
      <canvas ref={canvas} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('max-h-[inherit] max-w-full rounded-[2px] bg-white shadow-soft', !ready && 'opacity-0')} />
      {!ready && <Spinner className="absolute" />}
    </span>
  );
}

function Row({
  input,
  entry,
  adjustment,
  mode,
  number,
  selected,
  first,
  last,
  onSelect,
  onEdit,
  onMove,
  onRemove,
}: {
  input: InputFile;
  entry: Loaded<ScanSource> | undefined;
  adjustment: Adjustment;
  mode: ScanMode;
  /** Numéro de la page dans le PDF ; null si la photo est illisible ou en cours de lecture. */
  number: number | null;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: input.key });
  const n = number ?? 0;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border bg-surface p-1.5 shadow-soft sm:gap-2 sm:p-2',
        selected ? 'border-cat-ink' : 'border-line',
        isDragging && 'relative z-10 shadow-lift',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={number ? t('scanner.dragPage', { n }) : t('tools.dragHandle', { name: input.name })}
        className="grid h-14 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-ink-soft hover:bg-surface-2 active:cursor-grabbing"
      >
        <GripVertical className="size-5" />
      </button>
      {entry?.status === 'ready' && number ? (
        <>
          <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? 'true' : undefined}
            aria-label={t('scanner.showPage', { n })}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left"
          >
            <span className={cn('grid size-16 shrink-0 place-items-center rounded-md p-1', selected ? 'bg-cat' : 'bg-surface-2')}>
              <ScanView source={entry.value.thumb} rotation={adjustment.rotation} quad={adjustment.quad} mode={mode} maxSide={160} className="size-full max-h-14" />
            </span>
            <span className="min-w-0">
              <span className="block font-bold">{t('scanner.pageName', { n })}</span>
              <span className="block truncate text-xs text-ink-soft">{input.name}</span>
            </span>
          </button>
          <IconButton variant="cat" label={t('scanner.adjustPage', { n })} onClick={onEdit}><Crop /></IconButton>
        </>
      ) : entry?.status === 'error' ? (
        <p role="alert" className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-danger">
          <ImageOff className="size-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {t(entry.reason === 'heic' ? 'scanner.errorHeic' : 'scanner.errorUnsupported')}
            <span className="block truncate text-xs font-normal text-ink-soft">{input.name}</span>
          </span>
        </p>
      ) : (
        <span role="status" className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-ink-soft">
          <span className="grid size-16 shrink-0 place-items-center rounded-md bg-surface-2"><Spinner /></span>
          {t('scanner.loading')}
        </span>
      )}
      <div className="flex shrink-0 flex-col">
        <IconButton size="sm" label={number ? t('scanner.movePageUp', { n }) : t('tools.moveUp')} disabled={first} onClick={() => onMove(-1)}><ArrowUp /></IconButton>
        <IconButton size="sm" label={number ? t('scanner.movePageDown', { n }) : t('tools.moveDown')} disabled={last} onClick={() => onMove(1)}><ArrowDown /></IconButton>
      </div>
      <IconButton label={number ? t('scanner.removePage', { n }) : t('tools.remove', { name: input.name })} onClick={onRemove} className="text-danger"><Trash2 /></IconButton>
    </li>
  );
}

/** « OCR proposé en un appui » : le PDF produit passe directement à l'outil OCR. */
function OcrOffer({ output }: { output: OutputFile }) {
  const t = useT();
  const toOcr = () => {
    handOffInputs([{ key: `scan-${Date.now().toString(36)}`, name: output.name, blob: output.blob, pageCount: output.pageCount ?? 0 }]);
    navigate(routes.tool('ocr'));
  };
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm text-ink-soft">{t('scanner.ocrText')}</p>
      <Button variant="cat" icon={<ScanText />} onClick={toOcr}>{t('scanner.ocrAction')}</Button>
    </div>
  );
}
