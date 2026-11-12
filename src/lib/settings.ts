// Réglages de l'application : petits, synchrones, lus avant le premier rendu.
// Ils vivent dans localStorage ; les fichiers et annotations vivent dans IndexedDB.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';
export type Lang = 'fr' | 'en';
export type PaperTheme = 'white' | 'sepia' | 'grey' | 'night';

export interface ReaderPrefs {
  paper: PaperTheme;
  scroll: 'continuous' | 'paged';
  spread: boolean;
  fit: 'width' | 'page';
  cropMargins: boolean;
  transitions: boolean;
  brightness: number; // 0.3 – 1
  warmth: number; // 0 – 1
  keepAwake: boolean;
  textFont: 'literata' | 'atkinson' | 'sans';
  textSize: number; // px
  textLine: number; // interligne
  textMargin: number; // 0 – 3
  textJustify: boolean;
}

export interface Settings {
  theme: ThemeChoice;
  lang: Lang;
  saveToLibrary: boolean;
  libraryView: 'grid' | 'list';
  librarySort: 'added' | 'name' | 'size' | 'opened';
  sidebarCollapsed: boolean;
  installDismissed: boolean;
  firstSuccess: boolean;
  persistAsked: boolean;
  reader: ReaderPrefs;
  /** Derniers réglages de chaque outil. */
  tools: Record<string, unknown>;
}

const KEY = 'pidielf:settings';

export const defaultSettings: Settings = {
  theme: 'auto',
  lang: 'fr', // français à l'ouverture, quelle que soit la langue du navigateur
  saveToLibrary: true,
  libraryView: 'grid',
  librarySort: 'added',
  sidebarCollapsed: false,
  installDismissed: false,
  firstSuccess: false,
  persistAsked: false,
  reader: {
    paper: 'white',
    scroll: 'continuous',
    spread: false,
    fit: 'width',
    cropMargins: false,
    transitions: true,
    brightness: 1,
    warmth: 0,
    keepAwake: true,
    textFont: 'literata',
    textSize: 19,
    textLine: 1.6,
    textMargin: 1,
    textJustify: false,
  },
  tools: {},
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaultSettings,
      ...parsed,
      reader: { ...defaultSettings.reader, ...(parsed.reader ?? {}) },
      tools: { ...(parsed.tools ?? {}) },
    };
  } catch {
    return defaultSettings;
  }
}

let current: Settings = typeof localStorage === 'undefined' ? defaultSettings : load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* stockage plein ou navigation privée : le réglage vaut pour la session */
  }
  listeners.forEach((l) => l());
}

export function updateReaderPrefs(patch: Partial<ReaderPrefs>): void {
  updateSettings({ reader: { ...current.reader, ...patch } });
}

export function resetSettings(): void {
  current = defaultSettings;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* rien à faire */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** Réglages mémorisés d'un outil, fusionnés avec ses valeurs par défaut. */
export function useToolSettings<T extends object>(toolId: string, defaults: T): [T, (patch: Partial<T>) => void] {
  const all = useSettings();
  const value = { ...defaults, ...((all.tools[toolId] as Partial<T> | undefined) ?? {}) };
  const set = (patch: Partial<T>) =>
    updateSettings({ tools: { ...getSettings().tools, [toolId]: { ...value, ...patch } } });
  return [value, set];
}

// ---- Thème ---------------------------------------------------------------

const darkQuery = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme(choice: ThemeChoice = current.theme): 'light' | 'dark' {
  if (choice === 'auto') return darkQuery?.matches ? 'dark' : 'light';
  return choice;
}

export function applyTheme(): void {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#151B1D' : '#FAF8F3');
}

export function watchTheme(): void {
  applyTheme();
  darkQuery?.addEventListener('change', applyTheme);
  subscribe(applyTheme);
}
