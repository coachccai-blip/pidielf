// Fenêtres modales, tiroirs et menus. Un tiroir bas sur mobile devient
// un panneau latéral (ou une fenêtre centrée) sur grand écran.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from './cn';
import { IconButton } from './Button';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;

function useModal(open: boolean, onClose: () => void, ref: React.RefObject<HTMLDivElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    openCount++;
    document.documentElement.style.overflow = 'hidden';
    // Place le focus dans la fenêtre.
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (!node) return;
      // Seule la fenêtre la plus haute réagit.
      const all = document.querySelectorAll('[data-modal]');
      if (all[all.length - 1] !== node) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openCount--;
      if (openCount === 0) document.documentElement.style.overflow = '';
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, ref]);
}

interface BaseProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Masque visuellement le titre (il reste lu par les lecteurs d'écran). */
  hideTitle?: boolean;
  className?: string;
}

/** Fenêtre centrée (bureau) ou tiroir bas (mobile). */
export function Dialog({ open, onClose, title, children, footer, hideTitle, className, size = 'md' }: BaseProps & { size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useModal(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        data-modal
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full animate-sheet flex-col rounded-t-xl bg-surface shadow-lift outline-none sm:animate-rise sm:rounded-xl',
          size === 'sm' && 'sm:max-w-sm',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-3xl',
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <header className={cn('flex items-center gap-2 px-5 pt-3 pb-1 sm:pt-4', hideTitle && 'sr-only')}>
          <h2 className="flex-1 text-2xl">{title}</h2>
          <IconButton label={t('common.close')} onClick={onClose} className="-mr-2">
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,var(--safe-bottom))]">
            {footer}
          </footer>
        )}
        {!footer && <div className="safe-b" />}
      </div>
    </div>,
    document.body,
  );
}

/** Panneau latéral droit (bureau) ou tiroir bas (mobile). */
export function Drawer({ open, onClose, title, children, footer, className }: BaseProps) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useModal(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-end md:items-stretch">
      <div className="absolute inset-0 animate-fade-in bg-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        data-modal
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[88dvh] w-full animate-sheet flex-col rounded-t-xl bg-surface shadow-lift outline-none md:max-h-none md:w-[24rem] md:animate-side md:rounded-none md:rounded-l-xl',
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line md:hidden" aria-hidden="true" />
        <header className="flex items-center gap-2 px-5 pt-3 pb-1 md:pt-[max(1rem,var(--safe-top))]">
          <h2 className="flex-1 text-2xl">{title}</h2>
          <IconButton label={t('common.close')} onClick={onClose} className="-mr-2">
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,var(--safe-bottom))]">
            {footer}
          </footer>
        )}
        {!footer && <div className="safe-b" />}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Catégorie d'outil : colore la pastille de l'icône. */
  cat?: string;
  onSelect: () => void;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

/**
 * Menu contextuel : ancré au pointeur sur grand écran, tiroir bas sur mobile.
 * S'ouvre par clic droit comme par appui long : rien ne dépend du survol.
 */
export function Menu({
  open,
  onClose,
  title,
  sections,
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sections: MenuSection[];
  anchor?: { x: number; y: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(open, onClose, ref);
  if (!open) return null;
  const wide = window.matchMedia('(min-width: 768px)').matches && anchor;
  const style = wide
    ? {
        left: Math.max(8, Math.min(anchor.x, window.innerWidth - 300)),
        top: Math.max(8, Math.min(anchor.y, window.innerHeight - 440)),
      }
    : undefined;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end">
      <div
        className={cn('absolute inset-0', wide ? '' : 'animate-fade-in bg-overlay')}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        ref={ref}
        data-modal
        role="menu"
        aria-label={title}
        tabIndex={-1}
        style={style}
        className={cn(
          'scrollbar-thin bg-surface shadow-lift outline-none',
          wide
            ? 'absolute max-h-[min(440px,90dvh)] w-72 animate-rise overflow-y-auto rounded-lg border border-line py-1.5'
            : 'relative max-h-[80dvh] w-full animate-sheet overflow-y-auto rounded-t-xl pt-2 pb-[max(0.75rem,var(--safe-bottom))]',
        )}
      >
        {!wide && (
          <>
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
            <p className="truncate px-5 py-2 font-display text-xl font-semibold">{title}</p>
          </>
        )}
        {sections.map((section, i) => (
          <div key={i} className={cn(i > 0 && 'mt-1 border-t border-line pt-1')}>
            {section.title && (
              <p className="px-5 pt-2 pb-1 text-xs font-bold tracking-wide text-ink-soft uppercase md:px-4">{section.title}</p>
            )}
            {section.items.map((item) => (
              <button
                key={item.id}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 px-5 py-2 text-left text-[0.95rem] hover:bg-surface-2 disabled:opacity-40 md:px-4',
                  item.danger && 'text-danger',
                )}
              >
                {item.icon && (
                  <span
                    data-cat={item.cat}
                    className={cn('grid size-8 shrink-0 place-items-center rounded-md [&>svg]:size-[1.1rem]', item.cat && 'bg-cat text-cat-ink')}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
