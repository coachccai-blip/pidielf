// Une feuille dans la grille : miniature à toucher pour la sélectionner, poignée
// numérotée pour la déplacer (souris, doigt ou clavier), bouton d'actions.
import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, MoreVertical } from 'lucide-react';
import { useT } from '@/i18n';
import type { PDFDocumentProxy } from '@/lib/pdfjs';
import { cn } from '@/ui/cn';
import { PageThumb } from '../usePdf';
import type { Sheet } from './plan';

export interface Point { x: number; y: number }

/** Fichier inséré dont vient une page : sa lettre (« B ») et son nom. */
export interface Origin { letter: string; name: string }

export const PageCard = memo(function PageCard({
  sheet,
  index,
  selected,
  pdf,
  origin,
  onToggle,
  onMenu,
}: {
  sheet: Sheet;
  index: number;
  selected: boolean;
  pdf: PDFDocumentProxy | null;
  /** Absent pour les pages du document de départ. */
  origin?: Origin;
  onToggle: (id: string) => void;
  onMenu: (id: string, anchor: Point) => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sheet.id });
  // La miniature se saisit à la souris ou au doigt ; au clavier, Espace doit
  // continuer à la sélectionner : seule la poignée lance un déplacement au clavier.
  const grab = { ...listeners };
  delete grab.onKeyDown;

  const n = index + 1;
  const rotate = sheet.kind === 'page' ? sheet.rotate : 0;
  const caption =
    sheet.kind === 'blank' ? t('organiser.blank') : origin ? `${origin.letter} · ${t('organiser.origin', { page: sheet.page })}` : t('organiser.origin', { page: sheet.page });
  const what =
    sheet.kind === 'blank'
      ? t('organiser.blankLong')
      : origin
        ? t('organiser.fromFile', { page: sheet.page, name: origin.name })
        : t('organiser.fromOriginal', { page: sheet.page });
  const label = t('organiser.sheet', { n, what: rotate ? `${what}, ${t('organiser.rotated', { angle: rotate })}` : what });

  return (
    <li
      ref={setNodeRef}
      data-sheet={sheet.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex min-w-0 flex-col rounded-lg border-2 p-1 transition-colors duration-150',
        selected ? 'border-cat-ink bg-cat text-cat-ink' : 'border-transparent bg-surface-2',
        isDragging && 'relative z-10 shadow-lift',
      )}
    >
      <button
        type="button"
        {...grab}
        aria-pressed={selected}
        // Le nom lu reprend aussi le texte visible de la carte, pour la commande vocale.
        aria-label={`${label} — ${rotate !== 0 ? `${rotate}° ` : ''}${caption}`}
        onClick={() => onToggle(sheet.id)}
        className="relative block w-full touch-manipulation rounded-md select-none [-webkit-touch-callout:none]"
      >
        {/* La rotation d'aperçu tourne la case carrée entière : la page reste entière et à la même échelle, quelle que soit son orientation. */}
        <span className="grid aspect-square w-full place-items-center transition-transform duration-200" style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined }}>
          {sheet.kind === 'page' ? (
            <PageThumb pdf={pdf} page={sheet.page} width={150} contain />
          ) : (
            // Page blanche : une feuille vide aux proportions de la page créée.
            <span
              className="block border border-line-strong bg-white shadow-soft"
              style={{ aspectRatio: `${sheet.width} / ${sheet.height}`, width: sheet.width >= sheet.height ? '100%' : `${(sheet.width / sheet.height) * 100}%` }}
            />
          )}
        </span>
        <span
          className={cn(
            'absolute top-1 left-1 grid size-6 place-items-center rounded-full border-2',
            selected ? 'border-cat-ink bg-cat-ink text-cat' : 'border-line-strong bg-surface/85',
          )}
          aria-hidden="true"
        >
          {selected && <Check className="size-4" strokeWidth={3} />}
        </span>
        {rotate !== 0 && (
          <span className="absolute top-1 right-1 rounded-full bg-surface px-1.5 text-xs font-bold text-ink shadow-soft tabular-nums">{rotate}°</span>
        )}
        <span className={cn('mt-0.5 block truncate text-center text-xs', !selected && 'text-ink-soft')}>{caption}</span>
      </button>
      <div className="flex items-center justify-between">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t('organiser.drag', { n })}
          title={t('organiser.drag', { n })}
          className="inline-flex min-h-11 min-w-11 cursor-grab touch-none items-center gap-0.5 rounded-md pr-1.5 text-sm font-bold tabular-nums select-none hover:bg-surface/60 active:cursor-grabbing"
        >
          <GripVertical className="size-4 shrink-0 opacity-70" aria-hidden="true" />
          {n}
        </button>
        <button
          type="button"
          aria-label={t('organiser.actions', { n })}
          title={t('organiser.actions', { n })}
          aria-haspopup="menu"
          className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-surface/60"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            onMenu(sheet.id, { x: box.left, y: box.bottom });
          }}
        >
          <MoreVertical className="size-5" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
});
