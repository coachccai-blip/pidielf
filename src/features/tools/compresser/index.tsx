// Compresser : trois niveaux, un lot de fichiers, et un résultat honnête —
// la taille réelle avant et après, ou l'annonce qu'il n'y avait rien à gagner.
import { Plus, Trash2 } from 'lucide-react';
import { suggestName } from '@/core/naming';
import type { CompressLevel, CompressResult } from '@/core/pdf/compress';
import { formatBytes, useT } from '@/i18n';
import { useToolSettings } from '@/lib/settings';
import { Button, IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { pdfOp } from '@/workers/client';
import { inputBytes, pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { InputFile, OutputFile, ToolProps } from '../types';
import { PageThumb, usePdf } from '../usePdf';

const compress = pdfOp<typeof import('@/core/pdf/compress')>('compress');

const LEVELS: CompressLevel[] = ['light', 'balanced', 'strong'];

export default function Compresser({ inputs, setInputs, addMore, run }: ToolProps) {
  const t = useT();
  const [settings, setSettings] = useToolSettings('compresser', { level: 'balanced' as CompressLevel });
  const batch = inputs.length > 1;
  const total = inputs.reduce((sum, f) => sum + f.blob.size, 0);

  /** Ce qui s'est réellement passé pour un fichier, en une phrase. */
  const explain = (r: CompressResult): string => {
    if (!r.codec && r.images > 0) return t('compresser.noteNoCodec');
    if (!r.changed) return r.images > 0 ? t('compresser.noteSameImages') : t('compresser.noteSameNoImages');
    if (r.recompressed > 0) return t('compresser.noteImages', { count: r.recompressed, total: r.images });
    return r.images > 0 ? t('compresser.noteStructure') : t('compresser.noteNoImages');
  };

  const start = () =>
    run(async (ctx) => {
      const outputs: OutputFile[] = [];
      const results: CompressResult[] = [];
      for (const [i, file] of inputs.entries()) {
        const label = batch ? t('tools.fileOf', { n: i + 1, total: inputs.length }) : undefined;
        ctx.progress(i / inputs.length, label);
        const result = await compress(
          'compressPdf',
          { bytes: await inputBytes(file), level: settings.level },
          { signal: ctx.signal, progress: (ratio) => ctx.progress((i + ratio) / inputs.length, label) },
        );
        results.push(result);
        // Rien à gagner : on rend le fichier d'origine, octet pour octet.
        outputs.push({ name: suggestName(file.name, t('compresser.suffix')), blob: result.changed ? pdfBlob(result.bytes) : file.blob, pageCount: file.pageCount, parentId: file.libraryId });
      }
      const lighter = results.filter((r) => r.changed).length;
      const note = batch
        ? [
            t('compresser.noteBatch', { done: lighter, total: results.length }),
            ...(lighter < results.length ? [t('compresser.noteBatchSame')] : []),
            ...(results.some((r) => !r.codec && r.images > 0) ? [t('compresser.noteNoCodec')] : []),
          ].join(' ')
        : explain(results[0]);
      return { outputs, originalSize: total, note };
    });

  return (
    <ToolLayout
      preview={
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2" aria-label={t('compresser.files')}>
            {inputs.map((input) => (
              <FileRow key={input.key} input={input} onRemove={batch ? () => setInputs(inputs.filter((f) => f.key !== input.key)) : undefined} />
            ))}
          </ul>
          <Button icon={<Plus />} onClick={addMore} className="self-start">{t('tools.addFiles')}</Button>
        </div>
      }
      options={
        <OptionGroup title={t('compresser.level')}>
          <div role="radiogroup" aria-label={t('compresser.level')} className="flex flex-col gap-2">
            {LEVELS.map((level) => {
              const active = level === settings.level;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSettings({ level })}
                  className={cn(
                    'flex min-h-16 items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors duration-150',
                    active ? 'border-cat-ink bg-cat text-cat-ink' : 'border-line bg-surface hover:bg-surface-2',
                  )}
                >
                  <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2', active ? 'border-cat-ink' : 'border-line-strong')} aria-hidden="true">
                    {active && <span className="size-2.5 rounded-full bg-cat-ink" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold">{t(`compresser.levels.${level}.name`)}</span>
                    <span className={cn('block text-sm', !active && 'text-ink-soft')}>{t(`compresser.levels.${level}.desc`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-sm text-ink-soft">{t('compresser.hint')}</p>
        </OptionGroup>
      }
      actionLabel={t('compresser.action')}
      actionHint={batch ? t('compresser.currentBatch', { count: inputs.length, size: formatBytes(total) }) : t('compresser.current', { size: formatBytes(total) })}
      onAction={start}
    />
  );
}

function FileRow({ input, onRemove }: { input: InputFile; onRemove?: () => void }) {
  const t = useT();
  const pdf = usePdf(input.blob);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2 shadow-soft">
      <PageThumb pdf={pdf} page={1} width={56} className="w-11 shrink-0 rounded-sm border border-line" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{input.name}</p>
        <p className="text-xs text-ink-soft">{t('common.pages', { count: input.pageCount })} · {formatBytes(input.blob.size)}</p>
      </div>
      {onRemove && (
        <IconButton size="md" label={t('tools.remove', { name: input.name })} onClick={onRemove} className="text-danger"><Trash2 /></IconButton>
      )}
    </li>
  );
}
