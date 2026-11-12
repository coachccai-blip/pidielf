import { expect, test } from '@playwright/test';
import { fixture, importToLibrary, isMobile, open } from './helpers';

test.describe('bibliothèque et lecteur', () => {
  test('un PDF importé réapparaît après rechargement et se rouvre à la bonne page', async ({ page }) => {
    await importToLibrary(page, 'sample-12p.pdf');
    await page.getByRole('link', { name: /sample-12p/ }).first().click();
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible();

    // Aller à la page 5 avec le curseur de progression.
    const slider = page.getByRole('slider', { name: 'Aller à une page' });
    await slider.fill('5');
    await expect(slider).toHaveAttribute('aria-valuetext', 'Page 5 sur 12');
    await page.waitForTimeout(700); // la progression est enregistrée après un court délai

    await page.reload();
    await expect(page.locator('[data-page="5"] canvas')).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Aller à une page' })).toHaveValue('5');

    await open(page, '/bibliotheque');
    await expect(page.getByText('sample-12p', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Progression de lecture' }).first()).toHaveAttribute('aria-valuenow', '36');
    await open(page, '/');
    await expect(page.getByRole('heading', { name: 'Reprendre la lecture' })).toBeVisible();
  });

  test('signale un doublon avant de l’ajouter', async ({ page }) => {
    await importToLibrary(page, 'sample-3p.pdf');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^Importer/ }).first().click();
    await (await chooser).setFiles(fixture('sample-3p.pdf'));
    await expect(page.getByRole('dialog', { name: 'Ce fichier est déjà dans la bibliothèque' })).toBeVisible();
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByText('1 fichier', { exact: true })).toBeVisible();
  });

  test('renomme, met en favori, range sur une étagère, puis supprime avec confirmation', async ({ page }) => {
    await importToLibrary(page, 'sample-3p.pdf');
    const actions = page.getByRole('button', { name: 'Actions pour sample-3p' });

    await actions.click();
    await page.getByRole('menuitem', { name: 'Renommer' }).click();
    await page.getByLabel('Nouveau nom').fill('Grimoire');
    await page.getByRole('button', { name: 'Renommer' }).click();
    await expect(page.getByText('Grimoire', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Actions pour Grimoire' }).click();
    await page.getByRole('menuitem', { name: 'Ajouter aux favoris' }).click();
    await page.getByRole('button', { name: 'Favoris', exact: true }).click();
    await expect(page.getByText('Grimoire', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Tous', exact: true }).click();

    await page.getByRole('button', { name: 'Actions pour Grimoire' }).click();
    await page.getByRole('menuitem', { name: 'Étagères' }).click();
    await page.getByRole('button', { name: 'Nouvelle étagère' }).last().click();
    await page.getByLabel("Nom de l'étagère").fill('Contes');
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByRole('checkbox', { name: 'Contes' })).toBeChecked();
    await page.getByRole('button', { name: 'Terminé', exact: true }).click();
    await page.getByRole('button', { name: 'Contes', exact: true }).click();
    await expect(page.getByText('Grimoire', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Actions pour Grimoire' }).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await expect(page.getByRole('dialog', { name: 'Supprimer ce fichier ?' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByText('Grimoire', { exact: true })).toHaveCount(0);
  });

  test('recherche, filtre et sélection multiple', async ({ page }) => {
    await importToLibrary(page, 'sample-3p.pdf', 'sample-12p.pdf', 'rotated.pdf');
    await page.getByRole('searchbox', { name: 'Rechercher par titre' }).fill('rota');
    await expect(page.getByText('rotated', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('sample-3p', { exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Rechercher par titre' }).fill('');

    await page.getByRole('button', { name: 'Sélectionner', exact: true }).click();
    await page.getByRole('link', { name: 'Sélectionner sample-3p' }).click();
    await page.getByRole('link', { name: 'Sélectionner rotated' }).click();
    await expect(page.getByText('2 sélectionnés')).toBeVisible();
    await page.getByRole('button', { name: 'Fusionner' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fusionner' })).toBeVisible();
    await expect(page.getByText('2 fichiers, 5 pages au total.')).toBeVisible();
  });

  test('demande le mot de passe d’un PDF protégé à l’ouverture', async ({ page }) => {
    await importToLibrary(page, 'protected.pdf');
    await page.getByRole('link', { name: /protected/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'PDF protégé' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Mot de passe', { exact: true }).fill('faux');
    await dialog.getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page.getByText("Ce mot de passe n'est pas le bon")).toBeVisible();
    await page.getByRole('dialog').getByLabel('Mot de passe', { exact: true }).fill('elfe');
    await page.getByRole('dialog').getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  });

  test('lecteur : recherche, mode Texte, surlignage, marque-page', async ({ page }) => {
    await importToLibrary(page, 'sample-12p.pdf');
    await page.getByRole('link', { name: /sample-12p/ }).first().click();
    await expect(page.locator('[data-page="1"] .textLayer span').first()).toBeAttached();

    // Recherche plein texte.
    await page.getByRole('button', { name: 'Rechercher dans le document' }).click();
    await page.getByRole('searchbox', { name: 'Rechercher dans le document' }).fill('lune9');
    await expect(page.getByRole('search').getByText('1 / 1')).toBeVisible();
    await expect(page.locator('[data-page="9"] .search-hit.current')).toBeVisible();
    await page.getByRole('button', { name: 'Fermer la recherche' }).click();

    // Marque-page sur la page courante.
    await page.getByRole('button', { name: 'Poser un marque-page' }).click();
    await expect(page.getByRole('button', { name: 'Retirer le marque-page' })).toBeVisible();

    // Surlignage d'une sélection.
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('[data-page="9"] .textLayer span')].find((s) => s.textContent?.includes('Chaque feuille'))!;
      const range = document.createRange();
      range.selectNodeContents(span);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.getByRole('button', { name: 'Surligner en jaune' }).click();
    await expect(page.locator('[data-page="9"] .hl-yellow')).toHaveCount(1);

    // Mode Texte recomposé, puis retour à la page d'origine.
    await page.getByRole('button', { name: 'Mode Texte' }).first().click();
    await expect(page.locator('.reflow h2', { hasText: 'Recueil — page 9' })).toBeVisible();
    await page.getByRole('button', { name: "Voir la page 9 d'origine" }).click();
    await expect(page.locator('[data-page="9"] canvas')).toBeVisible();

    // L'interface se masque d'un appui au centre.
    if (!isMobile(page)) {
      const box = (await page.locator('.reader').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator('.reader header')).not.toBeInViewport();
    }
  });
});
