import { chooseFiles, download, expect, expectResult, pdfInfo, pdfText, test, unzip } from './helpers';

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

test.describe('convertir', () => {
  test('PDF en images : une image par page, réunies en ZIP', async ({ page }) => {
    await chooseFiles(page, 'pdf-en-images', 'sample-3p.pdf');
    await page.getByRole('radio', { name: 'PNG' }).click();
    await page.getByRole('button', { name: 'Exporter les pages' }).click();
    await expectResult(page);
    const zip = unzip((await download(page, 'Exporter en ZIP')).bytes);
    const names = Object.keys(zip).sort();
    expect(names).toEqual(['sample-3p_page-1.png', 'sample-3p_page-2.png', 'sample-3p_page-3.png']);
    for (const name of names) expect(isPng(zip[name])).toBe(true);
  });

  test('PDF en images : extrait les images contenues dans le PDF', async ({ page }) => {
    await chooseFiles(page, 'pdf-en-images', 'heavy-image.pdf');
    await page.getByRole('radio', { name: /Les images contenues/ }).click();
    await page.getByRole('button', { name: 'Extraire les images' }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toMatch(/^heavy-image_image-1\.(jpg|png)$/);
    expect(isJpeg(file.bytes) || isPng(file.bytes)).toBe(true);
  });

  test('Images en PDF : une page par image, dans l’ordre', async ({ page }) => {
    await chooseFiles(page, 'images-en-pdf', 'photo.png', 'photo.jpg', 'scan.jpg');
    await expect(page.getByText('Le PDF comptera 3 pages.')).toBeVisible();
    await page.getByRole('button', { name: 'Créer le PDF' }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toBe('photo_images.pdf');
    const info = await pdfInfo(file.bytes);
    // A4, orientation automatique : deux photos en paysage, un scan en portrait.
    expect(info.sizes).toEqual([[842, 595], [842, 595], [595, 842]]);
  });

  test('Scanner : une photo devient un PDF, avec l’OCR proposé en un appui', async ({ page }) => {
    test.setTimeout(180_000);
    await chooseFiles(page, 'scanner', 'scan.jpg');
    await expect(page.getByText('Le PDF comptera 1 page.')).toBeVisible();

    // Réglage d'un coin au clavier, dans l'éditeur.
    await page.getByRole('button', { name: /Ajuster les coins/ }).first().click();
    const corner = page.getByRole('dialog').getByRole('button', { name: 'Coin en haut à gauche' }).or(page.getByRole('dialog').getByRole('slider', { name: 'Coin en haut à gauche' })).first();
    await corner.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Escape');

    await page.getByRole('radio', { name: 'Noir et blanc' }).click();
    await page.getByRole('button', { name: 'Créer le PDF' }).click();
    await expectResult(page);
    const file = await download(page);
    expect(file.name).toMatch(/^scan_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect((await pdfInfo(file.bytes)).pages).toBe(1);

    // L'OCR en un appui : le PDF du scan est chargé dans l'outil OCR.
    await page.getByRole('button', { name: 'Rendre le texte cherchable (OCR)' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'OCR' })).toBeVisible();
    await page.getByRole('button', { name: 'Lancer la reconnaissance' }).click();
    await expectResult(page, 150_000);
    const text = (await pdfText((await download(page)).bytes))[0].replace(/\s+/g, ' ');
    expect(text).toContain('quick brown fox');
  });
});
