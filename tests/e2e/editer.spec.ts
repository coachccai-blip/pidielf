import { PDFDocument, PDFName, PDFDict, PDFRawStream } from '@cantoo/pdf-lib';
import { chooseFiles, download, expect, expectResult, pdfInfo, pdfText, test } from './helpers';

/** Nombre d'images (XObjects) référencées par une page. */
async function imageCount(bytes: Uint8Array, pageIndex: number): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const resources = doc.getPage(pageIndex).node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  let count = 0;
  for (const [, ref] of xobjects?.entries() ?? []) {
    const object = doc.context.lookup(ref);
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) count++;
  }
  return count;
}

test.describe('éditer et signer', () => {
  test('Éditer : un texte ajouté sur la page se retrouve dans le PDF', async ({ page }) => {
    await chooseFiles(page, 'editer', 'sample-3p.pdf');
    await expect(page.getByText("Le texte d'origine ne se modifie pas")).toBeVisible();

    await page.getByRole('toolbar', { name: "Outils d'édition" }).getByRole('button', { name: 'Texte', exact: true }).click();
    const surface = page.getByRole('group', { name: /Page 1 sur 3/ });
    const box = (await surface.boundingBox())!;
    await surface.click({ position: { x: box.width * 0.3, y: Math.min(box.height * 0.5, 150) } });
    await page.getByRole('textbox', { name: 'Texte à ajouter' }).fill('Relu et approuvé');
    await page.keyboard.press('Escape');
    await expect(page.getByText('1 élément sera ajouté au PDF.')).toBeVisible();

    await page.getByRole('button', { name: 'Appliquer' }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toBe('sample-3p_edite.pdf');
    const text = await pdfText(file.bytes);
    expect(text).toHaveLength(3);
    expect(text[0]).toContain('Relu et approuvé');
    expect(text[0]).toContain('lune1'); // le contenu d'origine est intact
    expect(text[1]).not.toContain('Relu et approuvé');
  });

  test('Signer : signature tapée et date posées, mémorisées sur l’appareil', async ({ page }) => {
    await chooseFiles(page, 'signer', 'sample-3p.pdf');
    await expect(page.getByText(/n'a pas la valeur d'une signature électronique certifiée/)).toBeVisible();

    await page.getByRole('button', { name: 'Signature', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Taper au clavier' }).click();
    await page.getByLabel('Votre nom').fill('Elwë Singollo');
    await page.getByRole('button', { name: 'Valider' }).click();
    await page.getByRole('button', { name: 'Date', exact: true }).click();
    await expect(page.getByText('2 éléments seront posés sur le PDF.')).toBeVisible();

    await page.getByRole('button', { name: 'Signer', exact: true }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toBe('sample-3p_signe.pdf');
    expect((await pdfInfo(file.bytes)).pages).toBe(3);
    expect(await imageCount(file.bytes, 0)).toBe(1); // la signature est une image posée sur la page
    expect((await pdfText(file.bytes))[0]).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}/); // la date

    // La signature mémorisée est proposée à nouveau, en un appui.
    await page.getByRole('button', { name: 'Traiter un autre fichier' }).click();
    await chooseFiles(page, 'signer', 'rotated.pdf');
    await expect(page.getByText('Enregistrées sur cet appareil')).toBeVisible();
    await page.getByRole('button', { name: /^Poser/ }).first().click();
    await expect(page.getByText('1 élément sera posé sur le PDF.')).toBeVisible();
  });
});
