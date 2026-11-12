import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// Sur GitHub Pages, l'application vit dans un sous-dossier portant le nom du dépôt.
// BASE_PATH permet de changer ce chemin (fork, domaine personnalisé) sans toucher au code.
const base = process.env.BASE_PATH ?? '/pidielf/';

export default defineConfig({
  base,
  // Permet de lancer plusieurs serveurs de développement en parallèle sans partager le cache.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // L'enregistrement et les mises à jour automatiques sont gérés par src/pwa/register.ts.
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        id: base,
        name: 'PidiElf',
        short_name: 'PidiElf',
        description: 'Lecteur PDF, bibliothèque et boîte à outils PDF. Tout se passe dans votre navigateur.',
        lang: 'fr',
        dir: 'ltr',
        start_url: `${base}#/`,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#FAF8F3',
        theme_color: '#FAF8F3',
        categories: ['productivity', 'utilities', 'books'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Bibliothèque', url: `${base}#/bibliotheque` },
          { name: 'Outils', url: `${base}#/outils` },
        ],
        // « Ouvrir avec » sur bureau (Chromium).
        file_handlers: [{ action: base, accept: { 'application/pdf': ['.pdf'] } }],
        // Réception des PDF partagés depuis une autre application (Android).
        share_target: {
          action: `${base}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'files', accept: ['application/pdf', '.pdf', 'image/*'] }] },
        },
      } as never,
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm,mjs}'],
        // Les gros fichiers (modèles OCR, moteurs WebAssembly) sont mis en cache au premier usage.
        globIgnores: ['vendor/tesseract/**', 'vendor/pdfjs/cmaps/**', '**/heic-to-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
