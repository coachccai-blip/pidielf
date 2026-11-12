// Images dans le navigateur : décodage (orientation EXIF, HEIC), passage par un
// canvas, et préparation des fichiers placés dans un PDF.
import { useEffect, useRef, useState } from 'react';
import { ToolError } from '@/core/errors';
import { readJpegInfo } from '@/core/image/jpeg';
import { fitWithin, type CanvasLimits } from '@/core/image/size';

/** Téléphone : petit écran tactile, mémoire comptée. */
export function isSmallDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
}

/**
 * Taille maximale d'un canvas. Safari sur iPhone refuse plus de 16,7 millions
 * de pixels ; on garde de la marge, la mémoire d'un téléphone étant partagée.
 */
export function canvasLimits(): CanvasLimits {
  return isSmallDevice() ? { maxArea: 12_000_000, maxSide: 8192 } : { maxArea: 32_000_000, maxSide: 16_000 };
}

/** `heic` : le décodeur HEIC a échoué ; `unsupported` : format illisible ou fichier abîmé. */
export type DecodeFailure = 'heic' | 'unsupported';

export class ImageDecodeError extends Error {
  reason: DecodeFailure;
  constructor(reason: DecodeFailure, message?: string) {
    super(message ?? reason);
    this.name = 'ImageDecodeError';
    this.reason = reason;
  }
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Reconnaît un fichier HEIC/HEIF à son en-tête : le type annoncé par le système est souvent vide. */
async function isHeic(blob: Blob, name: string): Promise<boolean> {
  if (/^image\/hei[cf]/i.test(blob.type) || /\.hei[cf]$/i.test(name)) return true;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.slice(4, 8) === 'ftyp' && HEIC_BRANDS.has(text.slice(8, 12));
}

async function decodeNatively(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    /* option refusée ou format inconnu : on essaie par un élément <img> */
  }
  const url = URL.createObjectURL(blob);
  try {
    // Un élément <img> applique lui aussi l'orientation EXIF.
    const img = new Image();
    img.src = url;
    await img.decode();
    return await createImageBitmap(img);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Décode une image en respectant son orientation EXIF. Les HEIC sont d'abord
 * confiés au navigateur (Safari les lit) ; à défaut, le décodeur libheif est
 * chargé à la demande, dans son propre fichier.
 */
export async function decodeImage(blob: Blob, name = ''): Promise<ImageBitmap> {
  const native = await decodeNatively(blob);
  if (native) return native;
  if (!(await isHeic(blob, name))) throw new ImageDecodeError('unsupported');
  try {
    const { heicTo } = await import('heic-to/csp');
    return await heicTo({ blob, type: 'bitmap' });
  } catch (err) {
    throw new ImageDecodeError('heic', String((err as Error)?.message ?? err));
  }
}

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface DrawOptions extends Partial<CanvasLimits> {
  /** Rotation dans le sens horaire. */
  rotation?: QuarterTurn;
  /** Couleur de fond, pour les images transparentes destinées au JPEG. */
  background?: string;
}

/** Dessine une image dans un nouveau canvas, réduite si elle dépasse les limites, tournée au besoin. */
export function drawToCanvas(source: ImageBitmap | HTMLCanvasElement, options: DrawOptions = {}): HTMLCanvasElement {
  const { width, height } = fitWithin(source.width, source.height, options);
  const rotation = options.rotation ?? 0;
  const quarter = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = quarter ? height : width;
  canvas.height = quarter ? width : height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas indisponible');
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(source, -width / 2, -height / 2, width, height);
  return canvas;
}

/** Rend tout de suite la mémoire d'un canvas, sans attendre le ramasse-miettes. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Pixels d'un canvas entier. */
export function readPixels(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas indisponible');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Canvas rempli avec des pixels RVBA bruts. */
export function pixelsToCanvas(data: Uint8Array | Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pixels = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

/** Parcourt les pixels d'un canvas par bandes, pour ne jamais doubler sa mémoire. */
export function scanPixels(canvas: HTMLCanvasElement, visit: (pixels: Uint32Array) => void): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas indisponible');
  const band = Math.max(1, Math.floor(1_000_000 / canvas.width));
  for (let y = 0; y < canvas.height; y += band) {
    const { data } = ctx.getImageData(0, y, canvas.width, Math.min(band, canvas.height - y));
    visit(new Uint32Array(data.buffer));
  }
}

/** Vrai si au moins un pixel n'est pas opaque. */
export function hasTransparency(canvas: HTMLCanvasElement): boolean {
  let transparent = false;
  scanPixels(canvas, (pixels) => {
    if (transparent) return;
    // L'alpha est l'octet de poids fort (tous les navigateurs tournent en petit-boutiste).
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] >>> 24 !== 255) {
        transparent = true;
        return;
      }
    }
  });
  return transparent;
}

/** Encode un canvas. Un échec signifie que le canvas n'a pas pu être alloué : trop grand pour l'appareil. */
export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ToolError('memory', 'canvas vide'))), type, quality));
}

let webp: Promise<boolean> | null = null;

/** Vrai si ce navigateur sait réellement écrire du WebP (certains renvoient un PNG à la place). */
export function supportsWebp(): Promise<boolean> {
  webp ??= (async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    canvas.getContext('2d')?.fillRect(0, 0, 2, 2);
    try {
      return (await canvasBlob(canvas, 'image/webp', 0.8)).type === 'image/webp';
    } catch {
      return false;
    }
  })();
  return webp;
}

// ---- Préparation pour un PDF ----------------------------------------------------

/** Qualité des JPEG produits quand une conversion est nécessaire. */
const JPEG_QUALITY = 0.9;
const THUMB_SIDE = 480;

export interface PreparedImage {
  /** Fichier prêt à être placé dans le PDF : JPEG ou PNG. */
  blob: Blob;
  mime: 'image/jpeg' | 'image/png';
  /** Dimensions en pixels, orientation appliquée. */
  width: number;
  height: number;
  /** Vrai si le fichier d'origine a dû être converti (WebP, HEIC, photo tournée…). */
  converted: boolean;
  /** Vignette (URL d'objet, à libérer avec `releasePrepared`). */
  thumbUrl: string;
}

const startsWith = (bytes: Uint8Array, ...magic: number[]): boolean => magic.every((b, i) => bytes[i] === b);

/**
 * Prépare une image pour « Images en PDF ». Un JPEG dont l'orientation est
 * normale et un PNG sont repris tels quels ; tout le reste (WebP, HEIC, JPEG
 * tourné par EXIF, CMJN…) passe par un canvas : PNG s'il y a de la
 * transparence, JPEG sinon.
 */
export async function prepareForPdf(file: { blob: Blob; name: string }): Promise<PreparedImage> {
  const bitmap = await decodeImage(file.blob, file.name);
  try {
    const { width, height } = bitmap;
    const thumb = drawToCanvas(bitmap, { maxSide: THUMB_SIDE, background: '#ffffff' });
    const thumbUrl = URL.createObjectURL(await canvasBlob(thumb, 'image/jpeg', 0.8));
    releaseCanvas(thumb);

    const head = new Uint8Array(await file.blob.slice(0, 8).arrayBuffer());
    const isJpeg = startsWith(head, 0xff, 0xd8, 0xff);
    if (isJpeg) {
      const info = readJpegInfo(new Uint8Array(await file.blob.arrayBuffer()));
      if (info && info.orientation === 1 && info.components !== 4 && info.width === width && info.height === height) {
        return { blob: file.blob, mime: 'image/jpeg', width, height, converted: false, thumbUrl };
      }
    } else if (startsWith(head, 0x89, 0x50, 0x4e, 0x47)) {
      return { blob: file.blob, mime: 'image/png', width, height, converted: false, thumbUrl };
    }

    const canvas = drawToCanvas(bitmap, canvasLimits());
    try {
      const mime = !isJpeg && hasTransparency(canvas) ? 'image/png' : 'image/jpeg';
      const blob = await canvasBlob(canvas, mime, JPEG_QUALITY);
      return { blob, mime, width: canvas.width, height: canvas.height, converted: true, thumbUrl };
    } catch (err) {
      URL.revokeObjectURL(thumbUrl);
      throw err;
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    bitmap.close();
  }
}

export function releasePrepared(image: PreparedImage): void {
  URL.revokeObjectURL(image.thumbUrl);
}

// ---- Chargement d'une liste d'images ----------------------------------------------

export type Loaded<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; reason: DecodeFailure };

/**
 * Charge une valeur par fichier (vignette, image décodée…), un fichier à la
 * fois pour ménager la mémoire. Un échec ne touche que le fichier concerné.
 * `load` et `dispose` doivent être stables (fonctions de module).
 */
export function useLoadedImages<T>(
  files: Array<{ key: string; blob: Blob; name: string }>,
  load: (file: { blob: Blob; name: string }) => Promise<T>,
  dispose: (value: T) => void,
): Record<string, Loaded<T>> {
  const [state, setState] = useState<Record<string, Loaded<T>>>({});
  const entries = useRef(new Map<string, Loaded<T>>());
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const cache = entries.current;
    const drop = (key: string) => {
      const entry = cache.get(key);
      if (entry?.status === 'ready') dispose(entry.value);
      cache.delete(key);
    };
    const keys = new Set(files.map((f) => f.key));
    for (const key of [...cache.keys()]) if (!keys.has(key)) drop(key);
    for (const file of files) {
      if (cache.has(file.key)) continue;
      const pending: Loaded<T> = { status: 'loading' };
      cache.set(file.key, pending);
      queue.current = queue.current.then(async () => {
        if (cache.get(file.key) !== pending) return; // retiré entre-temps
        let entry: Loaded<T>;
        try {
          entry = { status: 'ready', value: await load(file) };
        } catch (err) {
          entry = { status: 'error', reason: err instanceof ImageDecodeError ? err.reason : 'unsupported' };
        }
        if (cache.get(file.key) !== pending) {
          if (entry.status === 'ready') dispose(entry.value);
          return;
        }
        cache.set(file.key, entry);
        setState(Object.fromEntries(cache));
      });
    }
    setState(Object.fromEntries(cache));
  }, [files, load, dispose]);

  // À la fermeture de l'outil, tout est libéré.
  useEffect(() => {
    const cache = entries.current;
    return () => {
      for (const entry of cache.values()) if (entry.status === 'ready') dispose(entry.value);
      cache.clear();
    };
  }, [dispose]);

  return state;
}
