// Mise en lignes du texte pour l'aperçu. Elle est calculée par le même code que
// l'incrustation dans le PDF (core/pdf/overlays, dans le worker, avec les vraies
// largeurs des polices standard) : l'aperçu coupe les lignes au même endroit.
import { useEffect, useState } from 'react';
import type { TextLayout, TextSpec } from '@/core/pdf/overlays';
import type { OverlayFont } from '@/core/pdf/overlayTypes';
import { pdfOp } from '@/workers/client';

const overlays = pdfOp<typeof import('@/core/pdf/overlays')>('overlays');

/** Polices d'écran de mêmes largeurs que les polices standard du PDF. */
export const FONT_STACKS: Record<OverlayFont, string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", Arimo, sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", Tinos, serif',
  mono: '"Courier New", Courier, "Liberation Mono", Cousine, monospace',
};

const cache = new Map<string, TextLayout>();
const CACHE_LIMIT = 400;

const keyOf = (spec: TextSpec): string =>
  JSON.stringify([spec.text, spec.font, spec.size, !!spec.bold, !!spec.italic, spec.lineHeight ?? 0, Math.round((spec.maxWidth ?? 0) * 100)]);

async function request(spec: TextSpec, key: string): Promise<TextLayout> {
  const [layout] = await overlays('layoutTexts', { items: [spec] });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, layout);
  return layout;
}

/**
 * Mise en lignes d'un texte. Le temps que la nouvelle arrive (quelques
 * millisecondes), on garde la précédente : `fresh` dit si elle correspond bien
 * au texte demandé.
 */
export function useTextLayout(spec: TextSpec): { layout: TextLayout | null; fresh: boolean } {
  const key = keyOf(spec);
  const [state, setState] = useState<{ key: string; layout: TextLayout } | null>(null);
  const cached = cache.get(key);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    const load = (retry: boolean) => {
      request(spec, key)
        .then((layout) => !cancelled && setState({ key, layout }))
        .catch(() => {
          // Le worker a été interrompu (traitement annulé) : on redemande une fois.
          if (retry && !cancelled) setTimeout(() => !cancelled && load(false), 150);
        });
    };
    load(true);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cached]);

  if (cached) return { layout: cached, fresh: true };
  return { layout: state?.layout ?? null, fresh: state?.key === key };
}
