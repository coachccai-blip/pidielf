// Contrôle automatique d'accessibilité (axe-core) sur les écrans principaux,
// en clair et en sombre. Niveau visé : WCAG 2.1 AA.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { chooseFiles, expect, importToLibrary, open, test } from './helpers';

async function violations(page: Page, label: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.map((v) => `${label} — ${v.id} (${v.impact}) : ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

async function audit(page: Page, label: string): Promise<void> {
  expect(await violations(page, label)).toEqual([]);
}

const TOOLS: Array<[string, string[]]> = [
  ['fusionner', ['sample-3p.pdf', 'rotated.pdf']],
  ['diviser', ['outline.pdf']],
  ['organiser', ['sample-3p.pdf']],
  ['pivoter', ['sample-3p.pdf']],
  ['compresser', ['heavy-image.pdf']],
  ['ocr', ['scan.pdf']],
  ['pdf-en-images', ['sample-3p.pdf']],
  ['images-en-pdf', ['photo.png', 'photo.jpg']],
  ['scanner', ['scan.jpg']],
  ['editer', ['sample-3p.pdf']],
  ['filigrane', ['sample-3p.pdf']],
  ['numeros', ['sample-3p.pdf']],
  ['signer', ['sample-3p.pdf']],
  ['proteger', ['sample-3p.pdf']],
  ['deverrouiller', ['protected.pdf']],
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibilité — thème ${theme === 'light' ? 'clair' : 'sombre'}`, () => {
    test.use({ colorScheme: theme });

    test('accueil, outils, réglages, confidentialité', async ({ page }) => {
      for (const route of ['/', '/outils', '/reglages', '/confidentialite']) {
        await open(page, route);
        await audit(page, route);
      }
    });

    test('bibliothèque avec des fichiers, menu et fiche', async ({ page }) => {
      await importToLibrary(page, 'sample-3p.pdf', 'sample-12p.pdf');
      await audit(page, 'bibliothèque');
      await page.getByRole('button', { name: 'Actions pour sample-3p' }).click();
      await audit(page, 'menu contextuel');
      await page.getByRole('menuitem', { name: 'Détails' }).click();
      await expect(page.getByRole('dialog', { name: 'Détails' })).toBeVisible();
      await audit(page, 'fiche du fichier');
    });

    test('outil : choisir, régler, récupérer', async ({ page }) => {
      await open(page, '/outils/pivoter');
      await audit(page, 'outil — choisir');
      await chooseFiles(page, 'pivoter', 'sample-3p.pdf');
      await expect(page.getByRole('button', { name: 'Page 3' })).toBeVisible();
      await audit(page, 'outil — régler');
      await page.getByRole('button', { name: 'Pivoter', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Votre fichier est prêt' })).toBeVisible();
      await audit(page, 'outil — récupérer');
    });

    test('les quinze outils, à l’étape des réglages', async ({ page }) => {
      test.setTimeout(240_000);
      const found: string[] = [];
      for (const [tool, files] of TOOLS) {
        await chooseFiles(page, tool, ...files);
        await page.waitForTimeout(700); // aperçus et miniatures
        found.push(...(await violations(page, tool)));
      }
      expect(found).toEqual([]);
    });

    test('lecteur et ses panneaux', async ({ page }) => {
      await importToLibrary(page, 'outline.pdf');
      await page.getByRole('link', { name: /outline/ }).first().click();
      await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
      await audit(page, 'lecteur');
      await page.getByRole('button', { name: /^(Repères|Sommaire)$/ }).first().click();
      await expect(page.getByRole('dialog', { name: 'Repères' })).toBeVisible();
      await audit(page, 'lecteur — sommaire');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Affichage' }).first().click();
      await audit(page, 'lecteur — affichage');
    });
  });
}
