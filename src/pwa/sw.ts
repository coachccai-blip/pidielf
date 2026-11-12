/// <reference lib="webworker" />
// Service worker : application disponible hors ligne, ressources lourdes mises
// en cache au premier usage, réception des fichiers partagés (Android).
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

const SHARE_CACHE = 'pidielf-partage';

// Partage entrant : le système envoie les fichiers en POST ; on les garde
// le temps que l'application s'ouvre et les importe. Rien ne part sur le réseau.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll('files').filter((f): f is File => f instanceof File);
        const cache = await caches.open(SHARE_CACHE);
        await Promise.all(
          files.map((file, i) =>
            cache.put(
              `shared/${Date.now()}-${i}`,
              new Response(file, {
                headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
              }),
            ),
          ),
        );
      } catch {
        /* partage illisible : on ouvre simplement l'application */
      }
      return Response.redirect(`${self.registration.scope}#/?partage=1`, 303);
    })(),
  );
});

// ---- Mises à jour automatiques --------------------------------------------------
// Une nouvelle version s'installe et prend la main sans rien demander. Chaque
// fenêtre ouverte est alors prévenue : elle se recharge d'elle-même dès que
// c'est sans risque (voir register.ts). Une fenêtre qui ne répond pas tourne
// encore avec un ancien code : c'est le service worker qui la recharge.
const UPDATE_MESSAGE = 'PIDIELF_MISE_A_JOUR';
const RELOAD_PARAM = 'maj';
let isUpdate = false;

self.addEventListener('install', () => {
  // Un service worker déjà actif : il s'agit d'une mise à jour, pas d'une première visite.
  isUpdate = !!self.registration.active;
  void self.skipWaiting();
});

function acknowledged(client: Client): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 1500);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage({ type: UPDATE_MESSAGE }, [channel.port2]);
  });
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Dès la première visite, l'application est servie depuis le cache : elle fonctionne hors ligne.
      await self.clients.claim();
      if (!isUpdate) return;
      const windows = await self.clients.matchAll({ type: 'window' });
      await Promise.all(
        windows.map(async (client) => {
          if (await acknowledged(client)) return;
          // Avec le routage par hash, renaviguer vers la même adresse ne rechargerait rien :
          // un paramètre daté force un vrai chargement de la nouvelle version.
          const url = new URL(client.url);
          url.searchParams.set(RELOAD_PARAM, String(Date.now()));
          // Sans attendre : ce chargement passe par ce service worker, qui ne répond
          // qu'une fois son activation terminée. L'attendre ici le bloquerait.
          void (client as WindowClient).navigate(url.href).catch(() => undefined);
        }),
      );
    })(),
  );
});

// Compatibilité : les versions précédentes demandaient la prise en main par ce message.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

cleanupOutdatedCaches();
// Le paramètre de rechargement ne change pas la page servie depuis le cache.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, new RegExp(`^${RELOAD_PARAM}$`)] });

// Modèles OCR, tables de caractères, polices PDF, décodeur HEIC : téléchargés au premier usage, puis gardés.
registerRoute(
  ({ url }) => url.origin === self.location.origin && (url.pathname.includes('/vendor/') || url.pathname.includes('/assets/')),
  new CacheFirst({ cacheName: 'pidielf-vendor' }),
);
