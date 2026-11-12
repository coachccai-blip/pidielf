// État de l'éditeur de page : éléments par page, sélection, outil actif et
// historique (annuler / rétablir). Seule la page courante est affichée ; les
// éléments des autres pages restent ici.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { refit, totalCount, type EditorElement, type NewElement, type PageSize, type PagesState, type Point } from './model';

/** Formes créées en faisant glisser le doigt ou la souris sur la page. */
export type DrawShape = 'rect' | 'ellipse' | 'line' | 'arrow' | 'ink' | 'highlight' | 'whiteout' | 'cover';

export type ToolMode =
  | { kind: 'select' }
  | { kind: 'draw'; shape: DrawShape }
  /** Un appui sur la page ouvre une zone de saisie à cet endroit. */
  | { kind: 'text' }
  /** Un appui sur la page y pose l'élément fabriqué par `make` (image choisie, par exemple). */
  | { kind: 'place'; make: (at: Point, page: PageSize) => NewElement };

/**
 * Façon d'enregistrer une modification : `push` crée une étape d'annulation,
 * `none` modifie l'étape en cours (suite d'un geste, ajustement automatique).
 */
export type Recording = 'push' | 'none';

export interface ChangeOptions { record?: Recording; group?: string }

interface History { past: PagesState[]; present: PagesState; future: PagesState[] }

type Action =
  | { type: 'set'; pages: PagesState; record: Recording }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_LIMIT = 100;

function reducer(state: History, action: Action): History {
  switch (action.type) {
    case 'set':
      if (action.record === 'none') return { ...state, present: action.pages };
      return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: action.pages, future: [] };
    case 'undo':
      if (state.past.length === 0) return state;
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
    case 'redo':
      if (state.future.length === 0) return state;
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  }
}

/** Ce que la surface d'édition met à disposition des outils (taille et zone visible de la page). */
export interface EditorView {
  pageSize: PageSize;
  /** Centre de la partie de la page visible à l'écran, en coordonnées normalisées. */
  visibleCenter: () => Point;
  /** Fait défiler l'écran, si besoin, pour montrer ce point de la page. */
  reveal: (at: Point) => void;
}

/** Zone de saisie d'un nouveau texte, pas encore ajouté à la page. */
export interface TextDraft {
  at: Point;
  /** Largeur imposée (cache suivi d'un texte) ; sinon la boîte épouse le texte. */
  width?: number;
  size?: number;
}

export interface Editor {
  pages: PagesState;
  page: number;
  setPage: (page: number) => void;
  /** Éléments de la page courante. */
  elements: EditorElement[];
  selectedId: string | null;
  selected: EditorElement | null;
  select: (id: string | null) => void;
  /** Texte en cours de saisie directe. */
  editingId: string | null;
  setEditing: (id: string | null) => void;
  draft: TextDraft | null;
  setDraft: (draft: TextDraft | null) => void;
  mode: ToolMode;
  setMode: (mode: ToolMode) => void;
  /** Ajoute des éléments à la page courante (une seule étape d'annulation) et sélectionne le dernier. */
  add: (elements: NewElement[], options?: { select?: boolean; record?: Recording }) => string[];
  /** Remplace un élément de la page courante. `group` fusionne les réglages rapprochés en une seule étape d'annulation. */
  replace: (next: EditorElement, options?: ChangeOptions) => void;
  /** Modifie des propriétés d'un élément de la page courante. */
  patch: (id: string, changes: Partial<EditorElement>, options?: ChangeOptions) => void;
  remove: (id: string) => void;
  /** Copie un élément sur toutes les autres pages, au même endroit ; `sizes` donne le format de chaque page. */
  copyToAllPages: (id: string, sizes: PageSize[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Nombre total d'éléments, toutes pages confondues. */
  total: number;
  /** Message lu par les lecteurs d'écran. */
  announcement: string;
  announce: (message: string) => void;
  view: React.RefObject<EditorView | null>;
  /** La page est affichée : on peut y poser des éléments. */
  ready: boolean;
  setReady: (ready: boolean) => void;
}

let counter = 0;
const nextId = (): string => `el-${Date.now().toString(36)}-${counter++}`;

/** Première page dont le contenu diffère entre deux états (pour y revenir après une annulation). */
function changedPage(a: PagesState, b: PagesState): number | null {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[Number(key)] !== b[Number(key)]) return Number(key);
  }
  return null;
}

export function useEditor(): Editor {
  const [history, dispatch] = useReducer(reducer, { past: [], present: {}, future: [] });
  const [page, setPageState] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<TextDraft | null>(null);
  const [mode, setModeState] = useState<ToolMode>({ kind: 'select' });
  const [announcement, setAnnouncement] = useState('');
  const view = useRef<EditorView | null>(null);
  const [ready, setReady] = useState(false);
  const lastGroup = useRef<{ key: string; time: number } | null>(null);

  // Les fonctions ci-dessous lisent l'état le plus récent sans changer d'identité.
  const live = useRef({ history, page });
  live.current = { history, page };

  const commit = useCallback((pages: PagesState, record: Recording) => {
    // Plusieurs modifications peuvent se suivre avant le prochain rendu : chacune part de la précédente.
    live.current = { ...live.current, history: reducer(live.current.history, { type: 'set', pages, record }) };
    dispatch({ type: 'set', pages, record });
  }, []);

  const setPage = useCallback((next: number) => {
    setPageState(next);
    setSelectedId(null);
    setEditing(null);
    setDraft(null);
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setEditing((current) => (current && current !== id ? null : current));
  }, []);

  const setMode = useCallback((next: ToolMode) => {
    setModeState(next);
    if (next.kind !== 'select') {
      setSelectedId(null);
      setEditing(null);
    }
  }, []);

  const add = useCallback<Editor['add']>((elements, options = {}) => {
    const { history: h, page: p } = live.current;
    const created = elements.map((el) => ({ ...el, id: nextId() }) as EditorElement);
    commit({ ...h.present, [p]: [...(h.present[p] ?? []), ...created] }, options.record ?? 'push');
    lastGroup.current = null;
    if (options.select !== false && created.length > 0) setSelectedId(created[created.length - 1].id);
    return created.map((el) => el.id);
  }, [commit]);

  const replace = useCallback<Editor['replace']>((next, options = {}) => {
    const { history: h, page: p } = live.current;
    const list = h.present[p] ?? [];
    if (!list.some((el) => el.id === next.id)) return;
    let record = options.record ?? 'push';
    if (record === 'push') {
      // Des réglages rapprochés du même groupe (curseur, flèches du clavier) ne font qu'une étape.
      const key = options.group ? `${next.id}:${options.group}` : null;
      const now = Date.now();
      if (key && lastGroup.current?.key === key && now - lastGroup.current.time < 1200) record = 'none';
      lastGroup.current = key ? { key, time: now } : null;
    }
    commit({ ...h.present, [p]: list.map((el) => (el.id === next.id ? next : el)) }, record);
  }, [commit]);

  const patch = useCallback<Editor['patch']>((id, changes, options) => {
    const current = (live.current.history.present[live.current.page] ?? []).find((el) => el.id === id);
    if (current) replace({ ...current, ...changes } as EditorElement, options);
  }, [replace]);

  const remove = useCallback((id: string) => {
    const { history: h, page: p } = live.current;
    const list = h.present[p] ?? [];
    if (!list.some((el) => el.id === id)) return;
    commit({ ...h.present, [p]: list.filter((el) => el.id !== id) }, 'push');
    lastGroup.current = null;
    setSelectedId((current) => (current === id ? null : current));
    setEditing((current) => (current === id ? null : current));
  }, [commit]);

  const copyToAllPages = useCallback((id: string, sizes: PageSize[]) => {
    const { history: h, page: p } = live.current;
    const source = (h.present[p] ?? []).find((el) => el.id === id);
    if (!source) return;
    const next = { ...h.present };
    sizes.forEach((size, index) => {
      const n = index + 1;
      if (n !== p) next[n] = [...(next[n] ?? []), { ...refit(source, sizes[p - 1], size), id: nextId() }];
    });
    commit(next, 'push');
    lastGroup.current = null;
  }, [commit]);

  const travel = useCallback((type: 'undo' | 'redo') => {
    const before = live.current.history;
    const after = reducer(before, { type });
    if (after === before) return;
    live.current = { ...live.current, history: after };
    dispatch({ type });
    lastGroup.current = null;
    setEditing(null);
    setDraft(null);
    // On montre la page où le changement a eu lieu.
    const changed = changedPage(before.present, after.present);
    if (changed !== null && changed !== live.current.page) {
      setPageState(changed);
      setSelectedId(null);
    }
  }, []);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);

  const elements = useMemo(() => history.present[page] ?? [], [history.present, page]);
  const selected = useMemo(() => elements.find((el) => el.id === selectedId) ?? null, [elements, selectedId]);

  // L'élément sélectionné a pu disparaître (annulation) : la sélection suit.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const total = useMemo(() => totalCount(history.present), [history.present]);

  return {
    pages: history.present,
    page,
    setPage,
    elements,
    selectedId,
    selected,
    select,
    editingId,
    setEditing,
    draft,
    setDraft,
    mode,
    setMode,
    add,
    replace,
    patch,
    remove,
    copyToAllPages,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    total,
    announcement,
    announce: setAnnouncement,
    view,
    ready,
    setReady,
  };
}
