// Étape « Récupérer » : renommer, télécharger, partager, enregistrer dans la
// bibliothèque, ouvrir dans le lecteur, enchaîner un autre outil.
import { useEffect, useRef, useState } from 'react';
import { Archive, BookOpen, Check, Download, FilePlus2, Library, Share2, SlidersHorizontal, Workflow } from 'lucide-react';
import { db } from '@/db';
import { renameFile } from '@/db/files';
import { sanitizeFileName, splitName } from '@/core/naming';
import { formatBytes, formatPercent, useT } from '@/i18n';
import { navigate, routes } from '@/lib/router';
import { updateSettings, useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Mascot } from '@/ui/Brand';
import { Dialog } from '@/ui/Overlay';
import { toastError, toastSuccess } from '@/ui/toast';
import { savePdfToLibrary } from '@/features/library/import';
import { handOffInputs } from '@/features/tools/handoff';
import { tools, type ToolMeta } from '@/features/tools/registry';
import { ToolCard } from '@/features/tools/ToolCard';
import type { JobResult, OutputFile } from '@/features/tools/types';
import { canShareFiles, downloadBlob, shareFiles, zipBlobs } from './actions';

const isPdfOutput = (o: OutputFile) => /\.pdf$/i.test(o.name);

export function ResultPanel({
  tool,
  result,
  onAgain,
  onRestart,
}: {
  tool: ToolMeta;
  result: JobResult;
  onAgain: () => void;
  onRestart: () => void;
}) {
  const t = useT();
  const settings = useSettings();
  const [names, setNames] = useState(() => result.outputs.map((o) => o.name));
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [chain, setChain] = useState(false);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const namesRef = useRef(names);
  namesRef.current = names;
  const started = useRef(false);

  const outputs = result.outputs.map((o, i) => ({ ...o, name: names[i] }));
  const pdfs = outputs.filter(isPdfOutput);
  const many = outputs.length > 1;
  const totalSize = outputs.reduce((sum, o) => sum + o.blob.size, 0);
  const allSaved = pdfs.length > 0 && outputs.every((o, i) => !isPdfOutput(o) || saved[i]);

  const save = async (indices: number[]): Promise<Record<number, string>> => {
    const next = { ...savedRef.current };
    for (const i of indices) {
      if (next[i] || !isPdfOutput(outputs[i])) continue;
      const parentId = outputs[i].parentId && (await db.files.get(outputs[i].parentId!)) ? outputs[i].parentId : undefined;
      const name = namesRef.current[i];
      const record = await savePdfToLibrary(name, outputs[i].blob, { origin: 'tool', tool: tool.id, parentId });
      // Le fichier a pu être renommé pendant l'enregistrement.
      if (namesRef.current[i] !== name) await renameFile(record.id, namesRef.current[i]);
      next[i] = record.id;
    }
    savedRef.current = next;
    setSaved(next);
    return next;
  };

  // Enregistrement automatique dans la bibliothèque (désactivable dans les réglages).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!settings.firstSuccess) updateSettings({ firstSuccess: true });
    if (settings.saveToLibrary && pdfs.length > 0) {
      void save(outputs.map((_, i) => i)).catch(() => toastError(t('export.saveFailed')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rename = (i: number, base: string) => {
    const { ext } = splitName(result.outputs[i].name);
    const name = sanitizeFileName(`${base}${ext ? `.${ext}` : ''}`);
    namesRef.current = namesRef.current.map((n, k) => (k === i ? name : n));
    setNames(namesRef.current);
    if (savedRef.current[i]) void renameFile(savedRef.current[i], name);
  };

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      console.error(err);
      toastError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = () =>
    guard(async () => {
      if (!many) {
        await downloadBlob(outputs[0].name, outputs[0].blob);
        return;
      }
      const { base } = splitName(outputs[0].name);
      await downloadBlob(`${base.replace(/[_-]?\d+$/, '') || 'pidielf'}.zip`, await zipBlobs(outputs));
    });

  const share = () =>
    guard(async () => {
      try {
        await shareFiles(outputs);
      } catch {
        toastError(t('export.shareFailed'));
      }
    });

  const openInReader = (i: number) =>
    guard(async () => {
      const ids = await save([i]);
      if (ids[i]) navigate(routes.reader(ids[i]));
    });

  const chainTo = (next: ToolMeta) => {
    handOffInputs(
      pdfs.map((o, i) => ({
        key: `chain-${Date.now()}-${i}`,
        name: o.name,
        blob: o.blob,
        pageCount: o.pageCount ?? 0,
        libraryId: saved[outputs.indexOf(o)],
      })),
    );
    navigate(routes.tool(next.id));
  };

  const gain = result.originalSize ? 1 - totalSize / result.originalSize : null;
  const firstPdf = outputs.findIndex(isPdfOutput);
  const shareable = canShareFiles(outputs);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <section className="rounded-xl border border-line bg-surface p-4 shadow-soft md:p-6" aria-live="polite">
        <div className="flex items-center gap-4">
          <Mascot mood="happy" className="h-20 w-auto shrink-0" />
          <div className="min-w-0">
            <h2 className="text-3xl">{t('export.ready', { count: outputs.length })}</h2>
            <p className="text-ink-soft">
              {many ? t('export.filesTotal', { count: outputs.length, size: formatBytes(totalSize) }) : t('export.finalSize', { size: formatBytes(totalSize) })}
            </p>
          </div>
        </div>

        {gain !== null && result.originalSize && (
          <p className="mt-4 rounded-lg bg-cat px-3 py-2.5 font-semibold text-cat-ink">
            {gain > 0.005
              ? t('export.gain', { before: formatBytes(result.originalSize), after: formatBytes(totalSize), pct: formatPercent(gain) })
              : t('export.noGain', { size: formatBytes(result.originalSize) })}
          </p>
        )}
        {result.note && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">{result.note}</p>}

        <ul className="mt-4 flex flex-col gap-2">
          {outputs.map((o, i) => {
            const { base, ext } = splitName(o.name);
            return (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-line p-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{t('export.fileName')}</span>
                  <span className="flex items-center rounded-md border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus">
                    <input
                      value={base}
                      onChange={(e) => rename(i, e.target.value)}
                      className="min-h-11 w-full min-w-0 flex-1 bg-transparent pl-3 font-semibold outline-none"
                    />
                    {ext && <span className="px-2 text-sm text-ink-soft">.{ext}</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 px-1 text-xs text-ink-soft">
                    {formatBytes(o.blob.size)}
                    {o.pageCount ? ` · ${t('common.pages', { count: o.pageCount })}` : ''}
                    {saved[i] && (
                      <span className="inline-flex items-center gap-0.5 font-bold text-accent">
                        <Check className="size-3" aria-hidden="true" /> {t('export.inLibrary')}
                      </span>
                    )}
                  </span>
                </label>
                {many && (
                  <Button size="sm" icon={<Download />} onClick={() => void downloadBlob(o.name, o.blob)} aria-label={t('export.downloadNamed', { name: o.name })}>
                    <span className="hidden sm:inline">{t('export.download')}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-col gap-2.5">
          <Button variant="primary" size="lg" block icon={many ? <Archive /> : <Download />} onClick={downloadAll} disabled={busy}>
            {many ? t('export.zip') : t('export.download')}
          </Button>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {shareable && (
              <Button icon={<Share2 />} onClick={share} disabled={busy}>{t('export.share')}</Button>
            )}
            {firstPdf >= 0 && (
              <Button icon={<BookOpen />} onClick={() => openInReader(firstPdf)} disabled={busy}>{t('export.openInReader')}</Button>
            )}
            {pdfs.length > 0 && !allSaved && (
              <Button icon={<Library />} disabled={busy} onClick={() => guard(async () => {
                await save(outputs.map((_, i) => i));
                toastSuccess(t('export.savedToLibrary'));
              })}>
                {t('export.saveToLibrary')}
              </Button>
            )}
            {pdfs.length > 0 && (
              <Button icon={<Workflow />} onClick={() => setChain(true)} disabled={busy}>{t('export.chain')}</Button>
            )}
          </div>
        </div>
        {result.extra && <div className="mt-5 border-t border-line pt-4">{result.extra}</div>}
      </section>

      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ghost" icon={<SlidersHorizontal />} onClick={onAgain}>{t('export.adjust')}</Button>
        <Button variant="ghost" icon={<FilePlus2 />} onClick={onRestart}>{t('export.another')}</Button>
      </div>

      <Dialog open={chain} onClose={() => setChain(false)} title={t('export.chainTitle')} size="lg">
        <p className="mb-3 text-ink-soft">{t('export.chainText')}</p>
        <div className="grid grid-cols-1 gap-2 pb-3 sm:grid-cols-2">
          {tools
            .filter((x) => x.accepts === 'pdf' && (x.multiple || pdfs.length === 1))
            .map((x) => (
              <div key={x.id} onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); setChain(false); chainTo(x); }}>
                <ToolCard tool={x} compact />
              </div>
            ))}
        </div>
      </Dialog>
    </div>
  );
}
