// Images d'un PDF à compresser : lecture des données d'origine (JPEG ou pixels
// bruts) et ré-encodage en JPEG. Le codec est remplaçable : dans le worker il
// s'appuie sur OffscreenCanvas, dans les tests on en injecte un autre.
import { unzlibSync } from 'fflate';

/** Image d'origine : un fichier JPEG complet, ou des pixels 8 bits (gris ou RVB) ligne par ligne. */
export type ImageSource =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number }
  | { kind: 'pixels'; data: Uint8Array; width: number; height: number; channels: 1 | 3 };

export interface EncodedImage {
  /** JPEG à trois composantes (RVB). */
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface ImageCodec {
  /** Réduit l'image pour que son grand côté tienne dans `maxSide`, puis l'encode en JPEG. Null si elle est illisible. */
  recompress(source: ImageSource, target: { maxSide: number; quality: number }): Promise<EncodedImage | null>;
}

/** Taille de l'image après réduction : jamais agrandie, proportions gardées. */
export function fitSide(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toRgba(source: Extract<ImageSource, { kind: 'pixels' }>): Uint8ClampedArray<ArrayBuffer> {
  const { data, channels } = source;
  const count = source.width * source.height;
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const p = i * channels;
    out[i * 4] = data[p];
    out[i * 4 + 1] = data[channels === 3 ? p + 1 : p];
    out[i * 4 + 2] = data[channels === 3 ? p + 2 : p];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Codec du navigateur. Null quand le worker ne dispose pas d'OffscreenCanvas : les images sont alors laissées intactes. */
export function canvasCodec(): ImageCodec | null {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  // Certains navigateurs exposent OffscreenCanvas sans dessin 2D dans un worker : autant le savoir tout de suite.
  if (!new OffscreenCanvas(1, 1).getContext('2d')) return null;
  return {
    async recompress(source, target) {
      // Les échantillons sont repris tels quels : c'est l'espace colorimétrique déclaré dans le PDF qui fait foi.
      const bitmap =
        source.kind === 'jpeg'
          ? await createImageBitmap(new Blob([source.bytes as BlobPart], { type: 'image/jpeg' }), { colorSpaceConversion: 'none' })
          : await createImageBitmap(new ImageData(toRgba(source), source.width, source.height));
      try {
        // Un décodage aux dimensions inattendues (image pivotée par le navigateur…) déformerait la page.
        if (bitmap.width !== source.width || bitmap.height !== source.height) return null;
        const { width, height } = fitSide(bitmap.width, bitmap.height, target.maxSide);
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: target.quality });
        if (blob.type !== 'image/jpeg') return null;
        return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
      } finally {
        bitmap.close();
      }
    },
  };
}

/**
 * En-tête d'un JPEG : dimensions et nombre de composantes. Les blocs EXIF sont
 * retirés du fichier renvoyé, car un navigateur appliquerait leur orientation
 * alors qu'un lecteur PDF l'ignore.
 */
export function readJpeg(bytes: Uint8Array): { width: number; height: number; components: number; bytes: Uint8Array } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const exif: Array<[from: number, to: number]> = [];
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos++; // octet de remplissage
      continue;
    }
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (length < 2 || marker === 0xda) return null;
    // Début d'image : JPEG de base, étendu ou progressif (les seuls que tous les navigateurs décodent).
    if (marker >= 0xc0 && marker <= 0xc2) {
      if (bytes[pos + 4] !== 8) return null;
      const height = (bytes[pos + 5] << 8) | bytes[pos + 6];
      const width = (bytes[pos + 7] << 8) | bytes[pos + 8];
      return { width, height, components: bytes[pos + 9], bytes: without(bytes, exif) };
    }
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)) === 'Exif') exif.push([pos, pos + 2 + length]);
    pos += 2 + length;
  }
  return null;
}

function without(bytes: Uint8Array, ranges: Array<[number, number]>): Uint8Array {
  if (ranges.length === 0) return bytes;
  const out = new Uint8Array(bytes.length - ranges.reduce((sum, [from, to]) => sum + to - from, 0));
  let read = 0;
  let write = 0;
  for (const [from, to] of ranges) {
    out.set(bytes.subarray(read, from), write);
    write += from - read;
    read = to;
  }
  out.set(bytes.subarray(read), write);
  return out;
}

/**
 * Pixels d'une image FlateDecode 8 bits. `predictor` et `columns` viennent de
 * /DecodeParms ; seuls les prédicteurs PNG (10 à 15) sont gérés.
 */
export function inflatePixels(contents: Uint8Array, width: number, height: number, channels: 1 | 3, predictor = 1): Uint8Array | null {
  let data: Uint8Array;
  try {
    data = unzlibSync(contents);
  } catch {
    return null; // flux abîmé ou variante inhabituelle : on n'y touche pas
  }
  const rowBytes = width * channels;
  if (predictor === 1) return data.length >= rowBytes * height ? data.subarray(0, rowBytes * height) : null;
  if (predictor < 10 || data.length < (rowBytes + 1) * height) return null;
  const out = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const type = data[row * (rowBytes + 1)];
    const src = row * (rowBytes + 1) + 1;
    const dst = row * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= channels ? out[dst + i - channels] : 0;
      const up = row > 0 ? out[dst + i - rowBytes] : 0;
      const upLeft = row > 0 && i >= channels ? out[dst + i - rowBytes - channels] : 0;
      let predicted: number;
      if (type === 0) predicted = 0;
      else if (type === 1) predicted = left;
      else if (type === 2) predicted = up;
      else if (type === 3) predicted = (left + up) >> 1;
      else if (type === 4) predicted = paeth(left, up, upLeft);
      else return null;
      out[dst + i] = (data[src + i] + predicted) & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
