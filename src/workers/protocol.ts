// Messages échangés avec le worker de traitement PDF.
export interface CallMessage { id: number; module: string; fn: string; params: unknown }
export type ReplyMessage =
  | { id: number; type: 'progress'; ratio: number; label?: string }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; name: string; message: string; code?: string };

/** Fonction de traitement : paramètres sérialisables, progression facultative. */
export type Progress = (ratio: number, label?: string) => void;
