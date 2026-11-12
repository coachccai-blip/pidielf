import { download, expect, importToLibrary, open, test } from './helpers';

test.describe('réglages : sauvegarde, restauration, tout effacer', () => {
  test('la bibliothèque se sauvegarde en ZIP, s’efface, puis se restaure avec ses annotations', async ({ page }) => {
    await importToLibrary(page, 'sample-3p.pdf', 'outline.pdf');

    // Un marque-page, pour vérifier que les données de lecture voyagent avec la sauvegarde.
    await page.getByRole('link', { name: /outline/ }).first().click();
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Poser un marque-page' }).click();
    await expect(page.getByRole('button', { name: 'Retirer le marque-page' })).toBeVisible();

    await open(page, '/reglages');
    await expect(page.getByRole('progressbar', { name: 'Espace utilisé' })).toBeVisible();
    const backup = await download(page, 'Exporter une sauvegarde');
    expect(backup.name).toMatch(/^pidielf-sauvegarde-\d{4}-\d{2}-\d{2}\.zip$/);

    // Tout effacer : confirmation, puis bibliothèque vide et préférences remises à zéro.
    await page.getByRole('radio', { name: 'Sombre' }).click();
    await page.getByRole('button', { name: 'Tout effacer' }).click();
    await page.getByRole('dialog', { name: 'Tout effacer ?' }).getByRole('button', { name: 'Tout effacer' }).click();
    await expect(page.getByText('Tout a été effacé.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
    await open(page, '/bibliotheque');
    await expect(page.getByRole('heading', { name: 'Aucun fichier pour l\'instant' })).toBeVisible();

    // Restauration.
    await open(page, '/reglages');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restaurer une sauvegarde' }).click();
    await (await chooser).setFiles({ name: backup.name, mimeType: 'application/zip', buffer: Buffer.from(backup.bytes) });
    await expect(page.getByText('Sauvegarde restaurée : 2 fichiers ajoutés.')).toBeVisible();

    await open(page, '/bibliotheque');
    await expect(page.getByText('2 fichiers', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: /outline/ }).first().click();
    await expect(page.getByRole('button', { name: 'Retirer le marque-page' })).toBeVisible();
  });

  test('refuse une archive qui n’est pas une sauvegarde', async ({ page }) => {
    await open(page, '/reglages');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restaurer une sauvegarde' }).click();
    await (await chooser).setFiles({ name: 'autre.zip', mimeType: 'application/zip', buffer: Buffer.from('pas une archive') });
    await expect(page.getByText("Cette archive n'est pas une sauvegarde PidiElf valide.")).toBeVisible();
  });
});
