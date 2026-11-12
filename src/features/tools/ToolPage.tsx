// Coquille commune à tous les outils : Choisir → Régler → Récupérer.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { ArrowLeft, Check, FolderOpen, Library, RotateCcw, TriangleAlert } from 'lucide-react';
import { classifyError } from '@/core/errors';
import { useT } from '@/i18n';
import { back, navigate, routes } from '@/lib/router';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/Brand';
import { cn } from '@/ui/cn';
import { ProgressBar, Spinner } from '@/ui/Fields';
import { Menu } from '@/ui/Overlay';
import { toast, toastError } from '@/ui/toast';
import { ResultPanel } from '@/features/export/ResultPanel';
import { isHeavy } from '@/features/library/import';
import { Page } from '@/features/shell/Shell';
import { FileChooser, LibraryPicker } from './FileChooser';
import { takeFiles, takeInputs } from './handoff';
import { prepareFiles, prepareLibraryFiles } from './inputs';
import { toolById, type ToolMeta } from './registry';
import type { InputFile, JobContext, JobResult, OutputFile, ToolProps } from './types';
import { IMAGE_ACCEPT, pickFiles } from '@/features/library/import';

type Step = 'choose' | 'configure' | 'working' | 'result';

const components = new Map<string, ComponentType<ToolProps>>();
function componentFor(tool: ToolMeta): ComponentType<ToolProps> {
  let c = components.get(tool.id);
  if (!c) {
    c = lazy(tool.load);
    components.set(tool.id, c);
  }
  return c;
}

export default function ToolPage({ toolId, fileIds }: { toolId: string; fileIds: string[] }) {
  const t = useT();
  const tool = toolById(toolId);
  const [inputs, setInputs] = useState<InputFile[]>([]);
  const [step, setStep] = useState<Step>('choose');
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<{ ratio: number | null; label?: string }>({ ratio: null });
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<{ code: string; detail?: string } | null>(null);
  const [libraryPicker, setLibraryPicker] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const accept = (incoming: InputFile[]) => {
    if (!tool || incoming.length === 0) return;
    const next = tool.multiple ? [...inputsRef.current, ...incoming] : incoming.slice(0, 1);
    setInputs(next);
    setError(null);
    setStep('configure');
    if (next.some((i) => isHeavy(i.blob.size))) toast(t('errors.heavy'));
  };

  const guard = async (work: () => Promise<InputFile[]>) => {
    setPreparing(true);
    try {
      accept(await work());
    } catch (err) {
      console.error(err);
      const code = classifyError(err);
      toastError(t(code === 'damaged' ? 'errors.damaged.title' : 'errors.generic'));
    } finally {
      setPreparing(false);
    }
  };

  const addFiles = (files: File[]) =>
    guard(async () => {
      const { inputs: prepared, rejected } = await prepareFiles(files, tool!);
      if (rejected > 0) toastError(t(tool!.accepts === 'pdf' ? 'tools.choose.rejectedPdf' : 'tools.choose.rejectedImage', { count: rejected }));
      return prepared;
    });
  const addLibrary = (ids: string[]) => guard(() => prepareLibraryFiles(ids, tool!));

  // Fichiers transmis par l'URL (bibliothèque, lecteur) ou par un autre écran.
  useEffect(() => {
    if (!tool) return;
    const handed = takeInputs();
    const files = takeFiles();
    if (handed.length) accept(handed);
    else if (files.length) void addFiles(files);
    else if (fileIds.length) void addLibrary(fileIds);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Tool = useMemo(() => (tool ? componentFor(tool) : null), [tool]);

  if (!tool || !Tool) {
    return (
      <Page title={t('tools.title')}>
        <EmptyState title={t('tools.unknown')} mood="searching">
          <Button variant="primary" onClick={() => navigate(routes.tools)}>{t('tools.seeAll')}</Button>
        </EmptyState>
      </Page>
    );
  }

  const run: ToolProps['run'] = (job) => {
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ ratio: null });
    setError(null);
    setStep('working');
    const ctx: JobContext = {
      signal: controller.signal,
      progress: (ratio, label) => !controller.signal.aborted && setProgress({ ratio, label }),
    };
    job(ctx)
      .then((value) => {
        if (controller.signal.aborted) return;
        const res: JobResult = Array.isArray(value) ? { outputs: value as OutputFile[] } : value;
        const single = inputsRef.current.length === 1 ? inputsRef.current[0].libraryId : undefined;
        res.outputs = res.outputs.map((o) => ({ ...o, parentId: o.parentId ?? single }));
        setResult(res);
        setStep('result');
      })
      .catch((err) => {
        if (controller.signal.aborted || classifyError(err) === 'aborted') {
          setStep('configure');
          return;
        }
        console.error(err);
        const code = classifyError(err);
        setError({ code, detail: code === 'unknown' ? (err as Error)?.message : undefined });
        setStep('configure');
      });
  };

  const cancel = () => {
    abort.current?.abort();
    setStep('configure');
  };

  const addMore = async () => {
    if (tool.accepts === 'images') {
      const files = await pickFiles({ accept: IMAGE_ACCEPT, multiple: true });
      if (files.length) void addFiles(files);
    } else {
      setAddMenu(true);
    }
  };
  const addFromDevice = async () => {
    const files = await pickFiles({ accept: 'application/pdf,.pdf', multiple: true });
    if (files.length) void addFiles(files);
  };

  const restart = () => {
    setInputs([]);
    setResult(null);
    setError(null);
    setStep('choose');
  };

  const steps: Array<{ id: Step; label: string }> = [
    { id: 'choose', label: t('tools.steps.choose') },
    { id: 'configure', label: t('tools.steps.configure') },
    { id: 'result', label: t('tools.steps.result') },
  ];
  const current = step === 'working' ? 1 : steps.findIndex((s) => s.id === step);

  return (
    <Page
      cat={tool.cat}
      icon={<tool.icon />}
      title={t(`tools.${tool.id}.name`)}
      subtitle={t(`tools.${tool.id}.desc`)}
      wide
      back={
        <button type="button" onClick={() => back(routes.tools)} aria-label={t('common.back')} title={t('common.back')} className="grid size-11 shrink-0 place-items-center rounded-md text-cat-ink hover:bg-surface/50">
          <ArrowLeft className="size-5" />
        </button>
      }
    >
      <ol className="mb-5 flex items-center gap-2 text-sm font-bold" aria-label={t('tools.steps.label')}>
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
            {i > 0 && <span className={cn('h-0.5 w-5 rounded-full sm:w-10', i <= current ? 'bg-cat-ink' : 'bg-line')} aria-hidden="true" />}
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs',
                i < current && 'border-cat-ink bg-cat-ink text-cat',
                i === current && 'border-cat-ink bg-cat text-cat-ink',
                i > current && 'border-line text-ink-soft',
              )}
            >
              {i < current ? <Check className="size-4" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn(i === current ? 'text-ink' : 'text-ink-soft', i !== current && 'hidden sm:inline')}>{s.label}</span>
          </li>
        ))}
        {step !== 'choose' && (
          <li className="ml-auto">
            <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={restart} aria-label={t('tools.restart')}>
              <span className="hidden sm:inline">{t('tools.restart')}</span>
            </Button>
          </li>
        )}
      </ol>

      {error && (
        <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-ink">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-bold">{t(`errors.${error.code}.title`)}</p>
            <p className="text-sm">{t(`errors.${error.code}.action`)}</p>
            {error.detail && <p className="mt-1 text-xs break-words text-ink-soft">{error.detail}</p>}
          </div>
        </div>
      )}

      {step === 'choose' &&
        (preparing ? (
          <div className="grid place-items-center py-16" role="status">
            <span className="flex items-center gap-3 text-ink-soft"><Spinner /> {t('tools.preparing')}</span>
          </div>
        ) : (
          <FileChooser tool={tool} onFiles={addFiles} onLibrary={addLibrary} busy={preparing} />
        ))}

      {/* L'outil reste monté pendant le traitement : ses réglages sont conservés si l'on annule. */}
      {(step === 'configure' || step === 'working') && (
        <div className={cn(step === 'working' && 'hidden')}>
          <Suspense fallback={<div className="grid place-items-center py-16" role="status"><Spinner /></div>}>
            <Tool tool={tool} inputs={inputs} setInputs={(next) => (next.length ? setInputs(next) : restart())} addMore={addMore} run={run} />
          </Suspense>
        </div>
      )}

      {step === 'working' && (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border border-line bg-surface p-6 text-center shadow-soft" role="status" aria-live="polite">
          <span className="grid size-14 place-items-center rounded-full bg-cat text-cat-ink" aria-hidden="true">
            <tool.icon className="size-6 animate-pulse" />
          </span>
          <p className="font-display text-2xl font-semibold">{t('tools.working')}</p>
          <ProgressBar value={progress.ratio} label={t('tools.working')} />
          <p className="min-h-5 text-sm text-ink-soft">{progress.label ?? t('tools.workingHint')}</p>
          <Button onClick={cancel}>{t('common.cancel')}</Button>
        </div>
      )}

      {step === 'result' && result && (
        <ResultPanel tool={tool} result={result} onAgain={() => setStep('configure')} onRestart={restart} />
      )}

      <Menu
        open={addMenu}
        onClose={() => setAddMenu(false)}
        title={t('tools.addFiles')}
        sections={[
          {
            items: [
              { id: 'device', label: t('tools.choose.device'), icon: <FolderOpen />, onSelect: () => void addFromDevice() },
              { id: 'library', label: t('tools.choose.library'), icon: <Library />, onSelect: () => setLibraryPicker(true) },
            ],
          },
        ]}
      />
      <LibraryPicker
        open={libraryPicker}
        multiple
        onClose={() => setLibraryPicker(false)}
        onPick={(ids) => {
          setLibraryPicker(false);
          void addLibrary(ids);
        }}
      />
    </Page>
  );
}
