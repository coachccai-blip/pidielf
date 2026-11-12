/// <reference lib="webworker" />
// Service worker : application disponible hors ligne, ressources lourdes mises
// en cache au premier usage, réception des fichiers partagés (Android).
import { clientsClaim } from 'workbox-core';
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

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// Dès la première visite, l'application est servie depuis le cache : elle fonctionne hors ligne.
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Modèles OCR, tables de caractères, polices PDF, décodeur HEIC : téléchargés au premier usage, puis gardés.
registerRoute(
  ({ url }) => url.origin === self.location.origin && (url.pathname.includes('/vendor/') || url.pathname.includes('/assets/')),
  new CacheFirst({ cacheName: 'pidielf-vendor' }),
);
