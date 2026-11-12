import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Lock } from 'lucide-react';
import { db, type FileRecord } from '@/db';
import { cn } from '@/ui/cn';

/** Couverture d'un fichier : miniature de la première page. */
export function Cover({ file, className }: { file: FileRecord; className?: string }) {
  const record = useLiveQuery(() => db.covers.get(file.id), [file.id]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!record?.blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(record.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [record]);

  return (
    <div className={cn('relative overflow-hidden rounded-md border border-line bg-surface-2', className)}>
      {url ? (
        <img src={url} alt="" className="size-full object-cover object-top" loading="lazy" draggable={false} />
      ) : (
        <div data-cat="lire" className="elf-pattern grid size-full place-items-center bg-cat text-cat-ink">
          {file.encrypted ? <Lock className="size-8 opacity-70" aria-hidden="true" /> : <FileText className="size-8 opacity-70" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
