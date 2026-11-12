// Catalogue des quinze outils, répartis en cinq catégories colorées.
import {
  Combine, Scissors, LayoutGrid, RotateCw, Minimize2, ScanText, Images, FileImage, Camera,
  PenLine, Stamp, Hash, Signature, Lock, LockOpen, BookOpen, type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ToolId } from '@/db';
import type { ToolProps } from './types';

export type CategoryId = 'lire' | 'organiser' | 'optimiser' | 'convertir' | 'editer' | 'securiser';

export const categoryIcons: Record<CategoryId, LucideIcon> = {
  lire: BookOpen,
  organiser: LayoutGrid,
  optimiser: Minimize2,
  convertir: Images,
  editer: PenLine,
  securiser: Lock,
};

export const toolCategories: CategoryId[] = ['organiser', 'optimiser', 'convertir', 'editer', 'securiser'];

export interface ToolMeta {
  id: Exclude<ToolId, 'annotations'>;
  cat: CategoryId;
  icon: LucideIcon;
  /** Type de fichiers attendus à l'étape « Choisir ». */
  accepts: 'pdf' | 'images';
  /** Plusieurs fichiers acceptés (traitement par lot ou assemblage). */
  multiple: boolean;
  /** Nombre minimal de fichiers pour lancer l'outil. */
  min?: number;
  /** L'outil travaille sur des PDF protégés (il ne faut donc pas les déverrouiller avant). */
  keepEncrypted?: boolean;
  /** Suffixe du nom proposé : « contrat_signe.pdf ». */
  suffix: string;
  load: () => Promise<{ default: ComponentType<ToolProps> }>;
}

export const tools: ToolMeta[] = [
  { id: 'fusionner', cat: 'organiser', icon: Combine, accepts: 'pdf', multiple: true, min: 2, suffix: 'fusion', load: () => import('./fusionner') },
  { id: 'diviser', cat: 'organiser', icon: Scissors, accepts: 'pdf', multiple: false, suffix: 'partie', load: () => import('./diviser') },
  { id: 'organiser', cat: 'organiser', icon: LayoutGrid, accepts: 'pdf', multiple: false, suffix: 'organise', load: () => import('./organiser') },
  { id: 'pivoter', cat: 'organiser', icon: RotateCw, accepts: 'pdf', multiple: true, suffix: 'pivote', load: () => import('./pivoter') },
  { id: 'compresser', cat: 'optimiser', icon: Minimize2, accepts: 'pdf', multiple: true, suffix: 'compresse', load: () => import('./compresser') },
  { id: 'ocr', cat: 'optimiser', icon: ScanText, accepts: 'pdf', multiple: false, suffix: 'ocr', load: () => import('./ocr') },
  { id: 'pdf-en-images', cat: 'convertir', icon: Images, accepts: 'pdf', multiple: false, suffix: 'images', load: () => import('./pdf-en-images') },
  { id: 'images-en-pdf', cat: 'convertir', icon: FileImage, accepts: 'images', multiple: true, suffix: 'images', load: () => import('./images-en-pdf') },
  { id: 'scanner', cat: 'convertir', icon: Camera, accepts: 'images', multiple: true, suffix: 'scan', load: () => import('./scanner') },
  { id: 'editer', cat: 'editer', icon: PenLine, accepts: 'pdf', multiple: false, suffix: 'edite', load: () => import('./editer') },
  { id: 'filigrane', cat: 'editer', icon: Stamp, accepts: 'pdf', multiple: true, suffix: 'filigrane', load: () => import('./filigrane') },
  { id: 'numeros', cat: 'editer', icon: Hash, accepts: 'pdf', multiple: true, suffix: 'numerote', load: () => import('./numeros') },
  { id: 'signer', cat: 'securiser', icon: Signature, accepts: 'pdf', multiple: false, suffix: 'signe', load: () => import('./signer') },
  { id: 'proteger', cat: 'securiser', icon: Lock, accepts: 'pdf', multiple: true, suffix: 'protege', load: () => import('./proteger') },
  { id: 'deverrouiller', cat: 'securiser', icon: LockOpen, accepts: 'pdf', multiple: true, keepEncrypted: true, suffix: 'deverrouille', load: () => import('./deverrouiller') },
];

export const toolById = (id: string): ToolMeta | undefined => tools.find((t) => t.id === id);
export const toolsByCategory = (cat: CategoryId): ToolMeta[] => tools.filter((t) => t.cat === cat);
