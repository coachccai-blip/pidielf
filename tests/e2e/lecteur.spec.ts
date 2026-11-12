import { expect, importToLibrary, isMobile, test } from './helpers';

test.describe('lecteur : repères, modes et confort', () => {
  test.beforeEach(async ({ page }) => {
    await importToLibrary(page, 'outline.pdf');
    await page.getByRole('link', { name: /outline/ }).first().click();
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  });

  test('sommaire tiré des signets et miniatures', async ({ page }) => {
    await page.getByRole('button', { name: /^(Repères|Sommaire)$/ }).first().click();
    const panel = page.getByRole('dialog', { name: 'Repères' });
    await expect(panel.getByRole('button', { name: /Chapitre deux/ })).toBeVisible();
    await panel.getByRole('button', { name: /Chapitre trois/ }).click();
    await expect(page.getByRole('slider', { name: 'Aller à une page' })).toHaveValue('5');

    await page.getByRole('button', { name: /^(Repères|Sommaire)$/ }).first().click();
    await page.getByRole('radio', { name: 'Pages', exact: true }).click();
    await page.getByRole('dialog', { name: 'Repères' }).getByRole('button', { name: 'Page 2', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Aller à une page' })).toHaveValue('2');
  });

  test('les liens internes du PDF sont cliquables', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Lien vers une autre page' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('slider', { name: 'Aller à une page' })).toHaveValue('5');
    await page.getByRole('slider', { name: 'Aller à une page' }).fill('1');
    await expect(page.getByRole('link', { name: 'https://example.org/' })).toHaveAttribute('target', '_blank');
  });

  test('page par page, thème de papier et rognage des marges', async ({ page }) => {
    await page.getByRole('button', { name: 'Affichage' }).first().click();
    await page.getByRole('radio', { name: 'Page par page' }).click();
    await page.getByRole('radio', { name: /Sépia/ }).click();
    await page.getByRole('switch', { name: 'Rogner les marges blanches' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.reader')).toHaveAttribute('data-paper', 'sepia');
    // En mode page par page, une seule page est présente.
    await expect(page.locator('[data-page]')).toHaveCount(1);
    // Rognée, la zone visible est plus petite que la feuille entière.
    await expect
      .poll(async () => {
        const holder = (await page.locator('[data-page="1"]').boundingBox())!;
        const sheet = (await page.locator('[data-page="1"] .pdf-sheet').boundingBox())!;
        return sheet.width / holder.width;
      })
      .toBeGreaterThan(1.05);

    if (isMobile(page)) {
      // Appui sur le bord droit : page suivante.
      const box = (await page.locator('.reader').boundingBox())!;
      await page.touchscreen.tap(box.x + box.width * 0.92, box.y + box.height / 2);
    } else {
      await page.keyboard.press('ArrowRight');
    }
    await expect(page.locator('[data-page="2"]')).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Aller à une page' })).toHaveValue('2');
  });

  test('zoom au clavier et retour à l’ajustement', async ({ page }) => {
    test.skip(isMobile(page), 'clavier physique');
    const width = async () => (await page.locator('[data-page="1"]').boundingBox())!.width;
    const initial = await width();
    await page.keyboard.press('+');
    await expect.poll(width).toBeGreaterThan(initial * 1.15);
    await page.keyboard.press('0');
    await expect.poll(width).toBeCloseTo(initial, 0);
  });

  test('note libre, liste des annotations et export des notes', async ({ page }) => {
    await page.getByRole('button', { name: 'Annoter' }).first().click();
    await page.getByRole('menuitem', { name: 'Poser une note' }).click();
    const sheet = (await page.locator('[data-page="1"]').boundingBox())!;
    await page.mouse.click(sheet.x + sheet.width * 0.5, sheet.y + Math.min(sheet.height * 0.4, 300));
    await page.getByRole('dialog', { name: 'Note' }).getByLabel('Note').fill('Passage à vérifier');
    await page.getByRole('button', { name: 'Terminé', exact: true }).click();
    await expect(page.getByRole('button', { name: /Ouvrir la note : Passage à vérifier/ })).toBeVisible();

    await page.getByRole('button', { name: 'Annoter' }).first().click();
    await page.getByRole('menuitem', { name: /Voir l.annotation/ }).click();
    await expect(page.getByRole('dialog', { name: 'Repères' }).getByText('Passage à vérifier')).toBeVisible();
    await page.getByRole('dialog', { name: 'Repères' }).getByRole('button', { name: 'Exporter' }).click();

    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Notes en Markdown/ }).click();
    const file = await pending;
    expect(file.suggestedFilename()).toBe('outline_notes.md');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toContain('Passage à vérifier');
  });
});
