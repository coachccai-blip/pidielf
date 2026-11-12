import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './helpers';

// Ces tests ont besoin du service worker : ils ne tournent que sur la version construite.
test.describe('application installable et hors ligne', () => {
  test.skip(!!process.env.PIDIELF_URL, 'le service worker n’existe pas en développement');

  test('manifeste complet', async ({ page, request }) => {
    await page.goto('./#/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await request.get(new URL(href!, page.url()).toString())).json();
    expect(manifest.name).toBe('PidiElf');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('fr');
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.share_target.method).toBe('POST');
    expect(manifest.file_handlers[0].accept['application/pdf']).toContain('.pdf');
    // Tout est relatif au sous-dossier du dépôt.
    expect(manifest.scope).toBe(new URL('./', page.url()).pathname);
  });

  test('fonctionne hors ligne après la première visite', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto('./#/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
    await expect(page.getByText('PidiElf est prête à fonctionner hors ligne.')).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lisez, rangez et transformez');
    // Les écrans chargés à la demande viennent eux aussi du cache.
    await page.goto('./#/reglages');
    await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    await page.goto('./#/outils/pivoter');
    await expect(page.getByRole('button', { name: "Depuis l'appareil" })).toBeVisible();
    await context.close();
  });

  // Les tests de mise à jour publient une « nouvelle version » en modifiant le service worker
  // construit, puis le remettent en l'état : ils tournent l'un après l'autre.
  test.describe('mises à jour automatiques', () => {
    test.describe.configure({ mode: 'serial' });
    // Un seul projet touche au fichier construit : pas de course entre mobile et bureau.
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 700, 'vérifié sur le projet bureau');
    const swFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'sw.js');
    let original = '';

    test.beforeEach(async () => {
      original = (await readFile(swFile, 'utf8')).replace(/\n\/\/ version de test \d+\n/g, '');
    });
    test.afterEach(async () => {
      await writeFile(swFile, original);
    });

    const publish = async (page: Page) => {
      await writeFile(swFile, `${original}\n// version de test ${Date.now()}\n`);
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())!.update();
      });
    };
    const start = async (browser: Browser, route: string) => {
      const context = await browser.newContext({ serviceWorkers: 'allow' });
      const page = await context.newPage();
      await page.goto(`./#${route}`);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
      await expect(page.getByText('PidiElf est prête à fonctionner hors ligne.')).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => ((window as { marque?: boolean }).marque = true));
      return { context, page };
    };
    const reloaded = (page: Page) => page.waitForFunction(() => !(window as { marque?: boolean }).marque, undefined, { timeout: 30_000 });

    test('une nouvelle version s’applique seule, sans rien demander', async ({ browser }) => {
      const { context, page } = await start(browser, '/bibliotheque');
      await publish(page);
      await reloaded(page);
      await expect(page.getByText('PidiElf a été mise à jour.')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Bibliothèque' })).toBeVisible();
      await context.close();
    });

    test('pendant un travail dans un outil, la mise à jour attend qu’on en sorte', async ({ browser }) => {
      const { context, page } = await start(browser, '/outils/pivoter');
      await publish(page);
      await expect(page.getByText(/Une mise à jour est prête/)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => (window as { marque?: boolean }).marque)).toBe(true); // pas de rechargement en plein travail

      await page.evaluate(() => (location.hash = '#/outils'));
      await reloaded(page);
      await expect(page.getByText('PidiElf a été mise à jour.')).toBeVisible();
      await context.close();
    });

    test('une fenêtre restée sur un ancien code est rechargée par le service worker', async ({ browser }) => {
      const context = await browser.newContext({ serviceWorkers: 'allow' });
      const page = await context.newPage();
      // Simule l'ancien code, qui ne connaît pas le message de mise à jour : il ne répond pas.
      await page.addInitScript(() => {
        navigator.serviceWorker.addEventListener('message', (e) => e.stopImmediatePropagation());
        navigator.serviceWorker.addEventListener('controllerchange', (e) => e.stopImmediatePropagation());
      });
      await page.goto('./#/reglages');
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
      await page.evaluate(() => ((window as { marque?: boolean }).marque = true));
      await publish(page);
      await reloaded(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
      await expect(page.getByText('PidiElf a été mise à jour.')).toBeVisible();
      await expect(page).toHaveURL(/\/#\/reglages$/); // le paramètre de rechargement a été retiré
      await context.close();
    });
  });
});
