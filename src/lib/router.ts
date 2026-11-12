// Routage par hash (#/…) : GitHub Pages ne sait pas servir les routes d'une SPA.
import { useSyncExternalStore } from 'react';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return {
    path,
    segments: path.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(queryPart),
  };
}

let cached: { hash: string; route: Route } | null = null;
function snapshot(): Route {
  const hash = location.hash;
  if (!cached || cached.hash !== hash) cached = { hash, route: parse(hash) };
  return cached.route;
}

function subscribe(l: () => void): () => void {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (options.replace) {
    history.replaceState(history.state, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

export function back(fallback = '/'): void {
  if (history.length > 1) history.back();
  else navigate(fallback);
}

export const href = (to: string) => `#${to}`;

export const routes = {
  home: '/',
  library: '/bibliotheque',
  reader: (id: string) => `/lire/${encodeURIComponent(id)}`,
  tools: '/outils',
  tool: (tool: string, fileIds: string[] = []) =>
    `/outils/${tool}${fileIds.length ? `?${fileIds.map((f) => `f=${encodeURIComponent(f)}`).join('&')}` : ''}`,
  settings: '/reglages',
  privacy: '/confidentialite',
};
