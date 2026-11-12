// Plan de pages de l'outil « Organiser » : opérations pures sur la liste des
// feuilles, et historique pour annuler / rétablir. Une opération qui ne change
// rien renvoie la même liste : l'historique ne s'encombre pas de pas vides.
import type { PlanItem } from '@/core/pdf/organize';

/** Une feuille du document à produire : page d'un PDF source, ou page blanche. */
export type Sheet =
  | { id: string; kind: 'page'; /** Indice du PDF source. */ source: number; /** Page (à partir de 1). */ page: number; /** Rotation ajoutée : 0, 90, 180 ou 270. */ rotate: number }
  | { id: string; kind: 'blank'; width: number; height: number };

export interface Size { width: number; height: number }

/** A4 portrait, en points : taille d'une page blanche sans voisine. */
export const A4: Size = { width: 595.28, height: 841.89 };

let counter = 0;
const newId = (): string => `f${counter++}`;

/** Toutes les pages d'un PDF source, dans l'ordre. */
export const sourceSheets = (source: number, pageCount: number): Sheet[] =>
  Array.from({ length: pageCount }, (_, i) => ({ id: newId(), kind: 'page', source, page: i + 1, rotate: 0 }));

export const blankSheet = (size: Size): Sheet => ({ id: newId(), kind: 'blank', width: size.width, height: size.height });

/** Taille après une rotation : un quart de tour échange largeur et hauteur. */
export const rotatedSize = (size: Size, rotate: number): Size =>
  rotate % 180 === 0 ? { width: size.width, height: size.height } : { width: size.height, height: size.width };

type Ids = ReadonlySet<string>;

export function removeSheets(plan: Sheet[], ids: Ids): Sheet[] {
  const next = plan.filter((s) => !ids.has(s.id));
  return next.length === plan.length ? plan : next;
}

/** Chaque feuille visée est suivie de sa copie, indépendante de l'originale. */
export function duplicateSheets(plan: Sheet[], ids: Ids): Sheet[] {
  if (!plan.some((s) => ids.has(s.id))) return plan;
  return plan.flatMap((s) => (ids.has(s.id) ? [s, { ...s, id: newId() }] : [s]));
}

/** Rotation par quarts de tour ; une page blanche échange simplement ses dimensions. */
export function rotateSheets(plan: Sheet[], ids: Ids, delta: number): Sheet[] {
  if (delta % 360 === 0 || !plan.some((s) => ids.has(s.id))) return plan;
  return plan.map((s) => {
    if (!ids.has(s.id)) return s;
    if (s.kind === 'blank') return { ...s, ...rotatedSize(s, delta) };
    return { ...s, rotate: (((s.rotate + delta) % 360) + 360) % 360 };
  });
}

/** Avance (-1) ou recule (+1) les feuilles visées d'un cran, sans changer leur ordre relatif. */
export function shiftSheets(plan: Sheet[], ids: Ids, delta: -1 | 1): Sheet[] {
  const next = [...plan];
  let moved = false;
  const swap = (i: number, j: number) => {
    if (ids.has(next[i].id) && !ids.has(next[j].id)) {
      [next[i], next[j]] = [next[j], next[i]];
      moved = true;
    }
  };
  if (delta < 0) for (let i = 1; i < next.length; i++) swap(i, i - 1);
  else for (let i = next.length - 2; i >= 0; i--) swap(i, i + 1);
  return moved ? next : plan;
}

/** Regroupe les feuilles visées au début ou à la fin du document. */
export function sendSheets(plan: Sheet[], ids: Ids, where: 'start' | 'end'): Sheet[] {
  const picked = plan.filter((s) => ids.has(s.id));
  const rest = plan.filter((s) => !ids.has(s.id));
  const next = where === 'start' ? [...picked, ...rest] : [...rest, ...picked];
  return next.every((s, i) => s === plan[i]) ? plan : next;
}

/**
 * Glisser-déposer : la feuille `activeId` est lâchée sur `overId`. Si elle fait
 * partie d'une sélection multiple, toute la sélection suit, regroupée.
 */
export function dropSheets(plan: Sheet[], ids: Ids, activeId: string, overId: string): Sheet[] {
  const from = plan.findIndex((s) => s.id === activeId);
  const to = plan.findIndex((s) => s.id === overId);
  if (from < 0 || to < 0 || from === to) return plan;
  const group: Ids = ids.has(activeId) ? ids : new Set([activeId]);
  const picked = plan.filter((s) => group.has(s.id));
  const rest = plan.filter((s) => !group.has(s.id));
  // Position d'insertion parmi les feuilles restantes : après la cible quand on descend, avant quand on remonte.
  let at = plan.slice(0, to).filter((s) => !group.has(s.id)).length;
  if (!group.has(overId) && from < to) at += 1;
  const next = [...rest.slice(0, at), ...picked, ...rest.slice(at)];
  return next.every((s, i) => s === plan[i]) ? plan : next;
}

/** Insère des feuilles après `anchorId`, ou à la fin du document sans ancre. */
export function insertSheets(plan: Sheet[], anchorId: string | null, sheets: Sheet[]): Sheet[] {
  if (sheets.length === 0) return plan;
  const index = anchorId === null ? -1 : plan.findIndex((s) => s.id === anchorId);
  const at = index < 0 ? plan.length : index + 1;
  return [...plan.slice(0, at), ...sheets, ...plan.slice(at)];
}

/** Dernière feuille visée dans l'ordre du document : c'est après elle qu'on insère. */
export function lastOf(plan: Sheet[], ids: Ids): string | null {
  for (let i = plan.length - 1; i >= 0; i--) if (ids.has(plan[i].id)) return plan[i].id;
  return null;
}

/** Vrai si le plan reproduit le document d'origine tel quel. */
export const isUntouched = (plan: Sheet[], pageCount: number): boolean =>
  plan.length === pageCount && plan.every((s, i) => s.kind === 'page' && s.source === 0 && s.page === i + 1 && s.rotate === 0);

/**
 * Paramètres pour `organizePdf` : seuls les PDF réellement utilisés sont
 * transmis (`used` donne leurs indices d'origine), et les pages sont renumérotées en conséquence.
 */
export function toOrganizePlan(plan: Sheet[]): { used: number[]; items: PlanItem[] } {
  const used = [...new Set(plan.flatMap((s) => (s.kind === 'page' ? [s.source] : [])))].sort((a, b) => a - b);
  const items = plan.map((s): PlanItem =>
    s.kind === 'blank'
      ? { kind: 'blank', width: s.width, height: s.height }
      : { kind: 'page', source: used.indexOf(s.source), page: s.page, ...(s.rotate ? { rotate: s.rotate } : {}) },
  );
  return { used, items };
}

// ---- Historique -------------------------------------------------------------

export interface History<T> { past: T[]; present: T; future: T[] }

/** Nombre d'états gardés : assez pour une longue séance, sans grossir sans fin. */
export const HISTORY_LIMIT = 100;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Enregistre un nouvel état ; ce qui avait été annulé ne peut plus être rétabli. */
export function commit<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
