// Erreurs de traitement, expliquées ensuite en langage simple dans l'interface.
export type ToolErrorCode =
  | 'encrypted' // fichier protégé par mot de passe
  | 'bad-password' // mot de passe incorrect
  | 'damaged' // fichier abîmé ou illisible
  | 'memory' // mémoire insuffisante
  | 'empty' // rien à produire (aucune page, aucune image)
  | 'unsupported'; // fonction absente de ce navigateur

export class ToolError extends Error {
  code: ToolErrorCode;
  constructor(code: ToolErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ToolError';
    this.code = code;
  }
}

/** Devine la nature d'une erreur venue d'une bibliothèque tierce. */
export function classifyError(err: unknown): ToolErrorCode | 'aborted' | 'unknown' {
  if (err instanceof ToolError) return err.code;
  const e = err as { name?: string; message?: string; code?: string };
  const text = `${e?.name ?? ''} ${e?.message ?? ''}`.toLowerCase();
  if (e?.name === 'AbortError') return 'aborted';
  if (e?.code === 'password' || e?.code === 'bad-password') return e.code === 'password' ? 'encrypted' : 'bad-password';
  if (/encrypt|password/.test(text)) return 'encrypted';
  if (/out of memory|allocation|array buffer allocation|invalid array length|memory/.test(text)) return 'memory';
  if (/invalid pdf|failed to parse|no pdf header|parse|corrupt|unexpected|trailer|xref/.test(text)) return 'damaged';
  return 'unknown';
}
