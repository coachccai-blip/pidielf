// Contrat commun à tous les outils : Choisir → Régler → Récupérer.
import type { ToolMeta } from './registry';

/** Fichier d'entrée, prêt à être traité (déverrouillé si besoin). */
export interface InputFile {
  /** Identifiant de session. */
  key: string;
  name: string;
  blob: Blob;
  /** Nombre de pages (PDF) ; 0 pour une image. */
  pageCount: number;
  /** Fichier de la bibliothèque dont il provient, le cas échéant. */
  libraryId?: string;
  /** Vrai si le PDF est protégé (uniquement pour les outils `keepEncrypted`). */
  encrypted?: boolean;
}

export interface OutputFile {
  name: string;
  blob: Blob;
  /** Pages du résultat (PDF), pour la bibliothèque. */
  pageCount?: number;
  /** Fichier de la bibliothèque dont ce résultat est une version dérivée. */
  parentId?: string;
}

export interface JobContext {
  signal: AbortSignal;
  /** Progression de 0 à 1, avec un libellé facultatif (« Page 3 sur 12 »). */
  progress: (ratio: number, label?: string) => void;
}

export interface JobResult {
  outputs: OutputFile[];
  /** Taille d'origine, pour afficher le gain (compression). */
  originalSize?: number;
  /** Message d'information affiché avec le résultat. */
  note?: string;
  /** Contenu additionnel de l'écran de résultat (texte OCR, etc.). */
  extra?: React.ReactNode;
}

export interface ToolProps {
  tool: ToolMeta;
  inputs: InputFile[];
  setInputs: (inputs: InputFile[]) => void;
  /** Ouvre le sélecteur pour ajouter des fichiers. */
  addMore: () => void;
  /** Lance le traitement : la coquille affiche progression, annulation, erreurs et résultat. */
  run: (job: (ctx: JobContext) => Promise<JobResult | OutputFile[]>) => void;
}
