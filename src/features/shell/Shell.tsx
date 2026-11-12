// Coquille de l'application : barre latérale (bureau), onglets bas (mobile),
// glisser-déposer global.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Home, Library, Wrench, Settings as SettingsIcon, PanelLeftClose, PanelLeftOpen, ShieldCheck, Upload } from 'lucide-react';
import { useT } from '@/i18n';
import { href, routes, useRoute } from '@/lib/router';
import { updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/ui/cn';
import { Logo, Wordmark } from '@/ui/Brand';
import { importFiles } from '@/features/library/import';

const entries = [
  { to: routes.home, key: 'nav.home', icon: Home, match: (p: string) => p === '/' },
  { to: routes.library, key: 'nav.library', icon: Library, match: (p: string) => p.startsWith('/bibliotheque') },
  { to: routes.tools, key: 'nav.tools', icon: Wrench, match: (p: string) => p.startsWith('/outils') },
  { to: routes.settings, key: 'nav.settings', icon: SettingsIcon, match: (p: string) => p.startsWith('/reglages') || p.startsWith('/confidentialite') },
];

export function Shell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const t = useT();
  const route = useRoute();
  const { sidebarCollapsed: collapsed } = useSettings();
  const dragging = useGlobalDrop();

  return (
    <div className="flex min-h-dvh">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
      >
        {t('nav.skip')}
      </a>

      {!bare && (
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface py-4 transition-[width] duration-200 md:flex',
            collapsed ? 'w-[4.5rem] items-center px-2' : 'w-60 px-3',
          )}
        >
          <a href={href(routes.home)} className={cn('mb-6 flex items-center rounded-md', collapsed ? 'justify-center' : 'px-2')} aria-label="PidiElf">
            {collapsed ? <Logo className="size-9" /> : <Wordmark />}
          </a>
          <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-1">
            {entries.map((e) => {
              const active = e.match(route.path);
              return (
                <a
                  key={e.to}
                  href={href(e.to)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? t(e.key) : undefined}
                  title={collapsed ? t(e.key) : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-md font-semibold transition-colors duration-150',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    active ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <e.icon className="size-5 shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{t(e.key)}</span>}
                </a>
              );
            })}
          </nav>
          {!collapsed && (
            <a
              href={href(routes.privacy)}
              className="mb-2 flex items-start gap-2 rounded-md bg-accent-soft px-3 py-2.5 text-[0.8rem] leading-snug text-ink hover:brightness-95"
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>{t('common.promiseShort')}</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => updateSettings({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
            className={cn('flex min-h-11 items-center gap-3 rounded-md text-ink-soft hover:bg-surface-2', collapsed ? 'justify-center' : 'px-3')}
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
            {!collapsed && <span className="text-sm font-semibold">{t('nav.collapse')}</span>}
          </button>
        </aside>
      )}

      <main id="contenu" tabIndex={-1} className={cn('min-w-0 flex-1 outline-none', !bare && 'pb-[calc(4.5rem+var(--safe-bottom))] md:pb-0')}>
        {children}
      </main>

      {!bare && (
        <nav
          aria-label={t('nav.main')}
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[var(--safe-bottom)] backdrop-blur md:hidden"
        >
          {entries.map((e) => {
            const active = e.match(route.path);
            return (
              <a
                key={e.to}
                href={href(e.to)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[4.25rem] flex-1 flex-col items-center justify-center gap-0.5 text-[0.72rem] font-bold',
                  active ? 'text-accent' : 'text-ink-soft',
                )}
              >
                <span className={cn('grid h-8 w-14 place-items-center rounded-full transition-colors duration-150', active && 'bg-accent-soft')}>
                  <e.icon className="size-[1.35rem]" aria-hidden="true" />
                </span>
                {t(e.key)}
              </a>
            );
          })}
        </nav>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-overlay p-6" aria-hidden="true">
          <div className="flex animate-rise flex-col items-center gap-3 rounded-xl border-2 border-dashed border-accent bg-surface px-10 py-9 text-center shadow-lift">
            <Upload className="size-10 text-accent" />
            <p className="font-display text-2xl font-semibold">{t('home.dropHere')}</p>
            <p className="text-sm text-ink-soft">{t('common.promiseShort')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Glisser-déposer un fichier n'importe où dans la fenêtre l'importe. */
function useGlobalDrop(): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    // Un écran peut gérer lui-même le dépôt (zone marquée data-dropzone).
    const local = (e: DragEvent) => (e.target as HTMLElement | null)?.closest?.('[data-dropzone]');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (local(e)) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void importFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return dragging;
}

/** En-tête et conteneur communs aux écrans. */
export function Page({
  title,
  subtitle,
  actions,
  cat,
  icon,
  back,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  cat?: string;
  icon?: ReactNode;
  back?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div data-cat={cat} className="min-h-full">
      <header className={cn('elf-pattern border-b border-line pt-[var(--safe-top)]', cat ? 'bg-cat' : 'bg-surface')}>
        <div className={cn('mx-auto flex items-center gap-3 px-4 py-4 sm:px-6 md:py-6', wide ? 'max-w-[90rem]' : 'max-w-6xl')}>
          {back}
          {icon && (
            <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface/70 text-cat-ink [&>svg]:size-6" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className={cn('truncate text-[1.9rem] md:text-4xl', cat && 'text-cat-ink')}>{title}</h1>
            {subtitle && <p className={cn('mt-0.5 text-sm md:text-base', cat ? 'text-cat-ink/90' : 'text-ink-soft')}>{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      </header>
      <div className={cn('mx-auto px-4 py-5 sm:px-6 md:py-7', wide ? 'max-w-[90rem]' : 'max-w-6xl')}>{children}</div>
    </div>
  );
}
