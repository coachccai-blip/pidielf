import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test as base, type Download, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

/**
 * Sur bureau, l'application ouvre la fenêtre « Enregistrer sous » du système, qu'un
 * navigateur sans affichage ne peut pas présenter : les tests passent par le
 * téléchargement classique (le repli prévu pour les navigateurs qui n'ont pas cette fenêtre).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });
    // En développement, les rechargements à chaud de Vite ne doivent pas interrompre un parcours.
    if (process.env.PIDIELF_URL) await page.routeWebSocket(/./, () => undefined);
    await use(page);
  },
});
export { expect };

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): string => join(here, '..', 'fixtures', name);

export const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 700;

/** Ouvre l'application sur une route (#/…). */
export async function open(page: Page, route = '/'): Promise<void> {
  await page.goto(`./#${route}`);
  await expect(page.locator('h1').first()).toBeVisible();
}

/** Importe des fichiers dans la bibliothèque depuis l'accueil, sans ouvrir le lecteur. */
export async function importToLibrary(page: Page, ...names: string[]): Promise<void> {
  await open(page, '/bibliotheque');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Importer/ }).first().click();
  await (await chooser).setFiles(names.map(fixture));
  for (const name of names) await expect(page.getByText(name.replace(/\.pdf$/, ''), { exact: true }).first()).toBeVisible();
}

/** Étape « Choisir » d'un outil : fichiers pris sur l'appareil. */
export async function chooseFiles(page: Page, tool: string, ...names: string[]): Promise<void> {
  await open(page, `/outils/${tool}`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: "Depuis l'appareil" }).click();
  await (await chooser).setFiles(names.map(fixture));
  await expect(page.locator('ol[aria-label="Étapes"] li[aria-current="step"]')).toContainText('2');
}

/** Attend l'écran de résultat. */
export async function expectResult(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.getByRole('heading', { name: /(est prêt|sont prêts)/ })).toBeVisible({ timeout });
}

/** Clique sur un bouton de téléchargement et renvoie le contenu du fichier. */
export async function download(page: Page, button: string | RegExp = 'Télécharger'): Promise<{ name: string; bytes: Uint8Array; download: Download }> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).first().click();
  const dl = await pending;
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile(path)), download: dl };
}

export async function pdfInfo(bytes: Uint8Array): Promise<{ pages: number; sizes: Array<[number, number]>; rotations: number[] }> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  return {
    pages: pages.length,
    sizes: pages.map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]),
    rotations: pages.map((p) => p.getRotation().angle),
  };
}

/** Lit le texte d'un PDF avec pdf.js (version « legacy », utilisable sous Node). */
export async function pdfText(bytes: Uint8Array, password?: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password, useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await doc.loadingTask.destroy();
  return out;
}
