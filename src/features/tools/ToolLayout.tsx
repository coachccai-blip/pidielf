// Mise en page commune de l'étape « Régler » : aperçu en direct + options.
// Sur mobile, l'action principale reste en bas de l'écran, à portée de pouce.
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';

export function ToolLayout({
  preview,
  options,
  actionLabel,
  onAction,
  actionDisabled,
  actionHint,
  wide,
}: {
  /** Aperçu qui se met à jour en direct. */
  preview?: ReactNode;
  /** Réglages de l'outil. */
  options?: ReactNode;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  /** Explique pourquoi l'action est indisponible, ou ce qu'elle va produire. */
  actionHint?: string;
  /** Donne plus de place à l'aperçu (grilles de miniatures, éditeurs). */
  wide?: boolean;
}) {
  return (
    <div className={cn('grid gap-5 lg:items-start', !!options && !!preview && (wide ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : 'lg:grid-cols-[minmax(0,1fr)_23rem]'))}>
      {preview && <div className="min-w-0">{preview}</div>}
      {/* Sur mobile, ce conteneur s'efface : le bouton d'action devient un enfant direct de la grille
          et reste collé en bas de l'écran pendant tout le défilement de l'aperçu. */}
      <div className="contents lg:sticky lg:top-4 lg:flex lg:min-w-0 lg:flex-col lg:gap-4 lg:self-start">
        {options && <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-soft">{options}</div>}
        <div className="sticky bottom-[calc(4.25rem+var(--safe-bottom))] z-20 -mx-4 border-t border-line bg-page/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 md:bottom-0 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          {actionHint && <p className="mb-1.5 text-sm text-ink-soft lg:mb-2" aria-live="polite">{actionHint}</p>}
          <Button variant="primary" size="lg" block onClick={onAction} disabled={actionDisabled} className="max-lg:min-h-12">
            {actionLabel}
            <ArrowRight className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Titre de groupe dans le panneau d'options. */
export function OptionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 font-display text-xl font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}
