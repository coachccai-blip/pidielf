import { chooseFiles, download, expect, expectResult, importToLibrary, open, pdfInfo, test } from './helpers';

test.describe('parcours d’un outil et écran d’export', () => {
  test('Pivoter : résultat valide, téléchargé, renommé et rangé dans la bibliothèque', async ({ page }) => {
    await chooseFiles(page, 'pivoter', 'sample-3p.pdf');
    await page.getByRole('button', { name: 'Pivoter', exact: true }).click();
    await expectResult(page);
    await expect(page.getByText('Dans la bibliothèque', { exact: true })).toBeVisible();

    // Le nom proposé suit le modèle nom-d-origine_outil.pdf, et reste modifiable.
    const name = page.getByRole('textbox', { name: 'Nom du fichier' });
    await expect(name).toHaveValue('sample-3p_pivote');
    await name.fill('grimoire-tourne');
    const file = await download(page);
    expect(file.name).toBe('grimoire-tourne.pdf');
    expect((await pdfInfo(file.bytes)).rotations).toEqual([90, 90, 90]);

    // Le résultat est un nouveau fichier de la bibliothèque, produit par un outil.
    await open(page, '/bibliotheque');
    await page.getByRole('button', { name: 'Produits par un outil' }).click();
    await expect(page.getByText('grimoire-tourne', { exact: true }).first()).toBeVisible();
  });

  test('Fusionner depuis la bibliothèque : l’original est conservé, la version dérivée lui est liée', async ({ page }) => {
    await importToLibrary(page, 'sample-3p.pdf');
    await page.getByRole('button', { name: 'Actions pour sample-3p' }).click();
    await page.getByRole('menuitem', { name: 'Pivoter' }).click();
    await expect(page.getByRole('button', { name: 'Page 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Pivoter', exact: true }).click();
    await expectResult(page);

    await open(page, '/bibliotheque');
    await expect(page.getByText('2 fichiers', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actions pour sample-3p', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Détails' }).click();
    const sheet = page.getByRole('dialog', { name: 'Détails' });
    await expect(sheet.getByRole('heading', { name: 'Versions' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: /sample-3p_pivote\.pdf/ })).toBeVisible();
  });

  test('ouvrir le résultat dans le lecteur, puis enchaîner un autre outil', async ({ page }) => {
    await chooseFiles(page, 'fusionner', 'sample-3p.pdf', 'rotated.pdf');
    await expect(page.getByText('2 fichiers, 5 pages au total.')).toBeVisible();
    await page.getByRole('button', { name: 'Fusionner', exact: true }).click();
    await expectResult(page);
    expect((await pdfInfo((await download(page)).bytes)).pages).toBe(5);

    await page.getByRole('button', { name: 'Enchaîner un autre outil' }).click();
    await page.getByRole('dialog', { name: 'Enchaîner un autre outil' }).getByRole('link', { name: /Pivoter/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pivoter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Page 5' })).toBeVisible();
    await page.getByRole('button', { name: 'Pivoter', exact: true }).click();
    await expectResult(page);

    await page.getByRole('button', { name: 'Ouvrir dans le lecteur' }).click();
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Aller à une page' })).toHaveAttribute('max', '5');
  });

  test('l’enregistrement automatique se désactive dans les réglages', async ({ page }) => {
    await open(page, '/reglages');
    await page.getByRole('switch', { name: 'Enregistrer les résultats dans la bibliothèque' }).click();
    await chooseFiles(page, 'pivoter', 'sample-3p.pdf');
    await page.getByRole('button', { name: 'Pivoter', exact: true }).click();
    await expectResult(page);
    await expect(page.getByText('Dans la bibliothèque', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Enregistrer dans la bibliothèque' }).click();
    await expect(page.getByText('Dans la bibliothèque', { exact: true })).toBeVisible();
  });

  test('un PDF protégé demande son mot de passe avant d’entrer dans un outil', async ({ page }) => {
    await open(page, '/outils/pivoter');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: "Depuis l'appareil" }).click();
    await (await chooser).setFiles((await import('./helpers')).fixture('protected.pdf'));
    const dialog = page.getByRole('dialog', { name: 'PDF protégé' });
    await dialog.getByLabel('Mot de passe', { exact: true }).fill('elfe');
    await dialog.getByRole('button', { name: 'Déverrouiller' }).click();
    await expect(page.getByRole('button', { name: 'Page 3' })).toBeVisible();
  });

  test('explique un fichier abîmé en langage simple', async ({ page }) => {
    await open(page, '/outils/pivoter');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: "Depuis l'appareil" }).click();
    await (await chooser).setFiles({ name: 'casse.pdf', mimeType: 'application/pdf', buffer: Buffer.from('ceci n’est pas un PDF') });
    await expect(page.getByText('Ce fichier semble abîmé')).toBeVisible();
  });
});
