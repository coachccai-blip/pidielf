// Ouvre plusieurs PDF avec pdf.js (le document et ceux qu'on y insère) pour
// leurs miniatures ; tous sont refermés quand l'outil disparaît.
import { useEffect, useRef, useState } from 'react';
import { openPdf, type PDFDocumentProxy } from '@/lib/pdfjs';

interface Entry { doc: PDFDocumentProxy | null; closed: boolean }

/** Renvoie, pour chaque fichier, son document pdf.js (null tant qu'il s'ouvre). `blobs` doit être stable. */
export function usePdfs(blobs: Blob[]): Array<PDFDocumentProxy | null> {
  const [docs, setDocs] = useState<ReadonlyMap<Blob, PDFDocumentProxy>>(new Map());
  const entries = useRef(new Map<Blob, Entry>());

  useEffect(() => {
    for (const blob of blobs) {
      if (entries.current.has(blob)) continue;
      const entry: Entry = { doc: null, closed: false };
      entries.current.set(blob, entry);
      openPdf(blob)
        .then((doc) => {
          if (entry.closed) {
            void doc.loadingTask.destroy();
            return;
          }
          entry.doc = doc;
          setDocs((prev) => new Map(prev).set(blob, doc));
        })
        .catch(() => undefined); // illisible : les miniatures de ce fichier restent vides
    }
  }, [blobs]);

  useEffect(() => {
    const opened = entries.current;
    return () => {
      opened.forEach((entry) => {
        entry.closed = true;
        void entry.doc?.loadingTask.destroy();
      });
      opened.clear();
    };
  }, []);

  return blobs.map((blob) => docs.get(blob) ?? null);
}
