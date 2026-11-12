// Protéger et déverrouiller (exécutés dans le worker).
import { qpdfDecrypt, qpdfEncrypt, type EncryptOptions } from '../qpdf';

export function encryptPdf(params: { bytes: Uint8Array } & EncryptOptions): Promise<Uint8Array> {
  return qpdfEncrypt(params.bytes, params);
}

export function decryptPdf(params: { bytes: Uint8Array; password: string }): Promise<Uint8Array> {
  return qpdfDecrypt(params.bytes, params.password);
}
