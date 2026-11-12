// Génère les petits fichiers d'exemple de tests/fixtures.
// À relancer avec « npm run fixtures » ; les fichiers produits sont versionnés.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests/fixtures');
await mkdir(out, { recursive: true });
const fixedDate = new Date('2026-01-01T00:00:00Z');

async function textPdf(pageCount, title, options = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pageCount; i++) {
    const size = options.landscape && i % 2 === 0 ? [842, 595] : [595, 842];
    const page = doc.addPage(size);
    const { height } = page.getSize();
    page.drawText(`${title} — page ${i}`, { x: 56, y: height - 80, size: 22, font: bold, color: rgb(0.14, 0.36, 0.21) });
    const lines = [
      `Chapitre ${i}. Sous les frondaisons, la bibliothèque des elfes veille.`,
      'Chaque feuille y garde une page, chaque page un secret.',
      `Mot-clé unique de la page : lune${i}.`,
      'The quick brown fox jumps over the lazy dog.',
    ];
    lines.forEach((line, k) => page.drawText(line, { x: 56, y: height - 130 - k * 24, size: 13, font: serif }));
    for (let k = 0; k < 14; k++) {
      page.drawText('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.', {
        x: 56, y: height - 250 - k * 20, size: 11, font: serif, color: rgb(0.2, 0.2, 0.2),
      });
    }
    if (options.rotateSecond && i === 2) page.setRotation(degrees(90));
  }
  return doc.save({ useObjectStreams: false });
}

// PDF avec sommaire (signets) et liens : trois chapitres de deux pages,
// un lien interne vers la page 5 et un lien externe sur la page 1.
async function outlinePdf() {
  const doc = await PDFDocument.load(await textPdf(6, 'Chapitres'));
  const pages = doc.getPages();
  const ctx = doc.context;
  const titles = ['Chapitre un', 'Chapitre deux', 'Chapitre trois'];
  const outlinesRef = ctx.nextRef();
  const refs = titles.map(() => ctx.nextRef());
  titles.forEach((title, i) => {
    const item = ctx.obj({ Title: PDFHexString.fromText(title), Parent: outlinesRef, Dest: [pages[i * 2].ref, PDFName.of('Fit')] });
    if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], item);
  });
  ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(titles.length) }));
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = pages[0];
  first.drawText('Aller au chapitre trois', { x: 56, y: 120, size: 14, font, color: rgb(0.12, 0.3, 0.47) });
  first.drawText('Site externe', { x: 300, y: 120, size: 14, font, color: rgb(0.12, 0.3, 0.47) });
  const internal = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 110, 230, 140], Border: [0, 0, 0], Dest: [pages[4].ref, PDFName.of('Fit')] }));
  const external = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [295, 110, 400, 140], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/') } }),
  );
  first.node.set(PDFName.of('Annots'), ctx.obj([internal, external]));
  return doc.save({ useObjectStreams: false });
}

// Image « scannée » : du texte pixellisé, sans couche de texte.
const scanSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754">
  <rect width="100%" height="100%" fill="#fdfcf8"/>
  <text x="120" y="220" font-family="DejaVu Serif, serif" font-size="64" fill="#111">Bibliothèque des elfes</text>
  <text x="120" y="340" font-family="DejaVu Sans, sans-serif" font-size="40" fill="#111">Ce document a été numérisé.</text>
  <text x="120" y="420" font-family="DejaVu Sans, sans-serif" font-size="40" fill="#111">The quick brown fox jumps over the lazy dog.</text>
  <text x="120" y="500" font-family="DejaVu Sans, sans-serif" font-size="40" fill="#111">Facture numéro 2026 : total 148 euros.</text>
</svg>`;
const scanJpg = await sharp(Buffer.from(scanSvg)).jpeg({ quality: 82 }).toBuffer();
const photoPng = await sharp({
  create: { width: 320, height: 240, channels: 3, background: { r: 197, g: 230, b: 203 } },
})
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><circle cx="160" cy="120" r="70" fill="#245C35"/></svg>') }])
  .png()
  .toBuffer();
const photoJpg = await sharp(photoPng).jpeg({ quality: 85 }).toBuffer();
// Photo lourde et bruitée, pour tester la compression.
const noise = Buffer.alloc(1600 * 1200 * 3);
let seed = 42;
for (let i = 0; i < noise.length; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  noise[i] = 110 + (seed % 90);
}
const bigJpg = await sharp(noise, { raw: { width: 1600, height: 1200, channels: 3 } }).blur(1.2).jpeg({ quality: 96 }).toBuffer();

async function imagePdf(jpg, width, height) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  const image = await doc.embedJpg(jpg);
  const page = doc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  return doc.save({ useObjectStreams: false });
}

// PDF protégé (AES 256 bits) : mot de passe « elfe ».
async function protect(bytes) {
  const createQpdf = require('@neslinesli93/qpdf-wasm');
  const qpdf = await createQpdf({
    locateFile: () => require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'),
    noInitialRun: true,
    print: () => {},
    printErr: () => {},
  });
  qpdf.FS.writeFile('/in.pdf', bytes);
  qpdf.callMain(['--encrypt', 'elfe', 'proprietaire', '256', '--', '/in.pdf', '/out.pdf']);
  return qpdf.FS.readFile('/out.pdf');
}

const sample = await textPdf(3, 'Exemple');
const files = {
  'sample-3p.pdf': sample,
  'sample-12p.pdf': await textPdf(12, 'Recueil', { landscape: true }),
  'rotated.pdf': await textPdf(2, 'Pivoté', { rotateSecond: true }),
  'outline.pdf': await outlinePdf(),
  'scan.pdf': await imagePdf(scanJpg, 595, 842),
  'heavy-image.pdf': await imagePdf(bigJpg, 595, 446),
  'protected.pdf': await protect(sample),
  'scan.jpg': scanJpg,
  'photo.png': photoPng,
  'photo.jpg': photoJpg,
};
for (const [name, data] of Object.entries(files)) {
  await writeFile(join(out, name), data);
  console.log(`${name.padEnd(18)} ${(data.length / 1024).toFixed(1)} Ko`);
}
