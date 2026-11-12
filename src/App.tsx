import { lazy, Suspense, useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useRoute } from '@/lib/router';
import { DialogHost } from '@/ui/dialogs';
import { Spinner } from '@/ui/Fields';
import { Toaster } from '@/ui/toast';
import { Shell } from '@/features/shell/Shell';
import { ShortcutsHelp } from '@/features/shell/ShortcutsHelp';
import { InstallBanner } from '@/pwa/InstallBanner';
import HomePage from '@/features/home/HomePage';
import LibraryPage from '@/features/library/LibraryPage';
import ToolsPage from '@/features/tools/ToolsPage';

// Seuls l'accueil et la bibliothèque sont dans le lot initial.
const ReaderPage = lazy(() => import('@/features/reader/ReaderPage'));
const ToolPage = lazy(() => import('@/features/tools/ToolPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const PrivacyPage = lazy(() => import('@/features/settings/PrivacyPage'));

function Loading() {
  const t = useT();
  return (
    <div className="grid min-h-[60dvh] place-items-center" role="status">
      <span className="flex items-center gap-3 text-ink-soft">
        <Spinner /> {t('common.loading')}
      </span>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [help, setHelp] = useState(false);
  const [a, b] = route.segments;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey) setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Chaque écran repart du haut, sauf le lecteur qui gère sa position.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path]);

  let page;
  let bare = false;
  if (!a) page = <HomePage />;
  else if (a === 'bibliotheque') page = <LibraryPage />;
  else if (a === 'lire' && b) {
    bare = true;
    page = <ReaderPage key={b} fileId={b} />;
  } else if (a === 'outils' && b) page = <ToolPage key={b} toolId={b} fileIds={route.query.getAll('f')} />;
  else if (a === 'outils') page = <ToolsPage fileIds={route.query.getAll('f')} />;
  else if (a === 'reglages') page = <SettingsPage />;
  else if (a === 'confidentialite') page = <PrivacyPage />;
  else page = <HomePage />;

  return (
    <>
      <Shell bare={bare}>
        <Suspense fallback={<Loading />}>{page}</Suspense>
      </Shell>
      {!bare && <InstallBanner />}
      <Toaster />
      <DialogHost />
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
    </>
  );
}
