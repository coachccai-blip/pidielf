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
});
