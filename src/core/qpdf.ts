// qpdf (WebAssembly, mono-thread) : chiffrement AES 256 bits et déverrouillage.
// pdf.js sait lire un PDF protégé, mais seul qpdf sait le réécrire proprement.
import createQpdf from '@neslinesli93/qpdf-wasm';
import { ToolError } from './errors';

let wasmUrl: string | undefined;

/** Indique où trouver qpdf.wasm (URL dans le navigateur, chemin sous Node). */
export function setQpdfWasmUrl(url: string): void {
  wasmUrl = url;
}

interface QpdfModule {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
}

interface QpdfRun { qpdf: QpdfModule; output: () => string }

async function instantiate(input: Uint8Array): Promise<QpdfRun> {
  const factory = createQpdf as unknown as (options: Record<string, unknown>) => Promise<QpdfModule>;
  const chars: number[] = [];
  const capture = (c: number | null) => {
    if (c !== null) chars.push((c + 256) % 256);
  };
  // Une instance neuve par appel : l'état d'un programme C ne survit pas proprement à main().
  const qpdf = await factory({
    ...(wasmUrl ? { locateFile: () => wasmUrl } : {}),
    noInitialRun: true,
    // Capture les messages de qpdf (stdout et stderr) pour reconnaître les erreurs.
    preRun: [(m: { FS: { init: (i: null, o: typeof capture, e: typeof capture) => void } }) => m.FS.init(null, capture, capture)],
  });
  qpdf.FS.writeFile('/in.pdf', input);
  return { qpdf, output: () => new TextDecoder().decode(new Uint8Array(chars)) };
}

/** Lance qpdf et renvoie son code de sortie avec ce qu'il a écrit. */
async function exec(args: string[], input: Uint8Array): Promise<QpdfRun & { code: number }> {
  const run = await instantiate(input);
  try {
    return { ...run, code: run.qpdf.callMain(args) };
  } catch (err) {
    // Emscripten signale exit() par une exception portant le code de sortie.
    const status = (err as { status?: number }).status;
    if (typeof status !== 'number') throw err;
    return { ...run, code: status };
  }
}

const succeeded = (code: number): boolean => code === 0 || code === 3;

// Les messages de qpdf peuvent citer le mot de passe d'ouverture : il ne doit jamais sortir d'ici.
const scrub = (text: string): string => text.replace(/^User password.*$/gm, '').trim();

/**
 * Lance qpdf sur un fichier et renvoie le résultat.
 * Codes de sortie : 0 succès, 3 succès avec avertissements, 2 erreur.
 */
export async function runQpdf(args: string[], input: Uint8Array): Promise<Uint8Array> {
  const { qpdf, output, code } = await exec([...args, '/in.pdf', '/out.pdf'], input);
  if (!succeeded(code)) {
    const text = output();
    if (/invalid password/i.test(text)) throw new ToolError('bad-password');
    throw new ToolError('damaged', scrub(text) || `qpdf a échoué (code ${code})`);
  }
  try {
    return qpdf.FS.readFile('/out.pdf');
  } catch {
    throw new ToolError('damaged', scrub(output()) || 'qpdf n’a produit aucun fichier');
  }
}

export interface Permissions {
  /** Autoriser l'impression. */
  print: boolean;
  /** Autoriser la copie de texte et d'images. */
  copy: boolean;
  /** Autoriser la modification (contenu, annotations, formulaires, assemblage). */
  modify: boolean;
}

export interface EncryptOptions {
  /** Mot de passe demandé à l'ouverture. */
  userPassword: string;
  /** Mot de passe propriétaire, qui lève les restrictions. */
  ownerPassword: string;
  permissions: Permissions;
}

/** Protège un PDF par mot de passe (AES 256 bits, PDF 2.0 / révision 6). */
export function qpdfEncrypt(bytes: Uint8Array, options: EncryptOptions): Promise<Uint8Array> {
  const { print, copy, modify } = options.permissions;
  return runQpdf(
    [
      '--encrypt',
      // Forme nommée : un mot de passe qui commence par « -- » n'est pas pris pour une option.
      `--user-password=${options.userPassword}`,
      `--owner-password=${options.ownerPassword}`,
      '--bits=256',
      `--print=${print ? 'full' : 'none'}`,
      `--extract=${copy ? 'y' : 'n'}`,
      `--modify=${modify ? 'all' : 'none'}`,
      '--',
    ],
    bytes,
  );
}

/** Retire la protection d'un PDF dont on connaît le mot de passe. Ne devine ni ne contourne rien. */
export function qpdfDecrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return runQpdf([`--password=${password}`, '--decrypt'], bytes);
}

export interface EncryptionInfo {
  encrypted: boolean;
  /** Le fichier ne s'ouvre pas sans mot de passe (et aucun n'a été fourni). */
  needsPassword: boolean;
  /** Ce que vaut le mot de passe fourni — ou le mot de passe vide s'il n'y en a pas. */
  passwordRole?: 'user' | 'owner';
  /** Ce que le fichier autorise à qui l'ouvre sans le mot de passe propriétaire. */
  permissions?: Permissions;
  /** Au moins une restriction est posée (impression, copie, modification, formulaires…). */
  restricted?: boolean;
  /** Algorithme de chiffrement annoncé par qpdf : « AESv3 » (256 bits), « AESv2 », « RC4 ». */
  method?: string;
  pageCount?: number;
}

/**
 * Décrit la protection d'un PDF, sans rien modifier. Avec un mauvais mot de
 * passe : erreur `bad-password`.
 */
export async function qpdfInspect(bytes: Uint8Array, password?: string): Promise<EncryptionInfo> {
  const { output, code } = await exec([...(password ? [`--password=${password}`] : []), '--show-encryption', '--show-npages', '/in.pdf'], bytes);
  const text = output();
  if (!succeeded(code)) {
    if (!/invalid password/i.test(text)) throw new ToolError('damaged', scrub(text) || `qpdf a échoué (code ${code})`);
    if (password) throw new ToolError('bad-password');
    return { encrypted: true, needsPassword: true };
  }
  const pages = /^(\d+)$/m.exec(text);
  const pageCount = pages ? Number(pages[1]) : undefined;
  if (/File is not encrypted/i.test(text)) return { encrypted: false, needsPassword: false, pageCount };
  const allowed = (what: string) => new RegExp(`^${what}: allowed`, 'm').test(text);
  return {
    encrypted: true,
    needsPassword: false,
    // Quand un même mot de passe tient les deux rôles, qpdf l'annonce deux fois : propriétaire l'emporte.
    passwordRole: /Supplied password is owner password/.test(text) ? 'owner' : 'user',
    permissions: { print: allowed('print high resolution'), copy: allowed('extract for any purpose'), modify: allowed('modify anything') },
    restricted: /: not allowed/.test(text),
    method: /^file encryption method: (\S+)/m.exec(text)?.[1] ?? 'RC4',
    pageCount,
  };
}
