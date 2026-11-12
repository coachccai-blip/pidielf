// Vérifie que chaque clé de traduction utilisée dans le code existe en français
// et en anglais, et que les deux langues ont exactement les mêmes clés.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', 'src');
const localesDir = join(root, 'i18n', 'locales');

type Dict = { [k: string]: string | Dict };

function flatten(dict: Dict, prefix: string, out: Set<string>): void {
  for (const [k, v] of Object.entries(dict)) {
    const key = `${prefix}.${k}`;
    if (typeof v === 'string') out.add(key);
    else flatten(v, key, out);
  }
}

function keysOf(lang: string): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(join(localesDir, lang))) {
    flatten(JSON.parse(readFileSync(join(localesDir, lang, file), 'utf8')) as Dict, file.replace('.json', ''), out);
  }
  return out;
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const fr = keysOf('fr');
const en = keysOf('en');
const has = (keys: Set<string>, key: string) => keys.has(key) || keys.has(`${key}_one`) || keys.has(`${key}_other`);

describe('traductions', () => {
  it('le français et l’anglais ont les mêmes clés', () => {
    expect([...fr].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !fr.has(k))).toEqual([]);
  });

  it('toutes les clés utilisées dans le code existent', () => {
    const missing: string[] = [];
    for (const file of sources(root)) {
      const code = readFileSync(file, 'utf8');
      // t('espace.cle') — les clés construites dynamiquement (`...${x}`) sont vérifiées par leur préfixe.
      for (const m of code.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) {
        if (!has(fr, m[1])) missing.push(`${m[1]} (${file.replace(root, 'src')})`);
      }
      for (const m of code.matchAll(/\bt\(\s*`([a-zA-Z0-9_.-]+)\.\$\{/g)) {
        const prefix = `${m[1]}.`;
        if (![...fr].some((k) => k.startsWith(prefix))) missing.push(`${prefix}* (${file.replace(root, 'src')})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
