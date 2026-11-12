// Texte d'une page : recherche plein texte et recomposition (mode Texte).
// Fonctions pures, indépendantes de pdf.js : elles reçoivent des « fragments »
// déjà exprimés dans le repère de la page affichée.

/** Fragment de texte. Coordonnées normalisées (0 à 1), origine en haut à gauche. */
export interface TextRun {
  str: string;
  x: number;
  /** Haut du fragment. */
  y: number;
  w: number;
  h: number;
  /** Le fragment termine une ligne. */
  eol: boolean;
}

export interface PageText {
  /** Texte de la page, fragments mis bout à bout. */
  text: string;
  runs: TextRun[];
  /** Position du premier caractère de chaque fragment dans `text`. */
  starts: number[];
}

export interface NRectLike { x: number; y: number; w: number; h: number }

type Matrix = [number, number, number, number, number, number];

const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

export interface RawTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

/** Convertit les éléments de texte de pdf.js (viewport à l'échelle 1) en fragments normalisés. */
export function toRuns(items: RawTextItem[], viewport: { transform: number[]; width: number; height: number }): TextRun[] {
  const runs: TextRun[] = [];
  for (const item of items) {
    if (!item.str && !item.hasEOL) continue;
    const tx = multiply(viewport.transform as Matrix, item.transform as Matrix);
    const height = Math.hypot(tx[2], tx[3]) || item.height || 0;
    runs.push({
      str: item.str,
      x: tx[4] / viewport.width,
      y: (tx[5] - height * 0.85) / viewport.height,
      w: item.width / viewport.width,
      h: (height * 1.12) / viewport.height,
      eol: !!item.hasEOL,
    });
  }
  return runs;
}

export function buildPageText(runs: TextRun[]): PageText {
  let text = '';
  const starts: number[] = [];
  for (const run of runs) {
    starts.push(text.length);
    text += run.str;
    if (run.eol && !/[\s-]$/.test(run.str)) text += ' ';
  }
  return { text, runs, starts };
}

/** Minuscules et sans accents, caractère par caractère (la longueur ne change pas). */
export function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const base = ch.normalize('NFD')[0].toLowerCase();
    out += base.length === 1 ? base : ch;
  }
  return out.replace(/[’‘]/g, "'");
}

export interface SearchHit {
  page: number;
  /** Rang de l'occurrence dans la page. */
  index: number;
  start: number;
  end: number;
  rects: NRectLike[];
  /** Extrait : avant, occurrence, après. */
  before: string;
  match: string;
  after: string;
}

/** Rectangles couvrant les caractères [start, end[ du texte de la page. */
export function rectsForRange(page: PageText, start: number, end: number): NRectLike[] {
  const rects: NRectLike[] = [];
  for (let i = 0; i < page.runs.length; i++) {
    const run = page.runs[i];
    const from = page.starts[i];
    const to = from + run.str.length;
    if (to <= start || from >= end || run.str.length === 0) continue;
    const a = Math.max(start, from) - from;
    const b = Math.min(end, to) - from;
    const rect = { x: run.x + (run.w * a) / run.str.length, y: run.y, w: (run.w * (b - a)) / run.str.length, h: run.h };
    const last = rects[rects.length - 1];
    // Fragments voisins sur la même ligne : un seul rectangle.
    if (last && Math.abs(last.y - rect.y) < rect.h * 0.4 && rect.x - (last.x + last.w) < rect.h * 0.8 && rect.x >= last.x) {
      last.w = rect.x + rect.w - last.x;
      last.h = Math.max(last.h, rect.h);
    } else {
      rects.push(rect);
    }
  }
  return rects;
}

export function searchPage(page: PageText, pageNumber: number, query: string, limit = 200): SearchHit[] {
  const needle = fold(query.trim()).replace(/\s+/g, ' ');
  if (needle.length === 0) return [];
  const haystack = fold(page.text).replace(/\s/g, ' ');
  const hits: SearchHit[] = [];
  let from = 0;
  while (hits.length < limit) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    const context = 44;
    const clean = (s: string) => s.replace(/\s+/g, ' ');
    hits.push({
      page: pageNumber,
      index: hits.length,
      start,
      end,
      rects: rectsForRange(page, start, end),
      before: (start > context ? '…' : '') + clean(page.text.slice(Math.max(0, start - context), start)),
      match: page.text.slice(start, end),
      after: clean(page.text.slice(end, end + context)) + (end + context < page.text.length ? '…' : ''),
    });
    from = end;
  }
  return hits;
}

// ---- Recomposition (mode Texte) ---------------------------------------------

/** Bloc de texte recomposé ; `y` est la position verticale (0 à 1) de sa première ligne dans la page. */
export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string; y: number }
  | { kind: 'para'; text: string; y: number };

interface Line { text: string; x: number; y: number; right: number; h: number }

const TERMINAL = /[.!?…:»"”)\]]$/;

function toLines(runs: TextRun[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  let lastRight = 0;
  let breakNext = false;
  // On garde l'ordre du flux PDF : c'est en général l'ordre de lecture, colonnes comprises.
  for (const run of runs) {
    const baseline = run.y + run.h;
    const sameLine: boolean = !!current && !breakNext && Math.abs(baseline - (current.y + current.h)) < Math.max(run.h, current.h) * 0.45 && run.x >= lastRight - run.h * 2;
    if (!sameLine || !current) {
      if (current && current.text.trim()) lines.push(current);
      current = { text: run.str, x: run.x, y: run.y, right: run.x + run.w, h: run.h };
    } else {
      const gap = run.x - lastRight;
      if (gap > current.h * 0.18 && !/\s$/.test(current.text) && !/^\s/.test(run.str)) current.text += ' ';
      current.text += run.str;
      current.right = Math.max(current.right, run.x + run.w);
      current.h = Math.max(current.h, run.h);
    }
    lastRight = run.x + run.w;
    breakNext = run.eol;
  }
  if (current && current.text.trim()) lines.push(current);
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Remet le texte d'une page en paragraphes et en titres. Approximatif sur les
 * mises en page complexes (colonnes, tableaux, formules) : c'est une aide à la
 * lecture, pas une conversion fidèle.
 */
export function reflowPage(runs: TextRun[]): Block[] {
  let lines = toLines(runs);
  // Numéros de page et folios isolés en haut ou en bas de page.
  lines = lines.filter((l) => !((l.y < 0.07 || l.y > 0.92) && /^[-–—\s]*(page\s*)?\d{1,4}(\s*[/|]\s*\d{1,4})?[-–—\s]*$/i.test(l.text)));
  if (lines.length === 0) return [];

  // Taille du corps de texte : la hauteur de ligne la plus fréquente, pondérée par la longueur.
  const weights = new Map<number, number>();
  for (const l of lines) {
    const key = Math.round(l.h * 2000);
    weights.set(key, (weights.get(key) ?? 0) + l.text.length);
  }
  const body = [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0] / 2000;
  const bodyLines = lines.filter((l) => Math.abs(l.h - body) < body * 0.12);
  const gaps: number[] = [];
  for (let i = 1; i < bodyLines.length; i++) {
    const gap = bodyLines[i].y - bodyLines[i - 1].y;
    if (gap > 0 && gap < body * 3) gaps.push(gap);
  }
  const lineGap = median(gaps) || body * 1.2;
  const columnRight = Math.max(...bodyLines.map((l) => l.right), 0);
  const columnLeft = median(bodyLines.map((l) => l.x));

  const blocks: Block[] = [];
  let para: string[] = [];
  let paraY = 0;
  const flush = () => {
    if (para.length === 0) return;
    let text = '';
    for (const line of para) {
      if (!text) text = line;
      // Mot coupé en fin de ligne : on le recolle.
      else if (/[a-zà-ÿ]-$/i.test(text) && /^[a-zà-ÿ]/.test(line)) text = text.slice(0, -1) + line;
      else text += ` ${line}`;
    }
    blocks.push({ kind: 'para', text, y: paraY });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];
    const isHeading = line.h > body * 1.2 && line.text.length < 140;
    if (isHeading) {
      flush();
      const level = line.h > body * 1.55 ? 2 : 3;
      const last = blocks[blocks.length - 1];
      // Titre sur plusieurs lignes.
      if (last?.kind === 'heading' && last.level === level && prev && Math.abs(prev.h - line.h) < body * 0.1 && line.y - prev.y < line.h * 2.2 && line.y > prev.y) {
        last.text += ` ${line.text}`;
        // Un « titre » qui s'étire sur plusieurs lignes est en réalité un paragraphe en gros caractères.
        if (last.text.length > 160) blocks[blocks.length - 1] = { kind: 'para', text: last.text, y: last.y };
      } else if (last?.kind === 'para' && prev && Math.abs(prev.h - line.h) < body * 0.1 && line.y - prev.y < line.h * 2.2 && line.y > prev.y) {
        last.text += ` ${line.text}`;
      } else {
        blocks.push({ kind: 'heading', level, text: line.text, y: line.y });
      }
      continue;
    }
    if (prev && para.length > 0) {
      const gap = line.y - prev.y;
      const jumped = gap < -body * 0.5; // nouvelle colonne
      const spaced = gap > lineGap * 1.45;
      const sizeChanged = Math.abs(line.h - prev.h) > body * 0.15;
      const indented = line.x > prev.x + body * 1.2 && Math.abs(prev.x - columnLeft) < body;
      const prevShort = prev.right < columnRight - body * 4 && TERMINAL.test(prev.text);
      const ended = TERMINAL.test(prev.text);
      if (sizeChanged || spaced || prevShort || (indented && ended) || (jumped && ended)) flush();
    }
    if (para.length === 0) paraY = line.y;
    para.push(line.text);
  }
  flush();
  return blocks;
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}
