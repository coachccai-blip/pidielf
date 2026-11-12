import { download, expect, importToLibrary, isMobile, pdfText, test } from './helpers';

test.describe('surligneur et historique des annotations', () => {
  test.beforeEach(async ({ page }) => {
    await importToLibrary(page, 'sample-3p.pdf');
    await page.getByRole('link', { name: /sample-3p/ }).first().click();
    await expect(page.locator('[data-page="1"] .textLayer span').first()).toBeAttached();
  });

  const markers = '[data-page="1"] .marker-layer path';

  async function drawLine(page: import('@playwright/test').Page, y: number): Promise<void> {
    const sheet = (await page.locator('[data-page="1"]').boundingBox())!;
    const top = sheet.y + Math.min(sheet.height * y, 420 * y + 80);
    await page.mouse.move(sheet.x + sheet.width * 0.2, top);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sheet.x + sheet.width * (0.2 + i * 0.05), top + (i % 2));
    await page.mouse.up();
  }

  test('surligne librement en couleur pastel, puis annule et rétablit depuis la barre', async ({ page }) => {
    await page.getByRole('button', { name: 'Annoter' }).first().click();
    await page.getByRole('menuitem', { name: 'Surligner au surligneur' }).click();
    const bar = page.getByRole('toolbar', { name: 'Annoter' });
    await bar.getByRole('button', { name: 'Surligner en vert' }).click();
    await drawLine(page, 0.3);
    await expect(page.locator(markers)).toHaveCount(1);
    await expect(page.locator(markers)).toHaveAttribute('stroke', '#8cde96');

    await bar.getByRole('button', { name: 'Surligner en rose' }).click();
    await drawLine(page, 0.5);
    await expect(page.locator(markers)).toHaveCount(2);

    await bar.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.locator(markers)).toHaveCount(1);
    await bar.getByRole('button', { name: 'Rétablir', exact: true }).click();
    await expect(page.locator(markers)).toHaveCount(2);
    await bar.getByRole('button', { name: 'Terminé', exact: true }).click();

    // Le surlignage est conservé à la réouverture, et part dans l'export annoté.
    await page.reload();
    await expect(page.locator(markers)).toHaveCount(2);
    await page.getByRole('button', { name: "Plus d'actions" }).click();
    await page.getByRole('menuitem', { name: 'Exporter' }).click();
    const file = await download(page, /PDF avec annotations/);
    expect(file.name).toBe('sample-3p_annote.pdf');
    expect((await pdfText(file.bytes))[0]).toContain('lune1');
  });

  test('Ctrl+Z et Ctrl+Y annulent et rétablissent chaque modification', async ({ page }) => {
    test.skip(isMobile(page), 'clavier physique');
    const highlight = page.locator('[data-page="1"] .hl');

    // 1. Un surlignage de texte.
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('[data-page="1"] .textLayer span')].find((s) => s.textContent?.includes('Chaque feuille'))!;
      const range = document.createRange();
      range.selectNodeContents(span);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await page.getByRole('button', { name: 'Surligner en jaune' }).click();
    await expect(highlight).toHaveCount(1);

    // 2. Un trait de surligneur.
    await page.getByRole('button', { name: 'Annoter' }).first().click();
    await page.getByRole('menuitem', { name: 'Surligner au surligneur' }).click();
    await drawLine(page, 0.5);
    await page.getByRole('toolbar', { name: 'Annoter' }).getByRole('button', { name: 'Terminé', exact: true }).click();
    await expect(page.locator(markers)).toHaveCount(1);

    // 3. Un changement de couleur du surlignage de texte.
    const box = (await highlight.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const dialog = page.getByRole('dialog', { name: 'Surlignage' });
    await dialog.getByRole('radio', { name: 'bleu' }).click();
    await dialog.getByRole('button', { name: 'Terminé', exact: true }).click();
    await expect(dialog).toBeHidden(); // les raccourcis du lecteur sont inactifs tant qu'une fenêtre est ouverte
    await expect(page.locator('[data-page="1"] .hl-blue')).toHaveCount(1);

    // Ctrl+Z remonte le temps, modification par modification.
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-page="1"] .hl-yellow')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(page.locator(markers)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(highlight).toHaveCount(0);
    await page.keyboard.press('Control+z'); // plus rien à annuler : sans effet
    await expect(highlight).toHaveCount(0);

    // Ctrl+Y (ou Ctrl+Maj+Z) rétablit dans l'ordre.
    await page.keyboard.press('Control+y');
    await expect(page.locator('[data-page="1"] .hl-yellow')).toHaveCount(1);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator(markers)).toHaveCount(1);
    await page.keyboard.press('Control+y');
    await expect(page.locator('[data-page="1"] .hl-blue')).toHaveCount(1);

    // Une suppression s'annule aussi.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole('dialog', { name: 'Surlignage' }).getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(highlight).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-page="1"] .hl-blue')).toHaveCount(1);
  });
});
