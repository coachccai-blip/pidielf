import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useT } from '@/i18n';
import { updateSettings, useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Logo } from '@/ui/Brand';
import { canInstall, isStandalone, onInstallChange, promptInstall } from './register';

/** Invitation discrète à installer l'application : après un premier usage réussi, jamais à l'arrivée. */
export function InstallBanner() {
  const t = useT();
  const settings = useSettings();
  const [available, setAvailable] = useState(canInstall());
  useEffect(() => onInstallChange(() => setAvailable(canInstall())), []);

  if (!available || !settings.firstSuccess || settings.installDismissed || isStandalone()) return null;
  return (
    <aside
      aria-label={t('pwa.installTitle')}
      className="fixed inset-x-3 bottom-[calc(5.25rem+var(--safe-bottom))] z-30 mx-auto flex max-w-md animate-rise items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-lift md:right-6 md:bottom-6 md:left-auto md:mx-0"
    >
      <Logo className="size-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="leading-tight font-bold">{t('pwa.installTitle')}</p>
        <p className="text-sm text-ink-soft">{t('pwa.installText')}</p>
      </div>
      <Button variant="primary" size="sm" icon={<Download />} onClick={() => void promptInstall()}>
        {t('pwa.install')}
      </Button>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={() => updateSettings({ installDismissed: true })}
        className="grid size-9 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-surface-2"
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}
