// Protéger et déverrouiller (exécutés dans le worker).
import { ToolError } from '../errors';
import { qpdfDecrypt, qpdfEncrypt, qpdfInspect, type EncryptionInfo, type EncryptOptions } from '../qpdf';

// Un PDF protégé annonce toujours /Encrypt en clair (dans sa fin de fichier ou sa table de références).
const ENCRYPT_MARK = [...'/Encrypt'].map((c) => c.charCodeAt(0));
function mentionsEncrypt(bytes: Uint8Array): boolean {
  for (let i = bytes.indexOf(ENCRYPT_MARK[0]); i !== -1; i = bytes.indexOf(ENCRYPT_MARK[0], i + 1)) {
    if (ENCRYPT_MARK.every((code, k) => bytes[i + k] === code)) return true;
  }
  return false;
}

export async function encryptPdf(params: { bytes: Uint8Array } & EncryptOptions): Promise<Uint8Array> {
  // Rechiffrer un fichier déjà protégé remplacerait ses restrictions sans le mot de passe propriétaire.
  if (mentionsEncrypt(params.bytes) && (await qpdfInspect(params.bytes)).encrypted) throw new ToolError('encrypted');
  return qpdfEncrypt(params.bytes, params);
}

export function decryptPdf(params: { bytes: Uint8Array; password: string }): Promise<Uint8Array> {
  return qpdfDecrypt(params.bytes, params.password);
}

/** Décrit la protection d'un PDF : chiffré ou non, mot de passe nécessaire, rôle du mot de passe fourni. */
export function inspectEncryption(params: { bytes: Uint8Array; password?: string }): Promise<EncryptionInfo> {
  return qpdfInspect(params.bytes, params.password);
}

export type UnlockResult =
  | { status: 'unlocked'; bytes: Uint8Array; pageCount?: number }
  | { status: 'not-encrypted' | 'bad-password' | 'owner-required' };

/**
 * Retire la protection avec un mot de passe que l'utilisateur connaît — et
 * seulement dans ce cas. Un fichier qui s'ouvre librement mais porte des
 * restrictions exige le mot de passe propriétaire : sans lui, lever les
 * restrictions reviendrait à les contourner.
 */
export async function unlockPdf(params: { bytes: Uint8Array; password: string }): Promise<UnlockResult> {
  let info: EncryptionInfo;
  try {
    info = await qpdfInspect(params.bytes, params.password);
  } catch (err) {
    if (err instanceof ToolError && err.code === 'bad-password') return { status: 'bad-password' };
    throw err;
  }
  if (!info.encrypted) return { status: 'not-encrypted' };
  if (info.needsPassword) return { status: 'bad-password' };
  // Mot de passe vide accepté comme simple mot de passe d'ouverture : le fichier s'ouvre sans rien savoir.
  if (info.passwordRole !== 'owner' && params.password === '') return { status: 'owner-required' };
  return { status: 'unlocked', bytes: await qpdfDecrypt(params.bytes, params.password), pageCount: info.pageCount };
}
