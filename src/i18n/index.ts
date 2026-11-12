// Moteur de traduction léger : clés à points, interpolation {{nom}}, pluriels
// (clés suffixées _one / _other), et formats de dates, nombres et tailles.
import { useSyncExternalStore } from 'react';
import { getSettings, updateSettings, type Lang } from '@/lib/settings';

type Dict = { [k: string]: string | Dict };

// Un fichier par espace de noms : locales/fr/<nom>.json et locales/en/<nom>.json.
// La clé « bibliotheque.titre » se lit dans bibliotheque.json, à l'entrée « titre ».
function assemble(modules: Record<string, unknown>): Dict {
  const dict: Dict = {};
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.split('/').pop()!.replace(/\.json$/, '');
    dict[name] = ((mod as { default?: Dict }).default ?? mod) as Dict;
  }
  return dict;
}

const frModules = import.meta.glob('./locales/fr/*.json', { eager: true });
const enModules = import.meta.glob('./locales/en/*.json');

const dictionaries: Record<Lang, Dict | null> = { fr: assemble(frModules), en: null };
const listeners = new Set<() => void>();
let version = 0;

export async function setLang(lang: Lang): Promise<void> {
  if (!dictionaries[lang]) {
    const loaded: Record<string, unknown> = {};
    await Promise.all(Object.entries(enModules).map(async ([path, load]) => (loaded[path] = await load())));
    dictionaries[lang] = assemble(loaded);
  }
  updateSettings({ lang });
  document.documentElement.lang = lang;
  version++;
  listeners.forEach((l) => l());
}

export async function initI18n(): Promise<void> {
  const lang = getSettings().lang;
  if (lang !== 'fr') await setLang(lang);
  else document.documentElement.lang = 'fr';
}

export function currentLang(): Lang {
  const lang = getSettings().lang;
  return dictionaries[lang] ? lang : 'fr';
}

function lookup(dict: Dict | null, key: string): string | undefined {
  let node: string | Dict | undefined = dict ?? undefined;
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export type TParams = Record<string, string | number>;

export function t(key: string, params?: TParams): string {
  const lang = currentLang();
  const dict = dictionaries[lang];
  let text: string | undefined;
  if (params && typeof params.count === 'number') {
    const rule = new Intl.PluralRules(lang).select(params.count);
    text = lookup(dict, `${key}_${rule}`) ?? lookup(dict, `${key}_other`);
  }
  text ??= lookup(dict, key) ?? lookup(dictionaries.fr, key) ?? key;
  if (!params) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = params[name];
    return typeof v === 'number' ? formatNumber(v) : (v ?? '');
  });
}

/** Hook : re-rend le composant quand la langue change. */
export function useT(): typeof t {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return t;
}

// ---- Formats ---------------------------------------------------------------

const locale = () => (currentLang() === 'fr' ? 'fr-FR' : 'en-GB');

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), options).format(n);
}

export function formatPercent(ratio: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: digits }).format(ratio);
}

export function formatBytes(bytes: number): string {
  const units = currentLang() === 'fr' ? ['o', 'Ko', 'Mo', 'Go'] : ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = i === 0 || value >= 100 ? 0 : 1;
  return `${formatNumber(value, { maximumFractionDigits: digits })} ${units[i]}`;
}

export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
}

export function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return rtf.format(0, 'minute');
  if (abs < hour) return rtf.format(Math.round(diff / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day');
  return formatDate(ts);
}

export function formatDuration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return t('common.minutes', { count: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}
