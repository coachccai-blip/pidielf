// Installation, mise à jour, « Ouvrir avec » et partage entrant.
import { registerSW } from 'virtual:pwa-register';
import { t } from '@/i18n';
import { toast } from '@/ui/toast';
import { importFiles } from '@/features/library/import';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export const canInstall = (): boolean => installEvent !== null;
export const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export const isIos = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function onInstallChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  const event = installEvent;
  await event.prompt();
  const { outcome } = await event.userChoice;
  installEvent = null;
  listeners.forEach((l) => l());
  return outcome === 'accepted';
}

const SHARE_CACHE = 'pidielf-partage';

/** Récupère les fichiers reçus par le partage du système (voir sw.ts). */
async function importSharedFiles(): Promise<void> {
  if (!('caches' in window)) return;
  const cache = await caches.open(SHARE_CACHE);
  const requests = await cache.keys();
  if (requests.length === 0) return;
  const files: File[] = [];
  for (const request of requests) {
    const response = await cache.match(request);
    if (response) {
      const name = decodeURIComponent(response.headers.get('X-File-Name') ?? 'document.pdf');
      const blob = await response.blob();
      files.push(new File([blob], name, { type: blob.type }));
    }
    await cache.delete(request);
  }
  if (files.length) await importFiles(files, { openSingle: true });
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    listeners.forEach((l) => l());
  });

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const update = registerSW({
      onNeedRefresh() {
        toast(t('pwa.updateReady'), { sticky: true, action: { label: t('pwa.reload'), onClick: () => void update(true) } });
      },
      onOfflineReady() {
        toast(t('pwa.offlineReady'), { kind: 'success' });
      },
    });
  }

  // « Ouvrir avec » sur bureau.
  const launchQueue = (window as { launchQueue?: { setConsumer: (c: (p: { files?: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
  launchQueue?.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    await importFiles(files, { openSingle: true });
  });

  void importSharedFiles().catch(() => undefined);
}
