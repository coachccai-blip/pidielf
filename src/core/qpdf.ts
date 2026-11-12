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

/**
 * Lance qpdf sur un fichier et renvoie le résultat.
 * Codes de sortie : 0 succès, 3 succès avec avertissements, 2 erreur.
 */
export async function runQpdf(args: string[], input: Uint8Array): Promise<Uint8Array> {
  const { qpdf, output } = await instantiate(input);
  let code: number;
  try {
    code = qpdf.callMain([...args, '/in.pdf', '/out.pdf']);
  } catch (err) {
    // Emscripten signale exit() par une exception portant le code de sortie.
    const status = (err as { status?: number }).status;
    if (typeof status !== 'number') throw err;
    code = status;
  }
  if (code !== 0 && code !== 3) {
    const text = output();
    if (/invalid password/i.test(text)) throw new ToolError('bad-password');
    throw new ToolError('damaged', text.trim() || `qpdf a échoué (code ${code})`);
  }
  try {
    return qpdf.FS.readFile('/out.pdf');
  } catch {
    throw new ToolError('damaged', output().trim() || 'qpdf n’a produit aucun fichier');
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
      options.userPassword,
      options.ownerPassword,
      '256',
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
