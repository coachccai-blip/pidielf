// Petits contrôles communs au filigrane et aux numéros de page.
import { cn } from '@/ui/cn';

/** Choix d'un emplacement sur une grille qui figure la page (3 colonnes). */
export function AnchorGrid<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  /** De gauche à droite et de haut en bas. */
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled}
      className={cn('grid w-fit grid-cols-3 gap-1 rounded-lg border border-line bg-surface-2 p-1', disabled && 'opacity-50')}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn('grid h-11 w-14 place-items-center rounded-md transition-colors duration-150', active ? 'bg-surface shadow-soft' : 'hover:bg-surface/60')}
          >
            {/* Forme et taille changent avec l'état : la couleur n'est pas le seul signal. */}
            <span className={cn('rounded-full', active ? 'size-4 bg-accent ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'size-2 bg-line-strong')} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/** Couleur d'un élément écrit dans le PDF. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <span className="min-w-0 flex-1 text-sm font-bold">{label}</span>
      <span className="text-sm text-ink-soft uppercase tabular-nums">{value}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
      />
    </label>
  );
}
