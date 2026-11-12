import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive, BookOpen, Camera, CheckSquare, Combine, Copy, Download, FolderPlus, Info, LayoutGrid, List, MoreVertical,
  Pencil, Search, Share2, Square, Star, Trash2, Upload, X,
} from 'lucide-react';
import { db, type FileRecord, type ShelfRecord } from '@/db';
import { createShelf, deleteFiles, deleteShelf, duplicateFile, getFileBlob, readState, renameFile, setFavorite } from '@/db/files';
import { sanitizeFileName, splitName } from '@/core/naming';
import { formatBytes, formatDate, useT } from '@/i18n';
import { href, navigate, routes } from '@/lib/router';
import { updateSettings, useSettings } from '@/lib/settings';
import { useLongPress, type PressPoint } from '@/lib/useLongPress';
import { Button, IconButton } from '@/ui/Button';
import { EmptyState } from '@/ui/Brand';
import { cn } from '@/ui/cn';
import { confirm, prompt } from '@/ui/dialogs';
import { Select } from '@/ui/Fields';
import { Menu, type MenuSection } from '@/ui/Overlay';
import { toastError, toastSuccess } from '@/ui/toast';
import { canShareFiles, downloadBlob, shareFiles, zipBlobs } from '@/features/export/actions';
import { Page } from '@/features/shell/Shell';
import { tools } from '@/features/tools/registry';
import { Cover } from './Cover';
import { FileSheet } from './FileSheet';
import { importFiles, pickFiles } from './import';
import { ShelfDialog } from './ShelfDialog';

type Filter = 'all' | 'favorites' | 'unread' | 'reading' | 'done' | 'produced';
const filters: Filter[] = ['all', 'favorites', 'unread', 'reading', 'done', 'produced'];

export default function LibraryPage() {
  const t = useT();
  const settings = useSettings();
  const files = useLiveQuery(() => db.files.toArray(), []);
  const shelves = useLiveQuery(() => db.shelves.orderBy('name').toArray(), []) ?? [];

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shelf, setShelf] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ file: FileRecord; anchor: PressPoint | null } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [shelfTargets, setShelfTargets] = useState<string[] | null>(null);

  const visible = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLocaleLowerCase();
    const list = files.filter((f) => {
      if (q && !f.name.toLocaleLowerCase().includes(q)) return false;
      if (shelf && !f.shelves.includes(shelf)) return false;
      if (filter === 'favorites') return !!f.favorite;
      if (filter === 'produced') return f.origin === 'tool';
      if (filter !== 'all') return readState(f) === filter;
      return true;
    });
    const sort = settings.librarySort;
    return list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'size') return b.size - a.size;
      if (sort === 'opened') return (b.openedAt ?? 0) - (a.openedAt ?? 0);
      return b.addedAt - a.addedAt;
    });
  }, [files, query, filter, shelf, settings.librarySort]);

  const reading = useMemo(
    () => (files ?? []).filter((f) => f.openedAt).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)).slice(0, 6),
    [files],
  );

  const importNow = async () => {
    const picked = await pickFiles({ accept: 'application/pdf,.pdf,image/*' });
    if (picked.length) await importFiles(picked);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const selectedFiles = () => (files ?? []).filter((f) => selected.has(f.id));

  // ---- Actions ------------------------------------------------------------

  const rename = async (file: FileRecord) => {
    const { base, ext } = splitName(file.name);
    const value = await prompt({ title: t('library.rename'), label: t('library.newName'), initial: base, confirmLabel: t('library.rename') });
    if (value?.trim()) await renameFile(file.id, sanitizeFileName(`${value.trim()}${ext ? `.${ext}` : ''}`));
  };

  const duplicate = async (file: FileRecord) => {
    const { base, ext } = splitName(file.name);
    await duplicateFile(file.id, `${base} (${t('library.copySuffix')})${ext ? `.${ext}` : ''}`);
    toastSuccess(t('library.duplicated'));
  };

  const remove = async (targets: FileRecord[]) => {
    if (targets.length === 0) return;
    const ok = await confirm({
      title: t('library.deleteTitle', { count: targets.length }),
      message: targets.length === 1 ? t('library.deleteOne', { name: targets[0].name }) : t('library.deleteMany', { count: targets.length }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    await deleteFiles(targets.map((f) => f.id));
    stopSelecting();
    toastSuccess(t('library.deleted', { count: targets.length }));
  };

  const download = async (file: FileRecord) => {
    const blob = await getFileBlob(file.id);
    if (blob) await downloadBlob(file.name, blob);
  };

  const share = async (targets: FileRecord[]) => {
    try {
      const items = await Promise.all(targets.map(async (f) => ({ name: f.name, blob: (await getFileBlob(f.id))! })));
      await shareFiles(items);
    } catch {
      toastError(t('export.shareFailed'));
    }
  };

  const exportZip = async (targets: FileRecord[]) => {
    try {
      const items = await Promise.all(targets.map(async (f) => ({ name: f.name, blob: (await getFileBlob(f.id))! })));
      await downloadBlob(`pidielf-${new Date().toISOString().slice(0, 10)}.zip`, await zipBlobs(items));
    } catch (err) {
      console.error(err);
      toastError(t('errors.generic'));
    }
  };

  const menuSections = (file: FileRecord): MenuSection[] => [
    {
      items: [
        { id: 'open', label: t('export.openInReader'), icon: <BookOpen />, onSelect: () => navigate(routes.reader(file.id)) },
        { id: 'info', label: t('library.details'), icon: <Info />, onSelect: () => setDetail(file.id) },
        { id: 'download', label: t('export.download'), icon: <Download />, onSelect: () => void download(file) },
        ...(canShareFiles() ? [{ id: 'share', label: t('export.share'), icon: <Share2 />, onSelect: () => void share([file]) }] : []),
      ],
    },
    {
      items: [
        {
          id: 'fav',
          label: file.favorite ? t('library.unfavorite') : t('library.favorite'),
          icon: <Star />,
          onSelect: () => void setFavorite(file.id, !file.favorite),
        },
        { id: 'shelf', label: t('library.shelves'), icon: <FolderPlus />, onSelect: () => setShelfTargets([file.id]) },
        { id: 'rename', label: t('library.rename'), icon: <Pencil />, onSelect: () => void rename(file) },
        { id: 'dup', label: t('library.duplicate'), icon: <Copy />, onSelect: () => void duplicate(file) },
        {
          id: 'select',
          label: t('library.select'),
          icon: <CheckSquare />,
          onSelect: () => {
            setSelecting(true);
            setSelected(new Set([file.id]));
          },
        },
      ],
    },
    {
      title: t('library.compatibleTools'),
      items: tools
        .filter((tool) => tool.accepts === 'pdf' && (!file.encrypted || tool.id === 'deverrouiller'))
        .map((tool) => ({
          id: tool.id,
          label: t(`tools.${tool.id}.name`),
          icon: <tool.icon />,
          cat: tool.cat,
          onSelect: () => navigate(routes.tool(tool.id, [file.id])),
        })),
    },
    { items: [{ id: 'delete', label: t('common.delete'), icon: <Trash2 />, danger: true, onSelect: () => void remove([file]) }] },
  ];

  const empty = files && files.length === 0;
  const grid = settings.libraryView === 'grid';

  return (
    <Page
      title={t('library.title')}
      subtitle={files ? t('library.count', { count: files.length }) : undefined}
      actions={
        <>
          <a
            href={href(routes.tool('scanner'))}
            aria-label={t('library.import.scan')}
            title={t('library.import.scan')}
            className="grid size-11 place-items-center rounded-md border border-line bg-surface-2 text-ink hover:bg-line"
          >
            <Camera className="size-5" aria-hidden="true" />
          </a>
          <Button variant="primary" icon={<Upload />} onClick={importNow}>
            <span className="hidden sm:inline">{t('library.import.button')}</span>
            <span className="sm:hidden">{t('library.import.short')}</span>
          </Button>
        </>
      }
    >
      {empty ? (
        <EmptyState title={t('library.emptyTitle')} text={t('library.emptyText')} mood="reading">
          <Button variant="primary" icon={<Upload />} onClick={importNow}>{t('library.import.button')}</Button>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {reading.length > 0 && !query && filter === 'all' && !shelf && (
            <section aria-labelledby="lib-reprendre">
              <h2 id="lib-reprendre" className="mb-2 text-2xl">{t('home.continue')}</h2>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
                {reading.map((f) => (
                  <a
                    key={f.id}
                    href={href(routes.reader(f.id))}
                    className="flex w-56 shrink-0 items-center gap-3 rounded-lg border border-line bg-surface p-2 shadow-soft"
                  >
                    <Cover file={f} className="h-16 w-12 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm leading-tight font-bold">{f.name.replace(/\.pdf$/i, '')}</span>
                      <ProgressLine value={f.progress ?? 0} className="mt-1.5" />
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Recherche, tri, affichage */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[12rem] flex-1">
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
            <Select
              aria-label={t('library.sort')}
              className="w-auto flex-1 sm:flex-none"
              value={settings.librarySort}
              onChange={(librarySort) => updateSettings({ librarySort })}
              options={[
                { value: 'added', label: t('library.sortAdded') },
                { value: 'name', label: t('library.sortName') },
                { value: 'size', label: t('library.sortSize') },
                { value: 'opened', label: t('library.sortOpened') },
              ]}
            />
            <IconButton
              variant="soft"
              label={grid ? t('library.viewList') : t('library.viewGrid')}
              onClick={() => updateSettings({ libraryView: grid ? 'list' : 'grid' })}
            >
              {grid ? <List /> : <LayoutGrid />}
            </IconButton>
            <IconButton
              variant="soft"
              label={selecting ? t('library.stopSelect') : t('library.select')}
              active={selecting}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              <CheckSquare />
            </IconButton>
          </div>

          {/* Filtres et étagères */}
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6" role="group" aria-label={t('library.filters')}>
            {filters.map((f) => (
              <Chip key={f} active={filter === f && !shelf} onClick={() => { setFilter(f); setShelf(null); }}>
                {t(`library.filter.${f}`)}
              </Chip>
            ))}
            <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden="true" />
            {shelves.map((s) => (
              <ShelfChip key={s.id} shelf={s} active={shelf === s.id} onSelect={() => { setShelf(shelf === s.id ? null : s.id); setFilter('all'); }} onDeleted={() => setShelf(null)} />
            ))}
            <Chip
              onClick={async () => {
                const name = await prompt({ title: t('library.newShelf'), label: t('library.shelfName'), confirmLabel: t('common.create') });
                if (name?.trim()) await createShelf(name.trim());
              }}
            >
              <FolderPlus className="size-4" aria-hidden="true" /> {t('library.newShelf')}
            </Chip>
          </div>

          {visible.length === 0 ? (
            <EmptyState title={t('library.noResultTitle')} text={t('library.noResultText')} mood="searching" />
          ) : (
            <ul className={grid ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'flex flex-col gap-2'}>
              {visible.map((file) => (
                <FileItem
                  key={file.id}
                  file={file}
                  grid={grid}
                  selecting={selecting}
                  selected={selected.has(file.id)}
                  onToggle={() => toggle(file.id)}
                  onMenu={(anchor) => setMenu({ file, anchor })}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Barre de sélection multiple, à portée de pouce */}
      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(4.25rem+var(--safe-bottom))] z-30 px-3 md:bottom-4 md:left-60">
          <div className="mx-auto flex max-w-2xl animate-rise items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lift">
            <span className="px-3 text-sm font-bold whitespace-nowrap" aria-live="polite">
              {t('library.selected', { count: selected.size })}
            </span>
            <span className="flex-1" />
            <IconButton label={t('tools.fusionner.name')} disabled={selected.size < 2} onClick={() => navigate(routes.tool('fusionner', [...selected]))}>
              <Combine />
            </IconButton>
            <IconButton label={t('export.zip')} disabled={selected.size === 0} onClick={() => void exportZip(selectedFiles())}>
              <Archive />
            </IconButton>
            <IconButton label={t('library.shelves')} disabled={selected.size === 0} onClick={() => setShelfTargets([...selected])}>
              <FolderPlus />
            </IconButton>
            <IconButton label={t('common.delete')} disabled={selected.size === 0} onClick={() => void remove(selectedFiles())} className="text-danger">
              <Trash2 />
            </IconButton>
            <IconButton label={t('library.stopSelect')} onClick={stopSelecting}>
              <X />
            </IconButton>
          </div>
        </div>
      )}

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        title={menu?.file.name ?? ''}
        anchor={menu?.anchor}
        sections={menu ? menuSections(menu.file) : []}
      />
      <FileSheet fileId={detail} onClose={() => setDetail(null)} />
      <ShelfDialog fileIds={shelfTargets} onClose={() => setShelfTargets(null)} />
    </Page>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold whitespace-nowrap transition-colors duration-150',
        active ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-ink-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function ShelfChip({ shelf, active, onSelect, onDeleted }: { shelf: ShelfRecord; active: boolean; onSelect: () => void; onDeleted: () => void }) {
  const t = useT();
  const remove = async () => {
    const ok = await confirm({
      title: t('library.deleteShelfTitle', { name: shelf.name }),
      message: t('library.deleteShelfText'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) {
      await deleteShelf(shelf.id);
      onDeleted();
    }
  };
  return (
    <span
      className={cn(
        'inline-flex min-h-10 shrink-0 items-center rounded-full border text-sm font-bold whitespace-nowrap',
        active ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-ink-soft',
      )}
    >
      <button type="button" aria-pressed={active} onClick={onSelect} className="min-h-10 rounded-full pr-2 pl-3.5">
        {shelf.name}
      </button>
      {active && (
        <button type="button" aria-label={t('library.deleteShelf', { name: shelf.name })} onClick={remove} className="mr-1 grid size-8 place-items-center rounded-full hover:bg-black/10">
          <Trash2 className="size-3.5" />
        </button>
      )}
    </span>
  );
}

export function ProgressLine({ value, className }: { value: number; className?: string }) {
  const t = useT();
  const pct = Math.round(value * 100);
  return (
    <span
      role="progressbar"
      aria-label={t('library.progress')}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('block h-1.5 overflow-hidden rounded-full bg-surface-2', className)}
    >
      <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </span>
  );
}

function FileItem({
  file,
  grid,
  selecting,
  selected,
  onToggle,
  onMenu,
}: {
  file: FileRecord;
  grid: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onMenu: (anchor: PressPoint | null) => void;
}) {
  const t = useT();
  const press = useLongPress((p) => onMenu(p));
  const title = file.name.replace(/\.pdf$/i, '');
  const meta = `${file.pageCount > 0 ? t('common.pages', { count: file.pageCount }) : t('library.protected')} · ${formatBytes(file.size)}`;
  const state = readState(file);

  const onClick = (e: React.MouseEvent) => {
    if (press.consumeClick(e)) return;
    if (selecting) {
      e.preventDefault();
      onToggle();
    }
  };
  const { consumeClick: _unused, ...pressHandlers } = press;
  void _unused;

  const selectMark = selecting && (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md border-2',
        selected ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-transparent',
      )}
      aria-hidden="true"
    >
      {selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
    </span>
  );

  const more = !selecting && (
    <IconButton
      label={t('library.actionsFor', { name: title })}
      size="sm"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onMenu({ x: r.left, y: r.bottom + 4 });
      }}
    >
      <MoreVertical />
    </IconButton>
  );

  if (grid) {
    return (
      <li className={cn('group relative flex flex-col rounded-lg border bg-surface p-2 shadow-soft transition-transform duration-150', selected ? 'border-accent ring-2 ring-accent/40' : 'border-line')}>
        <a
          href={href(routes.reader(file.id))}
          onClick={onClick}
          {...pressHandlers}
          aria-label={selecting ? t('library.selectFile', { name: title }) : undefined}
          aria-pressed={selecting ? selected : undefined}
          className="block touch-pan-y rounded-md select-none [-webkit-touch-callout:none]"
        >
          <Cover file={file} className="aspect-[3/4] w-full" />
          <span className="mt-2 line-clamp-2 min-h-[2.5em] text-[0.92rem] leading-tight font-bold break-words">{title}</span>
        </a>
        <div className="mt-1 flex items-end gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-ink-soft">{meta}</p>
            <p className="truncate text-xs text-ink-soft">{formatDate(file.addedAt)}</p>
          </div>
          {more}
        </div>
        {state !== 'unread' && <ProgressLine value={file.progress ?? 0} className="mt-1.5" />}
        <div className="pointer-events-none absolute top-3.5 right-3.5 left-3.5 flex items-start justify-between">
          {selectMark || <span />}
          {file.favorite && (
            <span className="grid size-7 place-items-center rounded-full bg-surface/90 shadow-soft" title={t('library.filter.favorites')}>
              <Star className="size-4 fill-current text-[var(--cat-lire-fg)]" aria-label={t('library.filter.favorites')} />
            </span>
          )}
        </div>
      </li>
    );
  }

  return (
    <li className={cn('flex items-center gap-2 rounded-lg border bg-surface p-2 shadow-soft', selected ? 'border-accent ring-2 ring-accent/40' : 'border-line')}>
      {selectMark}
      <a
        href={href(routes.reader(file.id))}
        onClick={onClick}
        {...pressHandlers}
        aria-label={selecting ? t('library.selectFile', { name: title }) : undefined}
        aria-pressed={selecting ? selected : undefined}
        className="flex min-w-0 flex-1 touch-pan-y items-center gap-3 rounded-md select-none [-webkit-touch-callout:none]"
      >
        <Cover file={file} className="h-16 w-12 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-bold">{title}</span>
            {file.favorite && <Star className="size-3.5 shrink-0 fill-current text-[var(--cat-lire-fg)]" aria-label={t('library.filter.favorites')} />}
          </span>
          <span className="block truncate text-sm text-ink-soft">{meta} · {formatDate(file.addedAt)}</span>
          {state !== 'unread' && <ProgressLine value={file.progress ?? 0} className="mt-1.5 max-w-48" />}
        </span>
      </a>
      {more}
    </li>
  );
}
