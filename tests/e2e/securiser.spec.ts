import { chooseFiles, download, expect, expectResult, pdfInfo, pdfText, test } from './helpers';

test.describe('outils avancés : protéger, déverrouiller, OCR', () => {
  test('Protéger : le fichier produit exige son mot de passe dans un autre lecteur', async ({ page }) => {
    await chooseFiles(page, 'proteger', 'sample-3p.pdf');
    await page.getByLabel('Mot de passe', { exact: true }).fill('clair-de-lune 42');
    await page.getByLabel('Confirmer le mot de passe').fill('clair-de-lune 42');
    await expect(page.getByText(/Solidité/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Protéger', exact: true }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toBe('sample-3p_protege.pdf');

    // pdf.js (un autre lecteur) refuse sans mot de passe, et ouvre avec.
    await expect(pdfText(file.bytes)).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(pdfText(file.bytes, 'faux')).rejects.toMatchObject({ name: 'PasswordException' });
    const text = await pdfText(file.bytes, 'clair-de-lune 42');
    expect(text).toHaveLength(3);
    expect(text[0]).toContain('lune1');

    // Le mot de passe n'est enregistré nulle part.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain('clair-de-lune');
  });

  test('Déverrouiller : refuse un mauvais mot de passe, retire la protection avec le bon', async ({ page }) => {
    await chooseFiles(page, 'deverrouiller', 'protected.pdf');
    await page.getByLabel('Mot de passe du fichier').fill('faux');
    await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click();
    await expect(page.getByText("Ce mot de passe n'est pas le bon").first()).toBeVisible();

    await page.getByLabel('Mot de passe du fichier').fill('elfe');
    await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toBe('protected_deverrouille.pdf');
    expect((await pdfInfo(file.bytes)).pages).toBe(3);
    expect((await pdfText(file.bytes))[2]).toContain('lune3');
  });

  test('OCR : un scan devient cherchable', async ({ page }) => {
    test.setTimeout(180_000);
    await chooseFiles(page, 'ocr', 'scan.pdf');
    await page.getByRole('button', { name: 'Lancer la reconnaissance' }).click();
    await expectResult(page, 150_000);
    const file = await download(page);
    expect(file.name).toBe('scan_ocr.pdf');
    const text = (await pdfText(file.bytes))[0].replace(/\s+/g, ' ');
    expect(text).toMatch(/Biblioth.que des elfes/);
    expect(text).toContain('quick brown fox');
    expect((await pdfInfo(file.bytes)).sizes).toEqual([[595, 842]]);
  });
});
