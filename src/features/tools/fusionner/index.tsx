// Fusionner : réunit plusieurs PDF en un seul, dans l'ordre choisi.
import { useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { suggestName } from '@/core/naming';
import { parsePageList } from '@/core/ranges';
import { formatBytes, useT } from '@/i18n';
import { Button, IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { inputClass } from '@/ui/Fields';
import { pdfOp } from '@/workers/client';
import { inputBytes, pdfBlob } from '../inputs';
import { ToolLayout } from '../ToolLayout';
import type { InputFile, ToolProps } from '../types';
import { PageThumb, usePdf } from '../usePdf';

// Options stables : elles ne relancent pas le rendu des lignes à chaque frappe.
const POINTER = { activationConstraint: { distance: 6 } };
const KEYBOARD = { coordinateGetter: sortableKeyboardCoordinates };

const merge = pdfOp<typeof import('@/core/pdf/merge')>('merge');

export default function Fusionner({ inputs, setInputs, addMore, run }: ToolProps) {
  const t = useT();
  // Pages à garder pour chaque fichier (saisie libre : « 1-3, 5 »). Vide = toutes.
  const [ranges, setRanges] = useState<Record<string, string>>({});

  // La poignée ne laisse pas défiler la page (touch-none) : au doigt comme à la souris, on la fait glisser directement.
  const sensors = useSensors(useSensor(PointerSensor, POINTER), useSensor(KeyboardSensor, KEYBOARD));

  const parsed = useMemo(
    () =>
      inputs.map((input) => {
        const text = (ranges[input.key] ?? '').trim();
        if (!text) return { pages: undefined as number[] | undefined, count: input.pageCount, valid: true };
        const pages = parsePageList(text, input.pageCount);
        return { pages: pages ?? undefined, count: pages?.length ?? 0, valid: pages !== null };
      }),
    [inputs, ranges],
  );
  const total = parsed.reduce((sum, p) => sum + p.count, 0);
  const valid = parsed.every((p) => p.valid);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = inputs.findIndex((i) => i.key === active.id);
    const to = inputs.findIndex((i) => i.key === over.id);
    setInputs(arrayMove(inputs, from, to));
  };
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to >= 0 && to < inputs.length) setInputs(arrayMove(inputs, index, to));
  };

  const start = () =>
    run(async (ctx) => {
      const files = await Promise.all(inputs.map(async (input, i) => ({ bytes: await inputBytes(input), pages: parsed[i].pages })));
      const bytes = await merge('mergePdfs', { files }, ctx);
      return [{ name: suggestName(inputs[0].name, t('fusionner.suffix')), blob: pdfBlob(bytes), pageCount: total }];
    });

  return (
    <ToolLayout
      preview={
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">{t('fusionner.hint')}</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={inputs.map((i) => i.key)} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-2">
                {inputs.map((input, index) => (
                  <Row
                    key={input.key}
                    input={input}
                    index={index}
                    last={index === inputs.length - 1}
                    range={ranges[input.key] ?? ''}
                    invalid={!parsed[index].valid}
                    onRange={(value) => setRanges({ ...ranges, [input.key]: value })}
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
      actionLabel={t('fusionner.action')}
      actionHint={
        inputs.length < 2 ? t('fusionner.needTwo') : !valid ? t('tools.invalidRange') : t('fusionner.summary', { files: inputs.length, pages: total })
      }
      actionDisabled={inputs.length < 2 || !valid || total === 0}
      onAction={start}
    />
  );
}

function Row({
  input,
  index,
  last,
  range,
  invalid,
  onRange,
  onMove,
  onRemove,
}: {
  input: InputFile;
  index: number;
  last: boolean;
  range: string;
  invalid: boolean;
  onRange: (value: string) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const pdf = usePdf(input.blob);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: input.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-2 rounded-lg border border-line bg-surface p-2 shadow-soft', isDragging && 'relative z-10 shadow-lift')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t('tools.dragHandle', { name: input.name })}
        className="grid h-14 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-ink-soft hover:bg-surface-2 active:cursor-grabbing"
      >
        <GripVertical className="size-5" />
      </button>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-cat text-xs font-bold text-cat-ink" aria-hidden="true">{index + 1}</span>
      <PageThumb pdf={pdf} page={1} width={56} className="w-11 shrink-0 rounded-sm border border-line" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{input.name}</p>
        <p className="text-xs text-ink-soft">{t('common.pages', { count: input.pageCount })} · {formatBytes(input.blob.size)}</p>
        <label className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          <span className="shrink-0">{t('fusionner.keep')}</span>
          <input
            value={range}
            onChange={(e) => onRange(e.target.value)}
            placeholder={t('fusionner.allPages')}
            inputMode="text"
            aria-invalid={invalid}
            className={cn(inputClass, 'min-h-9 w-32 flex-1 text-sm sm:max-w-40', invalid && 'border-danger')}
          />
        </label>
      </div>
      <div className="flex shrink-0 flex-col sm:flex-row">
        <IconButton size="sm" label={t('tools.moveUp')} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></IconButton>
        <IconButton size="sm" label={t('tools.moveDown')} disabled={last} onClick={() => onMove(1)}><ArrowDown /></IconButton>
        <IconButton size="sm" label={t('tools.remove', { name: input.name })} onClick={onRemove} className="text-danger"><Trash2 /></IconButton>
      </div>
    </li>
  );
}
