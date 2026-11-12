// Génère toutes les icônes de l'application à partir du logo (logo_pidielf.png,
// à la racine du dépôt). À relancer si le logo change : node scripts/make-icons.mjs
//
// Le logo source est un carré arrondi posé sur fond noir. On détoure ce fond
// (il devient transparent), puis on décline : icônes de la PWA, icône masquable,
// icône iOS, favicon, logo de l'interface et image du README.
import sharp from 'sharp';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'logo_pidielf.png');

const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const at = (x, y) => (y * width + x) * 3;
const dark = (x, y) => {
  const i = at(x, y);
  return Math.max(data[i], data[i + 1], data[i + 2]) < 48;
};

// 1. Fond : les pixels sombres reliés aux quatre coins (remplissage par diffusion).
const outside = new Uint8Array(width * height);
const stack = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= width || y >= height || outside[y * width + x] || !dark(x, y)) continue;
  outside[y * width + x] = 1;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}

// 2. Masque adouci et légèrement resserré, pour ne garder aucun liseré sombre.
const hard = Buffer.alloc(width * height);
for (let i = 0; i < hard.length; i++) hard[i] = outside[i] ? 0 : 255;
const blurred = await sharp(hard, { raw: { width, height, channels: 1 } }).blur(2.2).raw().toBuffer({ resolveWithObject: true });
const soft = blurred.data;
const step = blurred.info.channels; // sharp peut rendre le masque sur plusieurs canaux
const rgba = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) {
  rgba[i * 4] = data[i * 3];
  rgba[i * 4 + 1] = data[i * 3 + 1];
  rgba[i * 4 + 2] = data[i * 3 + 2];
  rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((soft[i * step] - 170) * 3.4)));
}
const cutout = () => sharp(rgba, { raw: { width, height, channels: 4 } });

// 3. Vert du fond du logo, relevé sur ses bords : il prolonge l'image là où il faut un fond plein.
let r = 0, g = 0, b = 0, n = 0;
for (const [x, y] of [[0.5, 0.06], [0.06, 0.5], [0.94, 0.5], [0.5, 0.94], [0.12, 0.12], [0.88, 0.88]]) {
  const i = at(Math.round(x * width), Math.round(y * height));
  r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
}
const green = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };

const icons = join(root, 'public/icons');
await rm(icons, { recursive: true, force: true });
await mkdir(icons, { recursive: true });
await mkdir(join(root, 'docs'), { recursive: true });

// Palette de 256 couleurs : des icônes nettement plus légères, sans différence visible.
const light = { compressionLevel: 9, palette: true, quality: 92, effort: 10 };
const png = (size) => cutout().resize(size, size).png(light);

// Icônes « any » : le logo détouré, coins transparents.
await png(192).toFile(join(icons, 'logo-192.png'));
await png(512).toFile(join(icons, 'logo-512.png'));
await png(48).toFile(join(icons, 'favicon-48.png'));

// Icône masquable : le système la rogne (cercle, carré arrondi…). Le logo est réduit pour tenir
// dans la zone sûre, sur un fond tiré de lui-même pour que le rognage ne laisse aucun bord vide.
const flat = await cutout().flatten({ background: green }).png().toBuffer();
const backdrop = await sharp(flat).resize(512, 512).blur(28).toBuffer();
await sharp(backdrop)
  .composite([{ input: await cutout().resize(424, 424).png().toBuffer(), gravity: 'centre' }])
  .png(light)
  .toFile(join(icons, 'logo-maskable-512.png'));

// iOS n'accepte pas la transparence et arrondit lui-même les coins : fond plein.
await sharp(flat).resize(180, 180).png(light).toFile(join(icons, 'apple-touch-icon.png'));

// Logo de l'interface (barre latérale, bandeaux) et du README.
await cutout().resize(144, 144).webp({ quality: 88 }).toFile(join(root, 'src/assets/logo.webp'));
await cutout().resize(256, 256).png(light).toFile(join(root, 'docs/logo.png'));

console.log(`Icônes générées (fond relevé : rgb(${green.r}, ${green.g}, ${green.b})).`);
