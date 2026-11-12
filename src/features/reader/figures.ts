// Images d'une page, pour le mode Texte : on repère les images dans la liste
// d'opérations de pdf.js, puis on les découpe dans un rendu de la page.
import { loadPdfjs, type PDFDocumentProxy } from '@/lib/pdfjs';

export interface Figure {
  url: string;
  /** Position verticale (0 à 1) du haut de l'image dans la page. */
  y: number;
  width: number;
  height: number;
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

interface Box { x: number; y: number; w: number; h: number }

export async function pageFigures(pdf: PDFDocumentProxy, pageNumber: number): Promise<Figure[]> {
  const [pdfjs, page] = await Promise.all([loadPdfjs(), pdf.getPage(pageNumber)]);
  const { OPS } = pdfjs;
  const viewport = page.getViewport({ scale: 1 });
  const list = await page.getOperatorList();

  // On suit la matrice de transformation courante pour situer chaque image.
  const boxes: Box[] = [];
  const stack: Matrix[] = [];
  let ctm = viewport.transform as Matrix;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args as unknown as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as unknown as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      // Une image occupe le carré unité, transformé par la matrice courante.
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const x = Math.max(0, Math.min(...xs));
      const y = Math.max(0, Math.min(...ys));
      const w = Math.min(viewport.width, Math.max(...xs)) - x;
      const h = Math.min(viewport.height, Math.max(...ys)) - y;
      const share = (w * h) / (viewport.width * viewport.height);
      // Ni les pictogrammes, ni les fonds de page (pages scannées).
      if (w > 48 && h > 48 && share > 0.015 && share < 0.8) boxes.push({ x, y, w, h });
    }
  }
  if (boxes.length === 0 || boxes.length > 12) return [];

  const scale = Math.min(2, 1400 / viewport.width);
  const canvas = document.createElement('canvas');
  const scaled = page.getViewport({ scale });
  canvas.width = Math.floor(scaled.width);
  canvas.height = Math.floor(scaled.height);
  await page.render({ canvas, viewport: scaled, background: '#ffffff' }).promise;

  const figures: Figure[] = [];
  for (const box of boxes) {
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(box.w * scale));
    crop.height = Math.max(1, Math.round(box.h * scale));
    crop.getContext('2d')!.drawImage(canvas, box.x * scale, box.y * scale, box.w * scale, box.h * scale, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, 'image/jpeg', 0.85));
    crop.width = 0;
    if (blob) figures.push({ url: URL.createObjectURL(blob), y: box.y / viewport.height, width: Math.round(box.w), height: Math.round(box.h) });
  }
  canvas.width = 0;
  return figures;
}
