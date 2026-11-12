import { defineConfig, devices } from '@playwright/test';

const base = process.env.BASE_PATH ?? '/pidielf/';
const port = 4173;
// PIDIELF_URL permet de viser un serveur déjà lancé (développement).
const external = process.env.PIDIELF_URL;

// Tests de parcours sur la version construite, en mobile et sur bureau.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: external ?? `http://localhost:${port}${base}`,
    trace: 'off',
    locale: 'fr-FR',
    serviceWorkers: 'block',
    // Animations coupées : les contrôles de contraste ne tombent pas sur un fondu en cours.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: external
    ? undefined
    : {
        command: `npx vite preview --port ${port} --strictPort`,
        url: `http://localhost:${port}${base}`,
        reuseExistingServer: !process.env.CI,
      },
});
