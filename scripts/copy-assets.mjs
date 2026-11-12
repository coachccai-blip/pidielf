// Copie dans public/vendor les ressources que l'application sert elle-même
// (aucun CDN tiers) : données pdf.js, moteur et modèles OCR.
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const out = (...p) => join(root, 'public', 'vendor', ...p);

const jobs = [
  // pdf.js : tables de caractères, polices standard, décodeurs d'images.
  [nm('pdfjs-dist', 'cmaps'), out('pdfjs', 'cmaps')],
  [nm('pdfjs-dist', 'standard_fonts'), out('pdfjs', 'standard_fonts')],
  [nm('pdfjs-dist', 'wasm'), out('pdfjs', 'wasm')],
  // tesseract.js : worker, moteurs LSTM mono-thread, modèles français et anglais.
  [nm('tesseract.js', 'dist', 'worker.min.js'), out('tesseract', 'worker.min.js')],
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].map((n) => [
    nm('tesseract.js-core', `${n}.wasm.js`),
    out('tesseract', 'core', `${n}.wasm.js`),
  ]),
  [nm('@tesseract.js-data', 'fra', '4.0.0_best_int', 'fra.traineddata.gz'), out('tesseract', 'lang', 'fra.traineddata.gz')],
  [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), out('tesseract', 'lang', 'eng.traineddata.gz')],
];

await rm(out(), { recursive: true, force: true });
for (const [from, to] of jobs) {
  if (!existsSync(from)) throw new Error(`Ressource introuvable : ${from}`);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}
console.log(`public/vendor : ${jobs.length} ressources copiées.`);
