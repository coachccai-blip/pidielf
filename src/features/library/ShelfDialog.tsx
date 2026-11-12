import { useLiveQuery } from 'dexie-react-hooks';
import { FolderPlus } from 'lucide-react';
import { db } from '@/db';
import { createShelf, setShelves } from '@/db/files';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { prompt } from '@/ui/dialogs';
import { Dialog } from '@/ui/Overlay';

/** Range un ou plusieurs fichiers sur des étagères (collections libres). */
export function ShelfDialog({ fileIds, onClose }: { fileIds: string[] | null; onClose: () => void }) {
  const t = useT();
  const shelves = useLiveQuery(() => db.shelves.orderBy('name').toArray(), []) ?? [];
  const files = useLiveQuery(() => (fileIds ? db.files.bulkGet(fileIds) : []), [fileIds?.join(',')]) ?? [];
  const ids = fileIds ?? [];

  const create = async () => {
    const name = await prompt({ title: t('library.newShelf'), label: t('library.shelfName'), confirmLabel: t('common.create') });
    if (!name?.trim()) return;
    const id = await createShelf(name.trim());
    await setShelves(ids, id, true);
  };

  return (
    <Dialog
      open={!!fileIds}
      onClose={onClose}
      size="sm"
      title={t('library.shelves')}
      footer={<Button variant="primary" onClick={onClose}>{t('common.done')}</Button>}
    >
      <p className="mb-3 text-sm text-ink-soft">{t('library.shelvesHint', { count: ids.length })}</p>
      <ul className="flex flex-col">
        {shelves.map((s) => {
          const members = files.filter((f) => f?.shelves.includes(s.id)).length;
          const all = members === ids.length && ids.length > 0;
          return (
            <li key={s.id}>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = members > 0 && !all;
                  }}
                  onChange={(e) => void setShelves(ids, s.id, e.target.checked)}
                />
                <span className="font-semibold">{s.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {shelves.length === 0 && <p className="mb-2 text-ink-soft">{t('library.noShelf')}</p>}
      <Button icon={<FolderPlus />} className="mt-2" onClick={create}>{t('library.newShelf')}</Button>
    </Dialog>
  );
}
