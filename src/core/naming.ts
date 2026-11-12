// Noms de fichiers proposés : « nom-d-origine_outil.pdf ».

export function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, i), ext: name.slice(i + 1) };
}

/** Retire les caractères interdits dans un nom de fichier, sans toucher aux accents. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned.slice(0, 180) || 'document';
}

export function suggestName(original: string, suffix: string, ext = 'pdf'): string {
  const { base } = splitName(original);
  return sanitizeFileName(`${base || 'document'}_${suffix}.${ext}`);
}

export function withExt(name: string, ext: string): string {
  const { base } = splitName(name);
  return `${base || name}.${ext}`;
}

/** Garantit des noms uniques dans une liste (archive ZIP). */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return name;
    const { base, ext } = splitName(name);
    return ext ? `${base} (${n + 1}).${ext}` : `${base} (${n + 1})`;
  });
}

export function padNumber(n: number, total: number): string {
  return String(n).padStart(String(total).length, '0');
}
