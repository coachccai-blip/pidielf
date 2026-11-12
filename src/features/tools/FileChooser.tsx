// Étape « Choisir » : depuis l'appareil, la bibliothèque ou l'appareil photo.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Check, FolderOpen, Library, Search } from 'lucide-react';
import { db } from '@/db';
import { formatBytes, useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Dialog } from '@/ui/Overlay';
import { Cover } from '@/features/library/Cover';
import { IMAGE_ACCEPT, pickFiles } from '@/features/library/import';
import type { ToolMeta } from './registry';

export function FileChooser({
  tool,
  onFiles,
  onLibrary,
  busy,
}: {
  tool: ToolMeta;
  onFiles: (files: File[]) => void;
  onLibrary: (ids: string[]) => void;
  busy?: boolean;
}) {
  const t = useT();
  const [over, setOver] = useState(false);
  const [picker, setPicker] = useState(false);
  const images = tool.accepts === 'images';
  const accept = images ? IMAGE_ACCEPT : 'application/pdf,.pdf';

  const browse = async () => {
    const files = await pickFiles({ accept, multiple: tool.multiple });
    if (files.length) onFiles(files);
  };
  const camera = async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: false, capture: true });
    if (files.length) onFiles(files);
  };

  return (
    <div
      data-dropzone
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(tool.multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        'elf-pattern flex flex-col items-center rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors duration-150 md:py-14',
        over ? 'border-cat-ink bg-cat' : 'border-cat-ink/40 bg-surface',
      )}
    >
      <span className="mb-4 grid size-16 place-items-center rounded-full bg-cat text-cat-ink" aria-hidden="true">
        <tool.icon className="size-7" />
      </span>
      <h2 className="text-2xl md:text-3xl">{t(images ? 'tools.choose.titleImages' : tool.multiple ? 'tools.choose.titleMany' : 'tools.choose.titleOne')}</h2>
      <p className="mt-1 max-w-md text-ink-soft">{t('tools.choose.hint')}</p>
      <div className="mt-6 flex w-full max-w-md flex-col gap-2.5 sm:flex-row sm:justify-center">
        <Button variant="primary" size="lg" icon={<FolderOpen />} onClick={browse} disabled={busy} className="sm:flex-1">
          {t('tools.choose.device')}
        </Button>
        {!images && (
          <Button size="lg" icon={<Library />} onClick={() => setPicker(true)} disabled={busy} className="sm:flex-1">
            {t('tools.choose.library')}
          </Button>
        )}
        {images && (
          <Button size="lg" icon={<Camera />} onClick={camera} disabled={busy} className="sm:flex-1">
            {t('tools.choose.camera')}
          </Button>
        )}
      </div>
      <p className="mt-5 text-sm text-ink-soft">{t('common.promiseShort')}</p>
      <LibraryPicker
        open={picker}
        multiple={tool.multiple}
        onClose={() => setPicker(false)}
        onPick={(ids) => {
          setPicker(false);
          onLibrary(ids);
        }}
      />
    </div>
  );
}

/** Choix d'un ou plusieurs fichiers de la bibliothèque. */
export function LibraryPicker({
  open,
  multiple,
  onClose,
  onPick,
}: {
  open: boolean;
  multiple: boolean;
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const t = useT();
  const files = useLiveQuery(() => db.files.orderBy('addedAt').reverse().toArray(), []) ?? [];
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const q = query.trim().toLocaleLowerCase();
  const shown = q ? files.filter((f) => f.name.toLocaleLowerCase().includes(q)) : files;

  const close = () => {
    setSelected([]);
    setQuery('');
    onClose();
  };
  const pick = (ids: string[]) => {
    setSelected([]);
    setQuery('');
    onPick(ids);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('tools.choose.libraryTitle')}
      footer={
        multiple ? (
          <Button variant="primary" disabled={selected.length === 0} onClick={() => pick(selected)}>
            {t('tools.choose.add', { count: selected.length })}
          </Button>
        ) : undefined
      }
    >
      {files.length === 0 ? (
        <p className="py-6 text-center text-ink-soft">{t('tools.choose.libraryEmpty')}</p>
      ) : (
        <>
          <label className="relative mb-3 block">
            <span className="sr-only">{t('library.search')}</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('library.search')}
              className="min-h-11 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9"
            />
          </label>
          <ul className="flex flex-col gap-1.5 pb-2">
            {shown.map((f) => {
              const index = selected.indexOf(f.id);
              const active = index >= 0;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    aria-pressed={multiple ? active : undefined}
                    onClick={() => (multiple ? setSelected(active ? selected.filter((id) => id !== f.id) : [...selected, f.id]) : pick([f.id]))}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-2 text-left',
                      active ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <Cover file={f} className="h-14 w-10 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{f.name}</span>
                      <span className="block text-sm text-ink-soft">
                        {f.pageCount > 0 ? t('common.pages', { count: f.pageCount }) : t('library.protected')} · {formatBytes(f.size)}
                      </span>
                    </span>
                    {multiple && (
                      <span
                        className={cn(
                          'grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold',
                          active ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
                        )}
                        aria-hidden="true"
                      >
                        {active ? index + 1 : <Check className="size-3.5 opacity-0" />}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}
