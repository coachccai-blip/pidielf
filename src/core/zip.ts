// Archives ZIP (exports groupés, sauvegarde de la bibliothèque).
import { unzip, zip, type AsyncZippable, type Unzipped } from 'fflate';
import { uniqueNames } from './naming';

export interface ZipEntry { name: string; data: Uint8Array }

/** Les PDF et images sont déjà compressés : on les range sans recompression (niveau 0). */
export function zipEntries(entries: ZipEntry[], level: 0 | 6 = 0): Promise<Uint8Array> {
  const names = uniqueNames(entries.map((e) => e.name));
  const input: AsyncZippable = {};
  entries.forEach((e, i) => {
    input[names[i]] = [e.data, { level }];
  });
  return new Promise((resolve, reject) => zip(input, (err, data) => (err ? reject(err) : resolve(data))));
}

export function unzipBytes(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => unzip(data, (err, out) => (err ? reject(err) : resolve(out))));
}
