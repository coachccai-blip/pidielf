// Installation, mises à jour automatiques, « Ouvrir avec » et partage entrant.
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

// ---- Mises à jour automatiques --------------------------------------------------

const UPDATE_MESSAGE = 'PIDIELF_MISE_A_JOUR';
const UPDATED_FLAG = 'pidielf:mise-a-jour';
const OFFLINE_FLAG = 'pidielf:hors-ligne';
const CHECK_EVERY = 60 * 60 * 1000;

let updatePending = false;

/** Un travail est en cours : outil ouvert, fenêtre ou tiroir affiché. Recharger le ferait perdre. */
const busy = (): boolean => location.hash.startsWith('#/outils/') || document.querySelector('[data-modal]') !== null;

/** Recharge sur la nouvelle version dès que c'est sans risque pour l'utilisateur. */
function applyUpdateWhenSafe(): void {
  if (!updatePending) return;
  if (!document.hidden && busy()) return;
  try {
    sessionStorage.setItem(UPDATED_FLAG, '1');
  } catch {
    /* le message de confirmation ne s'affichera pas, sans conséquence */
  }
  location.reload();
}

function onUpdateActivated(): void {
  if (updatePending) return;
  updatePending = true;
  if (!document.hidden && busy()) toast(t('pwa.updatePending'));
  applyUpdateWhenSafe();
  // Travail en cours : on réessaie quand l'écran change, quand l'application passe en arrière-plan, puis régulièrement.
  window.addEventListener('hashchange', applyUpdateWhenSafe);
  document.addEventListener('visibilitychange', applyUpdateWhenSafe);
  setInterval(applyUpdateWhenSafe, 5000);
}

async function registerServiceWorker(): Promise<void> {
  const container = navigator.serviceWorker;

  // Une fenêtre rechargée d'office par le service worker (ancien code) porte un paramètre daté : on le retire.
  const here = new URL(location.href);
  if (here.searchParams.has('maj')) {
    here.searchParams.delete('maj');
    history.replaceState(history.state, '', here.href);
    toast(t('pwa.updated'), { kind: 'success' });
  }
  const hadController = container.controller !== null;

  try {
    if (sessionStorage.getItem(UPDATED_FLAG)) {
      sessionStorage.removeItem(UPDATED_FLAG);
      toast(t('pwa.updated'), { kind: 'success' });
    }
  } catch {
    /* stockage de session indisponible */
  }

  // Le service worker prévient quand une nouvelle version a pris la main ; on accuse réception
  // (sans réponse, il rechargerait lui-même la fenêtre, comme pour un ancien code).
  container.addEventListener('message', (event) => {
    if ((event.data as { type?: string } | null)?.type !== UPDATE_MESSAGE) return;
    event.ports[0]?.postMessage('ok');
    onUpdateActivated();
  });
  container.addEventListener('controllerchange', () => {
    if (hadController) onUpdateActivated();
  });

  try {
    const registration = await container.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, type: 'classic' });

    if (!hadController) {
      void container.ready.then(() => {
        try {
          if (localStorage.getItem(OFFLINE_FLAG)) return;
          localStorage.setItem(OFFLINE_FLAG, '1');
        } catch {
          /* on affiche le message quand même */
        }
        toast(t('pwa.offlineReady'), { kind: 'success' });
      });
    }

    // Recherche d'une nouvelle version : au retour dans l'application, et toutes les heures
    // pour une application installée qui reste ouverte.
    let lastCheck = Date.now();
    const check = () => {
      if (!navigator.onLine || Date.now() - lastCheck < 5 * 60 * 1000) return;
      lastCheck = Date.now();
      void registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check();
    });
    setInterval(check, CHECK_EVERY);
  } catch (err) {
    console.error(err);
  }
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

  if ('serviceWorker' in navigator && import.meta.env.PROD) void registerServiceWorker();

  // « Ouvrir avec » sur bureau.
  const launchQueue = (window as { launchQueue?: { setConsumer: (c: (p: { files?: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
  launchQueue?.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    await importFiles(files, { openSingle: true });
  });

  void importSharedFiles().catch(() => undefined);
}
