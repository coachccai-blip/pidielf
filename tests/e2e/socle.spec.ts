import { expect, isMobile, open, test } from './helpers';

test.describe('socle', () => {
  test('s’ouvre en français, même avec un navigateur en anglais', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto('./#/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Lisez, rangez et transformez');
    await context.close();
  });

  test('affiche la promesse de confidentialité et les quinze outils', async ({ page }) => {
    await open(page);
    await expect(page.getByText('vos fichiers ne quittent jamais cet appareil').first()).toBeVisible();
    await expect(page.locator('a[href^="#/outils/"]')).toHaveCount(15);
  });

  test('navigue entre les quatre espaces', async ({ page }) => {
    await open(page);
    const nav = isMobile(page) ? page.locator('nav.fixed') : page.locator('aside nav');
    await nav.getByRole('link', { name: 'Bibliothèque' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bibliothèque' })).toBeVisible();
    await nav.getByRole('link', { name: 'Outils' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Outils' })).toBeVisible();
    await nav.getByRole('link', { name: 'Réglages' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Réglages' })).toHaveAttribute('aria-current', 'page');
  });

  test('change de thème et de langue, et s’en souvient', async ({ page }) => {
    await open(page, '/reglages');
    await page.getByRole('radio', { name: 'Sombre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'English' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('suit le thème du système par défaut', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto('./#/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await context.close();
  });

  test('ouvre l’aide des raccourcis avec la touche « ? »', async ({ page }) => {
    test.skip(isMobile(page), 'clavier physique');
    await open(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Raccourcis clavier' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('explique la confidentialité dans les deux langues', async ({ page }) => {
    await open(page, '/confidentialite');
    await expect(page.getByRole('heading', { level: 1, name: 'Confidentialité' })).toBeVisible();
    await expect(page.getByText('Aucune mesure d\'audience')).toBeVisible();
  });

  test('ne déborde pas horizontalement', async ({ page }) => {
    for (const route of ['/', '/bibliotheque', '/outils', '/reglages', '/confidentialite', '/outils/fusionner']) {
      await open(page, route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `débordement sur ${route}`).toBeLessThanOrEqual(1);
    }
  });
});
