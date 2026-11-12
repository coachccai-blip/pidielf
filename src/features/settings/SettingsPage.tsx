import { useEffect, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Download, Keyboard, Monitor, Moon, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import { wipeDatabase } from '@/db';
import { formatBytes, formatPercent, setLang, useT } from '@/i18n';
import { href, routes } from '@/lib/router';
import { resetSettings, updateSettings, useSettings, type Lang, type ThemeChoice } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { confirm } from '@/ui/dialogs';
import { ProgressBar, Segmented, Switch } from '@/ui/Fields';
import { toastError, toastSuccess } from '@/ui/toast';
import { Page } from '@/features/shell/Shell';
import { pickFiles } from '@/features/library/import';
import { canInstall, isIos, isStandalone, onInstallChange, promptInstall } from '@/pwa/register';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-soft md:p-5">
      <h2 className="mb-3 text-2xl">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const t = useT();
  const settings = useSettings();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [installable, setInstallable] = useState(canInstall());
  const [busy, setBusy] = useState<string | null>(null);

  const refreshStorage = () => {
    void navigator.storage?.estimate?.().then((e) => setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
    void navigator.storage?.persisted?.().then(setPersisted);
  };
  useEffect(refreshStorage, []);
  useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);

  const askPersist = async () => {
    const ok = await navigator.storage?.persist?.();
    setPersisted(!!ok);
    if (ok) toastSuccess(t('settings.persistGranted'));
    else toastError(t('settings.persistDenied'));
  };

  const exportBackup = async () => {
    setBusy('backup');
    try {
      const { exportBackup: run } = await import('./backup');
      await run();
    } catch (err) {
      console.error(err);
      toastError(t('settings.backupFailed'));
    } finally {
      setBusy(null);
    }
  };

  const restoreBackup = async () => {
    const [file] = await pickFiles({ accept: '.zip,application/zip', multiple: false });
    if (!file) return;
    setBusy('restore');
    try {
      const { restoreBackup: run } = await import('./backup');
      const count = await run(file);
      toastSuccess(t('settings.restoreDone', { count }));
      refreshStorage();
    } catch (err) {
      console.error(err);
      toastError(t('settings.restoreFailed'));
    } finally {
      setBusy(null);
    }
  };

  const eraseAll = async () => {
    const ok = await confirm({
      title: t('settings.eraseTitle'),
      message: t('settings.eraseText'),
      confirmLabel: t('settings.eraseConfirm'),
      danger: true,
    });
    if (!ok) return;
    await wipeDatabase();
    resetSettings();
    await setLang('fr');
    if ('caches' in window) await caches.delete('pidielf-partage');
    refreshStorage();
    toastSuccess(t('settings.eraseDone'));
  };

  return (
    <Page title={t('settings.title')}>
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <Section title={t('settings.appearance')}>
          <div>
            <p className="mb-1.5 text-sm font-bold">{t('settings.theme')}</p>
            <Segmented<ThemeChoice>
              label={t('settings.theme')}
              value={settings.theme}
              onChange={(theme) => updateSettings({ theme })}
              options={[
                { value: 'auto', label: t('settings.themeAuto'), icon: <Monitor /> },
                { value: 'light', label: t('settings.themeLight'), icon: <Sun /> },
                { value: 'dark', label: t('settings.themeDark'), icon: <Moon /> },
              ]}
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-bold">{t('settings.language')}</p>
            <Segmented<Lang>
              label={t('settings.language')}
              value={settings.lang}
              onChange={(lang) => void setLang(lang)}
              options={[
                { value: 'fr', label: 'Français' },
                { value: 'en', label: 'English' },
              ]}
            />
          </div>
        </Section>

        <Section title={t('settings.library')}>
          <Switch
            label={t('settings.saveToLibrary')}
            hint={t('settings.saveToLibraryHint')}
            checked={settings.saveToLibrary}
            onChange={(saveToLibrary) => updateSettings({ saveToLibrary })}
          />
        </Section>

        <Section title={t('settings.storage')}>
          {estimate && estimate.quota > 0 ? (
            <div>
              <ProgressBar value={estimate.usage / estimate.quota} label={t('settings.storageUsed')} />
              <p className="mt-2 text-sm text-ink-soft">
                {t('settings.storageGauge', {
                  used: formatBytes(estimate.usage),
                  free: formatBytes(Math.max(0, estimate.quota - estimate.usage)),
                  pct: formatPercent(estimate.usage / estimate.quota, 1),
                })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">{t('settings.storageUnknown')}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-soft">
              {persisted ? t('settings.persistOn') : t('settings.persistOff')}
            </p>
            {persisted === false && !!navigator.storage?.persist && (
              <Button size="sm" onClick={askPersist}>{t('settings.persistAsk')}</Button>
            )}
          </div>
          <div className="border-t border-line pt-4">
            <h3 className="font-sans text-base font-bold">{t('settings.backup')}</h3>
            <p className="mt-1 text-sm text-ink-soft">{t('settings.backupHint')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={<Archive />} onClick={exportBackup} disabled={busy !== null}>
                {busy === 'backup' ? t('common.working') : t('settings.backupExport')}
              </Button>
              <Button icon={<ArchiveRestore />} onClick={restoreBackup} disabled={busy !== null}>
                {busy === 'restore' ? t('common.working') : t('settings.backupRestore')}
              </Button>
            </div>
          </div>
        </Section>

        <Section title={t('settings.app')}>
          {isStandalone() ? (
            <p className="text-sm text-ink-soft">{t('settings.installed')}</p>
          ) : installable ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm text-ink-soft">{t('pwa.installText')}</p>
              <Button variant="primary" icon={<Download />} onClick={() => void promptInstall()}>{t('pwa.install')}</Button>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">{isIos() ? t('settings.installIos') : t('settings.installHint')}</p>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button icon={<Keyboard />} onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}>
              {t('help.title')}
            </Button>
          </div>
          <p className="text-xs text-ink-soft">PidiElf {__APP_VERSION__} · {t('settings.license')}</p>
        </Section>

        <Section title={t('settings.privacy')}>
          <p className="flex items-start gap-2 text-ink-soft">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
            <span>
              {t('common.promise')}{' '}
              <a href={href(routes.privacy)} className="font-bold text-accent underline underline-offset-2">{t('settings.privacyLink')}</a>
            </span>
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="min-w-0 flex-1 text-sm text-ink-soft">{t('settings.eraseHint')}</p>
            <Button variant="danger" icon={<Trash2 />} onClick={eraseAll}>{t('settings.erase')}</Button>
          </div>
        </Section>
      </div>
    </Page>
  );
}
