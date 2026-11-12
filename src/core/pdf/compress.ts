// Compresser : allège un PDF sans jamais transformer les pages en images.
// Les photos sont ré-encodées en JPEG (et réduites selon le niveau), les flux
// non compressés sont compactés, les objets devenus inutiles sont retirés. Le
// texte et les tracés ne sont pas touchés.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFContext, type PDFObject } from '@cantoo/pdf-lib';
import { zlibSync } from 'fflate';
import type { Progress } from '@/workers/protocol';
import { loadPdf, savePdf } from './load';
import { canvasCodec, inflatePixels, readJpeg, type EncodedImage, type ImageCodec, type ImageSource } from './compressImages';

export type CompressLevel = 'light' | 'balanced' | 'strong';

/** Qualité JPEG et taille maximale du grand côté des images, pour chaque niveau. */
export const COMPRESS_LEVELS: Record<CompressLevel, { quality: number; maxSide: number }> = {
  light: { quality: 0.85, maxSide: 2400 },
  balanced: { quality: 0.7, maxSide: 1600 },
  strong: { quality: 0.5, maxSide: 1100 },
};

export interface CompressResult {
  /** Le PDF allégé, ou le fichier d'origine intact quand il n'y a rien à gagner. */
  bytes: Uint8Array;
  /** Faux : `bytes` est le fichier d'origine. */
  changed: boolean;
  /** Images trouvées dans le document (sans compter leurs masques de transparence). */
  images: number;
  /** Images effectivement remplacées par une version plus légère. */
  recompressed: number;
  /** Faux : ce navigateur ne sait pas ré-encoder les images dans un worker. */
  codec: boolean;
}

/** En dessous, le gain ne justifie pas de réécrire le fichier. */
const MIN_GAIN = 0.005;
/** Une image minuscule ne vaut pas un ré-encodage. */
const MIN_IMAGE_BYTES = 4096;

const name = (key: string) => PDFName.of(key);
const nameOf = (obj: PDFObject | undefined): string | undefined => (obj instanceof PDFName ? obj.decodeText() : undefined);
const numberOf = (obj: PDFObject | undefined): number | undefined => (obj instanceof PDFNumber ? obj.asNumber() : undefined);

export async function compressPdf(
  params: { bytes: Uint8Array; level: CompressLevel },
  progress?: Progress,
  codec: ImageCodec | null = canvasCodec(),
): Promise<CompressResult> {
  const doc = await loadPdf(params.bytes);
  const { context } = doc;
  const target = COMPRESS_LEVELS[params.level] ?? COMPRESS_LEVELS.balanced;
  const objects = context.enumerateIndirectObjects();
  const images = objects.filter((entry): entry is [PDFRef, PDFRawStream] => entry[1] instanceof PDFRawStream && nameOf(entry[1].dict.lookup(name('Subtype'))) === 'Image');

  // Les masques (transparence) restent tels quels : une compression avec perte abîmerait les contours.
  const masks = new Set<PDFRef>();
  for (const [, image] of images) {
    for (const key of ['SMask', 'Mask']) {
      const mask = image.dict.get(name(key));
      if (mask instanceof PDFRef) masks.add(mask);
    }
  }

  let recompressed = 0;
  for (const [i, [ref, image]] of images.entries()) {
    progress?.(i / (images.length + 1));
    if (!codec || masks.has(ref)) continue;
    const source = imageSource(image);
    if (!source) continue;
    let encoded: EncodedImage | null = null;
    try {
      encoded = await codec.recompress(source, target);
    } catch {
      // image illisible ou trop grande pour la mémoire : elle reste telle quelle
    }
    // On ne remplace que si l'on y gagne.
    if (!encoded || encoded.bytes.length >= image.contents.length) continue;
    const dict = image.dict.clone(context);
    dict.set(name('Width'), PDFNumber.of(encoded.width));
    dict.set(name('Height'), PDFNumber.of(encoded.height));
    dict.set(name('BitsPerComponent'), PDFNumber.of(8));
    dict.set(name('Filter'), name('DCTDecode'));
    dict.delete(name('DecodeParms'));
    // Le JPEG produit a trois composantes : une image en niveaux de gris devient RVB.
    if (channelsOf(image.dict) === 1) dict.set(name('ColorSpace'), name('DeviceRGB'));
    context.assign(ref, PDFRawStream.of(dict, encoded.bytes));
    recompressed++;
  }

  deflatePlainStreams(context);
  dropUnreachable(context);
  const bytes = await savePdf(doc);
  progress?.(1);
  const changed = params.bytes.length - bytes.length > params.bytes.length * MIN_GAIN;
  return { bytes: changed ? bytes : params.bytes, changed, images: images.filter(([ref]) => !masks.has(ref)).length, recompressed, codec: codec !== null };
}

/** Nombre de composantes d'un espace colorimétrique simple (gris ou RVB, avec ou sans profil ICC). */
function channelsOf(dict: PDFDict): 1 | 3 | null {
  const space = dict.lookup(name('ColorSpace'));
  let channels: number | undefined;
  if (space instanceof PDFName) channels = { DeviceRGB: 3, DeviceGray: 1 }[space.decodeText()];
  else if (space instanceof PDFArray && nameOf(space.lookup(0)) === 'ICCBased') {
    const profile = space.lookup(1);
    if (profile instanceof PDFStream) channels = numberOf(profile.dict.lookup(name('N')));
  }
  return channels === 1 || channels === 3 ? channels : null;
}

/** Données d'une image que l'on sait ré-encoder sans risque ; null pour toutes les autres (dans le doute, on s'abstient). */
function imageSource(image: PDFRawStream): ImageSource | null {
  const { dict, contents } = image;
  if (contents.length < MIN_IMAGE_BYTES) return null;
  // Masques, transparence par couleur, valeurs inversées : un JPEG ne peut pas les reproduire.
  if (['ImageMask', 'Mask', 'Decode', 'SMaskInData'].some((key) => dict.has(name(key)))) return null;
  // Masque à alpha prémultiplié : l'image doit garder exactement ses dimensions et ses valeurs.
  const softMask = dict.lookup(name('SMask'));
  if (softMask instanceof PDFStream && softMask.dict.has(name('Matte'))) return null;
  if (numberOf(dict.lookup(name('BitsPerComponent'))) !== 8) return null;
  const width = numberOf(dict.lookup(name('Width')));
  const height = numberOf(dict.lookup(name('Height')));
  const channels = channelsOf(dict);
  if (!width || !height || !channels) return null;

  let filter = dict.lookup(name('Filter'));
  if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : undefined;
  const parms = dict.lookup(name('DecodeParms'));
  if (nameOf(filter) === 'DCTDecode') {
    if (parms) return null;
    const jpeg = readJpeg(contents);
    if (!jpeg || jpeg.width !== width || jpeg.height !== height || jpeg.components !== channels) return null;
    return { kind: 'jpeg', bytes: jpeg.bytes, width, height };
  }
  if (nameOf(filter) === 'FlateDecode') {
    let predictor = 1;
    if (parms instanceof PDFDict) {
      predictor = numberOf(parms.lookup(name('Predictor'))) ?? 1;
      const colors = numberOf(parms.lookup(name('Colors'))) ?? 1;
      const columns = numberOf(parms.lookup(name('Columns'))) ?? 1;
      const bits = numberOf(parms.lookup(name('BitsPerComponent'))) ?? 8;
      if (predictor > 1 && (colors !== channels || columns !== width || bits !== 8)) return null;
    } else if (parms) return null;
    const data = inflatePixels(contents, width, height, channels, predictor);
    return data && { kind: 'pixels', data, width, height, channels };
  }
  return null;
}

/** Compacte les flux enregistrés sans aucune compression (fréquent dans les PDF produits par de vieux logiciels). */
function deflatePlainStreams(context: PDFContext): void {
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.has(name('Filter')) || object.contents.length < 256) continue;
    // Les métadonnées XMP restent lisibles en clair, comme le veut l'usage.
    if (nameOf(object.dict.lookup(name('Type'))) === 'Metadata') continue;
    const packed = zlibSync(object.contents, { level: 6 });
    if (packed.length >= object.contents.length) continue;
    const dict = object.dict.clone(context);
    dict.set(name('Filter'), name('FlateDecode'));
    dict.delete(name('DecodeParms'));
    context.assign(ref, PDFRawStream.of(dict, packed));
  }
}

/** Retire les objets que plus rien ne référence (restes de pages supprimées, d'anciennes versions…). */
function dropUnreachable(context: PDFContext): void {
  const reached = new Set<PDFRef>();
  const pending: Array<PDFObject | undefined> = Object.values(context.trailerInfo);
  while (pending.length > 0) {
    const object = pending.pop();
    if (object instanceof PDFRef) {
      if (reached.has(object)) continue;
      reached.add(object);
      pending.push(context.lookup(object));
    } else if (object instanceof PDFDict) object.values().forEach((value) => pending.push(value));
    else if (object instanceof PDFArray) object.asArray().forEach((value) => pending.push(value));
    else if (object instanceof PDFStream) pending.push(object.dict);
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref)) context.delete(ref);
  }
}
