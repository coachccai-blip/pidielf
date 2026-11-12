// Passage de fichiers entre écrans, sans les écrire nulle part :
// glisser-déposer d'images, « Enchaîner un autre outil », partage entrant.
import type { InputFile } from './types';

let pendingFiles: File[] = [];
let pendingInputs: InputFile[] = [];

export function handOffFiles(files: File[]): void {
  pendingFiles = files;
}
export function takeFiles(): File[] {
  const f = pendingFiles;
  pendingFiles = [];
  return f;
}
export function handOffInputs(inputs: InputFile[]): void {
  pendingInputs = inputs;
}
export function takeInputs(): InputFile[] {
  const i = pendingInputs;
  pendingInputs = [];
  return i;
}
