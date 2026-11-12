import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ShieldCheck, Upload } from 'lucide-react';
import { db, type FileRecord } from '@/db';
import { formatRelative, useT } from '@/i18n';
import { href, routes } from '@/lib/router';
import { Button } from '@/ui/Button';
import { Mascot, Wordmark } from '@/ui/Brand';
import { Cover } from '@/features/library/Cover';
import { importFiles, pickFiles } from '@/features/library/import';
import { ToolGrid } from '@/features/tools/ToolCard';

const COUNT_HINT = 'pidielf:nombre-de-fichiers';

export default function HomePage() {
  const t = useT();
  const reading = useLiveQuery(
    () => db.files.orderBy('openedAt').reverse().filter((f) => !!f.openedAt && (f.progress ?? 0) < 0.999).limit(8).toArray(),
    [],
  );
  const recent = useLiveQuery(() => db.files.orderBy('addedAt').reverse().limit(8).toArray(), []);

  // La bibliothèque se lit de façon asynchrone : on réserve la place de ce qui va
  // s'afficher (d'après la dernière visite) pour que la page ne saute pas.
  const [hint] = useState(() => {
    try {
      return Number(localStorage.getItem(COUNT_HINT) ?? 0);
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    if (!recent) return;
    try {
      localStorage.setItem(COUNT_HINT, String(recent.length));
    } catch {
      /* stockage indisponible : simple confort d'affichage */
    }
  }, [recent]);
  const empty = recent ? recent.length === 0 : hint === 0;

  const chooseFiles = async () => {
    const files = await pickFiles({ accept: 'application/pdf,.pdf,image/*', multiple: true });
    if (files.length) await importFiles(files, { openSingle: true });
  };

  return (
    <div>
      <header className="elf-pattern border-b border-line bg-surface pt-[var(--safe-top)]">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:px-6 md:grid-cols-[1fr_auto] md:items-center md:py-9">
          <div>
            <Wordmark className="md:hidden" />
            <h1 className="mt-3 text-[2.1rem] md:mt-0 md:text-5xl">{t('home.title')}</h1>
            <p className="mt-2 max-w-xl text-ink-soft md:text-lg">{t('home.subtitle')}</p>
            <p className="mt-4 inline-flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>
                {t('common.promise')}{' '}
                <a href={href(routes.privacy)} className="font-bold text-accent underline underline-offset-2">
                  {t('common.learnMore')}
                </a>
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={chooseFiles}
            className="group flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-accent/50 bg-page p-4 text-left transition-colors duration-150 hover:border-accent hover:bg-accent-soft md:w-80 md:flex-col md:p-7 md:text-center"
          >
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-accent text-accent-ink shadow-soft">
              <Upload className="size-6" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-display text-2xl font-semibold">{t('home.import')}</span>
              <span className="block text-sm text-ink-soft">{t('home.importHint')}</span>
            </span>
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-9 px-4 py-6 sm:px-6 md:py-8">
        {reading && reading.length > 0 && (
          <section aria-labelledby="h-reprendre">
            <h2 id="h-reprendre" className="mb-3 text-3xl">{t('home.continue')}</h2>
            <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
              {reading.map((f) => (
                <ContinueCard key={f.id} file={f} />
              ))}
            </div>
          </section>
        )}

        {recent && recent.length > 0 && (
          <section aria-labelledby="h-recents">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 id="h-recents" className="text-3xl">{t('home.recent')}</h2>
              <a href={href(routes.library)} className="inline-flex min-h-11 items-center gap-1 font-bold text-accent">
                {t('home.seeAll')} <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recent.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <a
                    href={href(routes.reader(f.id))}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5 shadow-soft transition-transform duration-150 hover:-translate-y-0.5"
                  >
                    <Cover file={f} className="h-16 w-12 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{f.name}</span>
                      <span className="block truncate text-sm text-ink-soft">
                        {f.pageCount > 0 ? t('common.pages', { count: f.pageCount }) : t('library.protected')} · {formatRelative(f.addedAt)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!recent && hint > 0 && <div aria-hidden="true" style={{ minHeight: 60 + Math.min(6, hint) * 94 }} />}

        {empty && (
          <section className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-soft md:p-6">
            <Mascot mood="reading" className="h-24 w-auto shrink-0 md:h-28" />
            <div>
              <h2 className="text-2xl">{t('home.emptyTitle')}</h2>
              <p className="mt-1 text-ink-soft">{t('home.emptyText')}</p>
              <Button variant="primary" className="mt-3" icon={<Upload />} onClick={chooseFiles}>
                {t('home.import')}
              </Button>
            </div>
          </section>
        )}

        <section aria-labelledby="h-outils">
          <h2 id="h-outils" className="mb-4 text-3xl">{t('home.tools')}</h2>
          <ToolGrid />
        </section>
      </div>
    </div>
  );
}

function ContinueCard({ file }: { file: FileRecord }) {
  const t = useT();
  const pct = Math.round((file.progress ?? 0) * 100);
  return (
    <a
      href={href(routes.reader(file.id))}
      data-cat="lire"
      className="flex w-[17rem] shrink-0 snap-start gap-3 rounded-lg border border-cat-ink/10 bg-cat p-3 text-cat-ink shadow-soft transition-transform duration-150 hover:-translate-y-0.5"
    >
      <Cover file={file} className="h-28 w-20 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 leading-tight font-bold">{file.name.replace(/\.pdf$/i, '')}</span>
        <span className="mt-1 text-sm">
          {t('home.pageOf', { page: file.page ?? 1, total: file.pageCount })}
        </span>
        <span className="mt-auto">
          <span className="mb-1 block text-xs font-bold tabular-nums">{pct}&nbsp;%</span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-surface/60" role="progressbar" aria-label={t('library.progress')} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full rounded-full bg-cat-ink" style={{ width: `${pct}%` }} />
          </span>
        </span>
      </span>
    </a>
  );
}
