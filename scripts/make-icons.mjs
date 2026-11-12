// Génère les icônes PWA à partir du logo (à relancer si le logo change).
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logo = (await readFile(join(root, 'src/assets/logo.svg'), 'utf8'))
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '');

/** `pad` : part du côté occupée par le logo (zone sûre des icônes masquables : 80 %). */
const icon = (scale, radius) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="g" cx="50%" cy="35%" r="75%">
      <stop offset="0" stop-color="#FFFDF6"/><stop offset="1" stop-color="#F4E7B8"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  <g transform="translate(${256 - 32 * scale} ${256 - 32 * scale}) scale(${scale})" fill="none">${logo}</g>
</svg>`;

const outDir = join(root, 'public/icons');
await mkdir(outDir, { recursive: true });
const render = (svg, size, name) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(outDir, name));

await render(icon(6.2, 112), 192, 'icon-192.png');
await render(icon(6.2, 112), 512, 'icon-512.png');
await render(icon(4.6, 0), 512, 'icon-maskable-512.png');
await render(icon(5.6, 0), 180, 'apple-touch-icon.png');
await writeFile(join(outDir, 'favicon.svg'), await readFile(join(root, 'src/assets/logo.svg')));
console.log('Icônes générées dans public/icons.');
