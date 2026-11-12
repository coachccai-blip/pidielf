import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, CornerDownRight, Download, GitBranch, Share2 } from 'lucide-react';
import { db, type FileRecord } from '@/db';
import { getFileBlob } from '@/db/files';
import { formatBytes, formatDate, formatPercent, useT } from '@/i18n';
import { href, navigate, routes } from '@/lib/router';
import { Button } from '@/ui/Button';
import { Drawer } from '@/ui/Overlay';
import { toastError } from '@/ui/toast';
import { canShareFiles, downloadBlob, shareFiles } from '@/features/export/actions';
import { ToolGrid } from '@/features/tools/ToolCard';
import { Cover } from './Cover';

/** Fiche d'un fichier : informations, export, versions dérivées, outils. */
export function FileSheet({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const t = useT();
  const file = useLiveQuery(() => (fileId ? db.files.get(fileId) : undefined), [fileId]);
  const parent = useLiveQuery(() => (file?.parentId ? db.files.get(file.parentId) : undefined), [file?.parentId]);
  const versions = useLiveQuery(() => (fileId ? db.files.where('parentId').equals(fileId).toArray() : []), [fileId]) ?? [];
  const notes = useLiveQuery(() => (fileId ? db.annotations.where('fileId').equals(fileId).count() : 0), [fileId]) ?? 0;

  if (!fileId || !file) return null;

  const download = async () => {
    const blob = await getFileBlob(file.id);
    if (blob) await downloadBlob(file.name, blob);
  };
  const share = async () => {
    try {
      const blob = await getFileBlob(file.id);
      if (blob) await shareFiles([{ name: file.name, blob }]);
    } catch {
      toastError(t('export.shareFailed'));
    }
  };
  const open = (id: string) => {
    onClose();
    navigate(routes.reader(id));
  };

  const rows: Array<[string, string]> = [
    [t('library.info.pages'), file.pageCount > 0 ? String(file.pageCount) : t('library.protected')],
    [t('library.info.size'), formatBytes(file.size)],
    [t('library.info.added'), formatDate(file.addedAt)],
    [t('library.info.opened'), file.openedAt ? formatDate(file.openedAt) : t('library.info.never')],
    [t('library.progress'), formatPercent(file.progress ?? 0)],
    [t('library.info.notes'), String(notes)],
    [t('library.info.origin'), file.origin === 'tool' && file.tool ? t('library.info.producedBy', { tool: t(`tools.${file.tool}.name`) }) : t('library.info.imported')],
  ];

  return (
    <Drawer open onClose={onClose} title={t('library.details')}>
      <div className="flex flex-col gap-5 pb-4">
        <div className="flex gap-4">
          <Cover file={file} className="h-36 w-28 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-tight font-semibold break-words">{file.name}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="primary" icon={<BookOpen />} onClick={() => open(file.id)}>{t('export.openInReader')}</Button>
              <Button icon={<Download />} onClick={download}>{t('export.download')}</Button>
              {canShareFiles() && <Button icon={<Share2 />} onClick={share}>{t('export.share')}</Button>}
            </div>
          </div>
        </div>

        <dl className="divide-y divide-line rounded-lg border border-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-3 py-2 text-sm">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        {(parent || versions.length > 0) && (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xl">
              <GitBranch className="size-4" aria-hidden="true" /> {t('library.versions')}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {parent && <VersionRow file={parent} label={t('library.original')} />}
              {versions.map((v) => (
                <VersionRow key={v.id} file={v} label={v.tool ? t(`tools.${v.tool}.name`) : t('library.derived')} derived />
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-soft">{t('library.versionsHint')}</p>
          </section>
        )}

        {!file.encrypted && (
          <section>
            <h3 className="mb-2 text-xl">{t('library.compatibleTools')}</h3>
            <ToolGrid fileIds={[file.id]} compact />
          </section>
        )}
      </div>
    </Drawer>
  );
}

function VersionRow({ file, label, derived }: { file: FileRecord; label: string; derived?: boolean }) {
  return (
    <li>
      <a href={href(routes.reader(file.id))} className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 py-1.5 hover:bg-surface-2">
        {derived && <CornerDownRight className="size-4 shrink-0 text-ink-soft" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{file.name}</span>
          <span className="block text-xs text-ink-soft">{label} · {formatDate(file.addedAt)}</span>
        </span>
      </a>
    </li>
  );
}
