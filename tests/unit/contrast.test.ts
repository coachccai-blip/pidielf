// Tous les couples texte / fond des jetons de couleur respectent WCAG AA (4,5:1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', '..', 'src', 'styles', 'index.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='dark'] {")));
const dark = { ...light, ...tokens(css.slice(css.indexOf("[data-theme='dark'] {"), css.indexOf("[data-cat='lire']"))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const pairs: Array<[string, string]> = [
  ['--c-ink', '--c-page'],
  ['--c-ink', '--c-surface'],
  ['--c-ink', '--c-surface-2'],
  ['--c-ink-soft', '--c-page'],
  ['--c-ink-soft', '--c-surface'],
  ['--c-ink-soft', '--c-surface-2'],
  ['--c-accent-ink', '--c-accent'],
  ['--c-accent', '--c-surface'],
  ['--c-accent', '--c-page'],
  ['--c-accent', '--c-accent-soft'],
  ['--c-ink', '--c-accent-soft'],
  ['--c-danger', '--c-danger-soft'],
  ['--c-danger', '--c-surface'],
  ['--c-ink', '--c-danger-soft'],
  ...['lire', 'organiser', 'optimiser', 'convertir', 'editer', 'securiser'].flatMap(
    (cat): Array<[string, string]> => [
      [`--cat-${cat}-fg`, `--cat-${cat}-bg`],
      ['--c-ink', `--cat-${cat}-bg`],
    ],
  ),
];

describe.each([
  ['clair', light],
  ['sombre', dark],
])('contraste WCAG AA — mode %s', (_name, theme) => {
  it.each(pairs)('%s sur %s', (fg, bg) => {
    expect(theme[fg], fg).toBeDefined();
    expect(theme[bg], bg).toBeDefined();
    expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
