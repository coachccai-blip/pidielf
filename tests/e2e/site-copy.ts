// Sert une copie de la version construite, sur un port libre. Les tests de mise à
// jour « publient » une nouvelle version en modifiant cette copie : le dossier
// dist, lui, n'est jamais touché (c'est lui qui part en ligne).
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const base = process.env.BASE_PATH ?? '/pidielf/';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface SiteCopy {
  /** Adresse de l'application (se termine par le chemin de base). */
  url: string;
  /** Publie une « nouvelle version » : le service worker servi change d'un octet. */
  publish: () => Promise<void>;
  close: () => Promise<void>;
}

export async function serveSiteCopy(): Promise<SiteCopy> {
  const root = await mkdtemp(join(tmpdir(), 'pidielf-copie-'));
  // Le moteur et les modèles OCR ne sont pas mis en cache à l'installation : inutile de les copier.
  await cp(dist, root, { recursive: true, filter: (source) => !source.includes(`${sep}vendor${sep}tesseract`) });
  const swFile = join(root, 'sw.js');
  const original = await readFile(swFile, 'utf8');
  if (!original.includes('precache')) throw new Error('dist/sw.js est vide ou incomplet : relancez « npm run build ».');

  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (!path.startsWith(base)) {
        response.writeHead(404).end();
        return;
      }
      let file = normalize(join(root, path.slice(base.length)));
      if (!file.startsWith(root)) {
        response.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  let version = 0;
  return {
    url: `http://localhost:${port}${base}`,
    publish: () => writeFile(swFile, `${original}\n// version de test ${++version}\n`),
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}
