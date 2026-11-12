// Analyse des plages de pages saisies par l'utilisateur : « 1-3, 5, 8- ».

export interface PageRange { from: number; to: number }

/** Renvoie les plages (bornes incluses, à partir de 1) ou null si la saisie est invalide. */
export function parseRanges(input: string, pageCount: number): PageRange[] | null {
  const parts = input.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const ranges: PageRange[] = [];
  for (const part of parts) {
    const m = /^(\d*)\s*(?:[-–—]\s*(\d*))?$/.exec(part);
    if (!m) return null;
    const hasDash = /[-–—]/.test(part);
    const a = m[1] ? Number(m[1]) : hasDash ? 1 : NaN;
    const b = hasDash ? (m[2] ? Number(m[2]) : pageCount) : a;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) return null;
    ranges.push(a <= b ? { from: a, to: b } : { from: b, to: a });
  }
  return ranges;
}

/** Liste de pages (à partir de 1), dans l'ordre de la saisie, sans doublon. */
export function parsePageList(input: string, pageCount: number): number[] | null {
  const ranges = parseRanges(input, pageCount);
  if (!ranges) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const r of ranges) {
    for (let p = r.from; p <= r.to; p++) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

/** Écrit une liste de pages sous forme compacte : [1,2,3,5] → « 1-3, 5 ». */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const p = sorted[i];
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    if (start !== undefined) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = p;
    prev = p;
  }
  return parts.join(', ');
}

export type PageScope = 'all' | 'even' | 'odd' | 'custom';

/** Pages visées par une portée (toutes, paires, impaires, sélection). */
export function pagesForScope(scope: PageScope, pageCount: number, custom = ''): number[] | null {
  const all = Array.from({ length: pageCount }, (_, i) => i + 1);
  if (scope === 'all') return all;
  if (scope === 'even') return all.filter((p) => p % 2 === 0);
  if (scope === 'odd') return all.filter((p) => p % 2 === 1);
  return parsePageList(custom, pageCount);
}

/** Découpe « toutes les N pages ». */
export function chunkRanges(pageCount: number, every: number): PageRange[] {
  const n = Math.max(1, Math.floor(every));
  const out: PageRange[] = [];
  for (let from = 1; from <= pageCount; from += n) out.push({ from, to: Math.min(pageCount, from + n - 1) });
  return out;
}
