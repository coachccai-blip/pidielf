import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { download, expect, importToLibrary, pdfText, test } from './helpers';

/** Annotations « note » (/Text) d'une page, lues comme le ferait un autre lecteur PDF. */
async function stickyNotes(bytes: Uint8Array, pageIndex: number): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const out: string[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const annot = annots!.lookup(i, PDFDict);
    if (annot.get(PDFName.of('Subtype')) !== PDFName.of('Text')) continue;
    const contents = annot.lookup(PDFName.of('Contents')) as { decodeText?: () => string };
    out.push(contents.decodeText?.() ?? String(contents));
  }
  return out;
}

test.describe('annoter dans le lecteur', () => {
  test('un document annoté s’exporte avec ses annotations, sans toucher à l’original', async ({ page }) => {
    await importToLibrary(page, 'sample-3p.pdf');
    await page.getByRole('link', { name: /sample-3p/ }).first().click();
    await expect(page.locator('[data-page="1"] .textLayer span').first()).toBeAttached();

    // Surlignage avec une note attachée.
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('[data-page="1"] .textLayer span')].find((s) => s.textContent?.includes('quick brown'))!;
      const range = document.createRange();
      range.selectNodeContents(span);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await page.getByRole('button', { name: 'Ajouter une note' }).click();
    await page.getByRole('dialog').getByLabel('Note').fill('Le renard est rapide.');
    await page.getByRole('button', { name: 'Terminé', exact: true }).click();
    await expect(page.locator('[data-page="1"] .hl-yellow')).toHaveCount(1);

    // Dessin libre.
    await page.getByRole('button', { name: 'Annoter' }).first().click();
    await page.getByRole('menuitem', { name: 'Dessiner sur la page' }).click();
    const sheet = (await page.locator('[data-page="1"]').boundingBox())!;
    const y = sheet.y + Math.min(sheet.height * 0.5, 320);
    await page.mouse.move(sheet.x + sheet.width * 0.3, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sheet.x + sheet.width * (0.3 + i * 0.03), y + (i % 2) * 12);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Terminé', exact: true }).click();
    await expect(page.locator('[data-page="1"] svg.pointer-events-none path')).toHaveCount(1);

    // Export : PDF avec annotations intégrées.
    await page.getByRole('button', { name: "Plus d'actions" }).click();
    await page.getByRole('menuitem', { name: 'Exporter' }).click();
    const annotated = await download(page, /PDF avec annotations/);
    expect(annotated.name).toBe('sample-3p_annote.pdf');
    expect(await stickyNotes(annotated.bytes, 0)).toEqual([expect.stringContaining('Le renard est rapide.')]);
    expect((await pdfText(annotated.bytes))[0]).toContain('quick brown fox'); // le texte reste du texte

    // Export : PDF d'origine, strictement inchangé.
    await page.getByRole('button', { name: "Plus d'actions" }).click();
    await page.getByRole('menuitem', { name: 'Exporter' }).click();
    const original = await download(page, /PDF d'origine/);
    expect(original.name).toBe('sample-3p.pdf');
    expect(await stickyNotes(original.bytes, 0)).toEqual([]);
    expect(original.bytes.length).toBeLessThan(annotated.bytes.length);
  });
});
