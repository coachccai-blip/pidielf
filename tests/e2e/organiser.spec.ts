import { chooseFiles, download, expect, expectResult, pdfInfo, pdfText, test, unzip } from './helpers';

test.describe('outils essentiels et d’édition', () => {
  test('Diviser : toutes les N pages, résultat en ZIP', async ({ page }) => {
    await chooseFiles(page, 'diviser', 'sample-12p.pdf');
    await page.getByRole('radio', { name: /Toutes les N pages/ }).click();
    await page.getByLabel('Pages par fichier').fill('5');
    await page.getByRole('button', { name: 'Diviser', exact: true }).click();
    await expectResult(page);
    await expect(page.getByRole('textbox', { name: 'Nom du fichier' })).toHaveCount(3);

    const zip = unzip((await download(page, 'Exporter en ZIP')).bytes);
    const names = Object.keys(zip).sort();
    expect(names).toEqual(['sample-12p_partie-1.pdf', 'sample-12p_partie-2.pdf', 'sample-12p_partie-3.pdf']);
    const counts = await Promise.all(names.map(async (n) => (await pdfInfo(zip[n])).pages));
    expect(counts).toEqual([5, 5, 2]);
  });

  test('Organiser les pages : supprimer, annuler, puis créer le PDF', async ({ page }) => {
    await chooseFiles(page, 'organiser', 'sample-3p.pdf');
    await page.getByRole('button', { name: 'Actions pour la page 2' }).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await expect(page.getByRole('button', { name: /^Actions pour la page/ })).toHaveCount(2);
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Actions pour la page/ })).toHaveCount(3);

    await page.getByRole('button', { name: 'Actions pour la page 1' }).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await page.getByRole('button', { name: 'Créer le PDF' }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toBe('sample-3p_organise.pdf');
    const text = await pdfText(file.bytes);
    expect(text).toHaveLength(2);
    expect(text[0]).toContain('lune2');
    expect(text[1]).toContain('lune3');
  });

  test('Filigrane : le texte est posé sur chaque page', async ({ page }) => {
    await chooseFiles(page, 'filigrane', 'sample-3p.pdf');
    await page.getByLabel('Texte', { exact: true }).fill('BROUILLON');
    await page.getByRole('button', { name: 'Ajouter le filigrane' }).click();
    await expectResult(page);
    const text = await pdfText((await download(page)).bytes);
    expect(text).toHaveLength(3);
    for (const pageText of text) expect(pageText).toContain('BROUILLON');
    expect(text[0]).toContain('lune1'); // le contenu d'origine est intact
  });

  test('Numéros de page : chaque page reçoit son numéro', async ({ page }) => {
    await chooseFiles(page, 'numeros', 'sample-3p.pdf');
    await page.getByRole('button', { name: 'Numéroter les pages' }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toBe('sample-3p_numerote.pdf');
    const original = await pdfText(new Uint8Array(await (await import('node:fs/promises')).readFile((await import('./helpers')).fixture('sample-3p.pdf'))));
    const text = await pdfText(file.bytes);
    // Le texte ajouté sur chaque page contient le numéro de la page.
    text.forEach((pageText, i) => {
      const added = pageText.replace(original[i], '').trim() || pageText.slice(original[i].length);
      expect(pageText.length).toBeGreaterThan(original[i].length);
      expect(added + pageText.slice(-12)).toContain(String(i + 1));
    });
  });

  test('Compresser : affiche la taille avant et après, le texte reste du texte', async ({ page }) => {
    await chooseFiles(page, 'compresser', 'heavy-image.pdf');
    await page.getByRole('radio', { name: /Forte/ }).click();
    await page.getByRole('button', { name: 'Compresser', exact: true }).click();
    await expectResult(page);
    await expect(page.getByText(/de gagné/)).toBeVisible();
    const file = await download(page);
    expect(file.bytes.length).toBeLessThan(610_000 * 0.5);
    expect((await pdfInfo(file.bytes)).pages).toBe(1);
  });

  test('Compresser : signale un fichier déjà optimisé sans le grossir', async ({ page }) => {
    await chooseFiles(page, 'compresser', 'sample-3p.pdf');
    await page.getByRole('button', { name: 'Compresser', exact: true }).click();
    await expectResult(page);
    const first = await download(page);
    expect(first.bytes.length).toBeLessThanOrEqual(5600);
    expect((await pdfText(first.bytes))[0]).toContain('lune1');
  });
});
