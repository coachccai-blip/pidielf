// Extraction des images contenues dans un PDF. pdf.js fournit les images déjà
// décodées (pixels) : on les recode donc en PNG ou en JPEG ; ce ne sont pas
// les flux d'origine du fichier.
import { canvasBlob, hasTransparency, releaseCanvas, scanPixels } from '@/lib/images';
import { loadPdfjs, type PDFPageProxy } from '@/lib/pdfjs';

/** En dessous de cette taille (en pixels), une image est tenue pour une décoration. */
const SMALL_SIDE = 32;
/** Au-delà d'un million de pixels, une image opaque est écrite en JPEG plutôt qu'en PNG. */
const JPEG_FROM = 1_000_000;
const JPEG_QUALITY = 0.92;

/** Image telle que pdf.js la transmet au fil principal. */
interface DecodedImage {
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  data?: Uint8Array | Uint8ClampedArray;
  /** 1 : un bit par pixel ; 2 : RVB ; 3 : RVBA. */
  kind?: number;
}

export interface ExtractedImage {
  blob: Blob;
  ext: 'png' | 'jpg';
  width: number;
  height: number;
}

/** Mémoire d'une extraction : identifiants et empreintes des images déjà vues, pour écarter les doublons. */
export interface ExtractMemory {
  ids: Set<string>;
  hashes: Set<string>;
}

export const newMemory = (): ExtractMemory => ({ ids: new Set(), hashes: new Set() });

/** Attend qu'une image annoncée par la liste d'opérations soit arrivée du worker de pdf.js. */
function resolveObject(page: PDFPageProxy, id: string): Promise<DecodedImage | null> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  if (store.has(id)) return Promise.resolve(store.get(id) as DecodedImage | null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 15_000);
    const done = (value: DecodedImage | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    store.get(id, (value: unknown) => done(value as DecodedImage | null), () => done(null));
  });
}

/** Copie l'image dans un canvas. Un masque (pochoir 1 bit) est dessiné en noir sur fond blanc. */
function toCanvas(image: DecodedImage, mask: boolean): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (image.bitmap) {
    if (mask) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image.bitmap, 0, 0);
    return canvas;
  }
  if (!image.data || mask) return null;
  const out = ctx.createImageData(image.width, image.height);
  const src = image.data;
  const dest = out.data;
  const count = image.width * image.height;
  if (image.kind === 3) {
    dest.set(src.subarray(0, count * 4));
  } else if (image.kind === 2) {
    for (let i = 0, s = 0, d = 0; i < count; i++, s += 3, d += 4) {
      dest[d] = src[s];
      dest[d + 1] = src[s + 1];
      dest[d + 2] = src[s + 2];
      dest[d + 3] = 255;
    }
  } else if (image.kind === 1) {
    const rowBytes = (image.width + 7) >> 3;
    for (let y = 0, d = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++, d += 4) {
        const v = src[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0;
        dest[d] = dest[d + 1] = dest[d + 2] = v;
        dest[d + 3] = 255;
      }
    }
  } else {
    return null;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Empreinte des pixels : deux sommes de contrôle indépendantes, pour reconnaître une image réutilisée. */
function fingerprint(canvas: HTMLCanvasElement): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  scanPixels(canvas, (pixels) => {
    for (let i = 0; i < pixels.length; i++) {
      a = Math.imul(a ^ pixels[i], 0x01000193);
      b = Math.imul(b + pixels[i], 0x85ebca6b) ^ (b >>> 15);
    }
  });
  return `${canvas.width}x${canvas.height}:${a >>> 0}:${b >>> 0}`;
}

/**
 * Images peintes par une page, dans l'ordre du contenu, sans celles déjà
 * rencontrées (même objet, ou mêmes pixels sur une autre page).
 */
export async function extractPageImages(page: PDFPageProxy, options: { skipSmall: boolean; memory: ExtractMemory }): Promise<ExtractedImage[]> {
  const { OPS } = await loadPdfjs();
  const list = await page.getOperatorList();
  const found: ExtractedImage[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const arg = (list.argsArray[i] as unknown[] | null)?.[0];
    let image: DecodedImage | null = null;
    let mask = false;
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      if (typeof arg !== 'string' || options.memory.ids.has(arg)) continue;
      options.memory.ids.add(arg);
      image = await resolveObject(page, arg);
    } else if (fn === OPS.paintInlineImageXObject) {
      image = arg as DecodedImage;
    } else if (fn === OPS.paintImageMaskXObject) {
      // Pochoir 1 bit (certains scans en noir et blanc) : soit en ligne, soit désigné par un identifiant.
      mask = true;
      const ref = arg as (DecodedImage & { data?: unknown }) | undefined;
      if (typeof ref?.data === 'string') {
        if (options.memory.ids.has(ref.data)) continue;
        options.memory.ids.add(ref.data);
        image = await resolveObject(page, ref.data);
      } else {
        image = ref ?? null;
      }
    } else {
      continue;
    }
    if (!image?.width || !image.height) continue;
    if (options.skipSmall && (image.width < SMALL_SIDE || image.height < SMALL_SIDE)) continue;

    const canvas = toCanvas(image, mask);
    if (!canvas) continue;
    try {
      const hash = fingerprint(canvas);
      if (options.memory.hashes.has(hash)) continue;
      options.memory.hashes.add(hash);
      const jpeg = image.width * image.height >= JPEG_FROM && !hasTransparency(canvas);
      const blob = await canvasBlob(canvas, jpeg ? 'image/jpeg' : 'image/png', JPEG_QUALITY);
      found.push({ blob, ext: jpeg ? 'jpg' : 'png', width: image.width, height: image.height });
    } finally {
      releaseCanvas(canvas);
    }
  }
  page.cleanup();
  return found;
}
