// Pivoter : rotation de 90°, 180° ou 270° sur tout le document, les pages
// paires, impaires ou une sélection.
import { useMemo, useState } from 'react';
import { RotateCcw, RotateCw, RefreshCw } from 'lucide-react';
import { suggestName } from '@/core/naming';
import { formatPageList, pagesForScope, parsePageList, type PageScope } from '@/core/ranges';
import { useT } from '@/i18n';
import { useToolSettings } from '@/lib/settings';
import { cn } from '@/ui/cn';
import { Field, Segmented, Select, TextInput } from '@/ui/Fields';
import { pdfOp } from '@/workers/client';
import { inputBytes, pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { ToolProps } from '../types';
import { PageThumb, usePdf } from '../usePdf';

const rotate = pdfOp<typeof import('@/core/pdf/rotate')>('rotate');

type Angle = '90' | '180' | '270';

export default function Pivoter({ inputs, run }: ToolProps) {
  const t = useT();
  const [settings, setSettings] = useToolSettings('pivoter', { angle: '90' as Angle, scope: 'all' as PageScope });
  const [custom, setCustom] = useState('');
  const [current, setCurrent] = useState(0);
  const batch = inputs.length > 1;
  const input = inputs[Math.min(current, inputs.length - 1)];
  const pdf = usePdf(input.blob);

  // En lot, la sélection manuelle n'a pas de sens : on applique une règle à tous les fichiers.
  const scope: PageScope = batch && settings.scope === 'custom' ? 'all' : settings.scope;
  const targets = useMemo(() => pagesForScope(scope, input.pageCount, custom), [scope, input.pageCount, custom]);
  const targetSet = useMemo(() => new Set(targets ?? []), [targets]);
  const angle = Number(settings.angle);

  const togglePage = (page: number) => {
    const set = new Set(scope === 'custom' ? (parsePageList(custom, input.pageCount) ?? []) : (targets ?? []));
    if (set.has(page)) set.delete(page);
    else set.add(page);
    setSettings({ scope: 'custom' });
    setCustom(formatPageList([...set]));
  };

  const start = () =>
    run(async (ctx) => {
      const outputs = [];
      for (const [i, file] of inputs.entries()) {
        ctx.progress(i / inputs.length, batch ? t('tools.fileOf', { n: i + 1, total: inputs.length }) : undefined);
        const pages = pagesForScope(scope, file.pageCount, custom) ?? [];
        const bytes = await rotate('rotatePdf', { bytes: await inputBytes(file), angle, pages }, { signal: ctx.signal });
        outputs.push({ name: suggestName(file.name, t('pivoter.suffix')), blob: pdfBlob(bytes), pageCount: file.pageCount, parentId: file.libraryId });
      }
      return outputs;
    });

  const count = targets?.length ?? 0;

  return (
    <ToolLayout
      wide
      preview={
        <div className="flex flex-col gap-3">
          {batch && (
            <Select
              aria-label={t('tools.previewFile')}
              value={String(current)}
              onChange={(v) => setCurrent(Number(v))}
              options={inputs.map((f, i) => ({ value: String(i), label: f.name }))}
            />
          )}
          <p className="text-sm text-ink-soft">{batch ? t('pivoter.hintBatch') : t('pivoter.hint')}</p>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: input.pageCount }, (_, i) => i + 1).map((page) => {
              const active = targetSet.has(page);
              return (
                <li key={`${input.key}-${page}`}>
                  <button
                    type="button"
                    disabled={batch}
                    aria-pressed={active}
                    aria-label={t('tools.pageN', { n: page })}
                    onClick={() => togglePage(page)}
                    className={cn(
                      'flex w-full flex-col items-center gap-1 rounded-lg border-2 p-1.5 transition-colors duration-150',
                      active ? 'border-cat-ink bg-cat' : 'border-transparent bg-surface-2',
                    )}
                  >
                    <span className="grid aspect-square w-full place-items-center">
                      <PageThumb pdf={pdf} page={page} width={140} rotate={active ? angle : 0} className="max-h-full w-[78%]" />
                    </span>
                    <span className={cn('text-xs font-bold tabular-nums', active ? 'text-cat-ink' : 'text-ink-soft')}>{page}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      }
      options={
        <>
          <OptionGroup title={t('pivoter.angle')}>
            <Segmented<Angle>
              label={t('pivoter.angle')}
              value={settings.angle}
              onChange={(a) => setSettings({ angle: a })}
              options={[
                { value: '270', label: t('pivoter.left'), icon: <RotateCcw /> },
                { value: '180', label: '180°', icon: <RefreshCw /> },
                { value: '90', label: t('pivoter.right'), icon: <RotateCw /> },
              ]}
            />
          </OptionGroup>
          <OptionGroup title={t('tools.scope.title')}>
            <Select<PageScope>
              aria-label={t('tools.scope.title')}
              value={scope}
              onChange={(s) => setSettings({ scope: s })}
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
          </OptionGroup>
        </>
      }
      actionLabel={t('pivoter.action')}
      actionHint={targets === null ? t('tools.invalidRange') : batch ? t('tools.batchCount', { count: inputs.length }) : t('pivoter.summary', { count })}
      actionDisabled={targets === null || count === 0}
      onAction={start}
    />
  );
}
