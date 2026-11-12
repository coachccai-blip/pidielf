// Historique des annotations d'un document : chaque modification (ajout,
// suppression, changement de couleur ou de note) peut être annulée puis rétablie
// (Ctrl+Z, Ctrl+Y). L'historique vit le temps de la lecture ; les annotations,
// elles, restent enregistrées dans la bibliothèque.
import { useSyncExternalStore } from 'react';
import { db, type AnnotationRecord } from '@/db';

/** Une modification : l'annotation avant et après (absente = n'existe pas). */
export interface Change {
  before?: AnnotationRecord;
  after?: AnnotationRecord;
}

const LIMIT = 200;

export class AnnotationHistory {
  private past: Change[][] = [];
  private future: Change[][] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  private emit(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private async write(changes: Change[], direction: 'forward' | 'backward'): Promise<void> {
    await db.transaction('rw', db.annotations, async () => {
      for (const change of direction === 'forward' ? changes : [...changes].reverse()) {
        const target = direction === 'forward' ? change.after : change.before;
        const other = direction === 'forward' ? change.before : change.after;
        if (target) await db.annotations.put(target);
        else if (other) await db.annotations.delete(other.id);
      }
    });
  }

  /** Applique un groupe de modifications et l'inscrit dans l'historique. */
  async apply(changes: Change[]): Promise<void> {
    if (changes.length === 0) return;
    await this.write(changes, 'forward');
    this.past.push(changes);
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
    this.emit();
  }

  add(record: AnnotationRecord): Promise<void> {
    return this.apply([{ after: record }]);
  }

  async update(id: string, patch: Partial<AnnotationRecord>): Promise<void> {
    const before = await db.annotations.get(id);
    if (!before) return;
    const after = { ...before, ...patch };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await this.apply([{ before, after }]);
  }

  async remove(id: string): Promise<void> {
    const before = await db.annotations.get(id);
    if (before) await this.apply([{ before }]);
  }

  /** Annule la dernière modification. Renvoie la page concernée, ou null s'il n'y a rien à annuler. */
  async undo(): Promise<number | null> {
    const changes = this.past.pop();
    if (!changes) return null;
    await this.write(changes, 'backward');
    this.future.push(changes);
    this.emit();
    return (changes[0].before ?? changes[0].after)?.page ?? null;
  }

  /** Rétablit la dernière modification annulée. */
  async redo(): Promise<number | null> {
    const changes = this.future.pop();
    if (!changes) return null;
    await this.write(changes, 'forward');
    this.past.push(changes);
    this.emit();
    return (changes[0].after ?? changes[0].before)?.page ?? null;
  }
}

/** Suit l'état de l'historique (boutons Annuler et Rétablir). */
export function useHistoryState(history: AnnotationHistory): { canUndo: boolean; canRedo: boolean } {
  useSyncExternalStore(history.subscribe, history.getVersion);
  return { canUndo: history.canUndo, canRedo: history.canRedo };
}
