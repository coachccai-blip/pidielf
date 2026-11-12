// Régénère les captures d'écran du README à partir de la version construite :
//   npm run build && npx vite preview --port 4173 &   puis   node scripts/screenshots.mjs
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.PIDIELF_URL ?? 'http://localhost:4173/pidielf/';
const fixture = (name) => join(root, 'tests/fixtures', name);
const out = (name) => join(root, 'docs/screenshots', name);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

async function session(options, run) {
  const context = await browser.newContext({ serviceWorkers: 'block', deviceScaleFactor: 2, ...options });
  const page = await context.newPage();
  await page.goto(`${base}#/bibliotheque`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Importer/ }).first().click();
  await (await chooser).setFiles([fixture('outline.pdf'), fixture('sample-12p.pdf'), fixture('scan.pdf')]);
  await page.getByText('3 fichiers', { exact: true }).waitFor();
  // Le message de confirmation ne doit pas apparaître sur les captures.
  await page.locator('[role="status"] button[aria-label="Fermer"]').first().click().catch(() => undefined);
  await run(page);
  await context.close();
}

// Accueil sur téléphone, avec une lecture en cours.
await session({ viewport: { width: 390, height: 844 }, hasTouch: true }, async (page) => {
  await page.getByRole('link', { name: /outline/ }).first().click();
  await page.locator('[data-page="1"] canvas').waitFor();
  await page.getByRole('slider').fill('3');
  await page.waitForTimeout(700);
  await page.goto(`${base}#/`);
  await page.getByRole('heading', { name: 'Reprendre la lecture' }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('accueil-mobile.png') });
});

// Lecteur sur bureau, papier sépia, avec un surlignage.
await session({ viewport: { width: 1280, height: 800 } }, async (page) => {
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('pidielf:settings') ?? '{}');
    localStorage.setItem('pidielf:settings', JSON.stringify({ ...settings, reader: { ...(settings.reader ?? {}), paper: 'sepia' } }));
  });
  await page.reload();
  await page.getByRole('link', { name: /sample-12p/ }).first().click();
  await page.locator('[data-page="1"] .textLayer span').first().waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const span = [...document.querySelectorAll('[data-page="1"] .textLayer span')].find((s) => s.textContent?.includes('Chaque feuille'));
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.getByRole('button', { name: 'Surligner en jaune' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('lecteur-bureau.png') });
});

// Grille des outils en mode sombre.
await session({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' }, async (page) => {
  await page.goto(`${base}#/outils`);
  await page.getByRole('heading', { level: 1, name: 'Outils' }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('outils-sombre.png') });
});

await browser.close();
console.log('Captures enregistrées dans docs/screenshots.');
