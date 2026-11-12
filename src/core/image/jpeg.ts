// Lecture de l'en-tête d'un JPEG : dimensions et orientation EXIF. Permet de
// savoir si le fichier peut être placé tel quel dans un PDF, sans recompression.

export interface JpegInfo {
  width: number;
  height: number;
  /** Orientation EXIF, de 1 (normale) à 8. */
  orientation: number;
  /** Nombre de composantes : 1 (gris), 3 (couleur) ou 4 (CMJN). */
  components: number;
}

/** Orientation lue dans un segment APP1 « Exif » ; 1 si elle n'est pas indiquée. */
function exifOrientation(view: DataView, start: number, length: number): number {
  // « Exif\0\0 » puis un en-tête TIFF : ordre des octets, 42, décalage du premier répertoire.
  if (length < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return 1;
  const tiff = start + 6;
  const end = start + length;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const little = order === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Renvoie null si les octets ne sont pas ceux d'un JPEG lisible. */
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let orientation = 1;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos++; // octets de remplissage entre deux segments
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // début des données sans avoir vu les dimensions
    const length = view.getUint16(pos + 2);
    if (length < 2 || pos + 2 + length > bytes.length) return null;
    if (marker === 0xe1) {
      orientation = exifOrientation(view, pos + 4, length - 2);
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) return null;
      return { height: view.getUint16(pos + 5), width: view.getUint16(pos + 7), components: bytes[pos + 9], orientation };
    }
    pos += 2 + length;
  }
  return null;
}
