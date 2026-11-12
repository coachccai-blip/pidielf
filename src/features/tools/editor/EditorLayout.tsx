// Mise en page des outils bâtis sur l'éditeur de page. Elle reprend celle de
// ToolLayout (aperçu + colonne d'options + action principale), avec une
// différence : sur mobile, la barre de propriétés de l'élément sélectionné
// partage la zone du bas avec l'action principale, à portée de pouce.
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { useT } from '@/i18n';
import type { PDFDocumentProxy } from '@/lib/pdfjs';
import { Button } from '@/ui/Button';
import type { EditorDefaults, PageSize } from './model';
import { PageEditor, useMedia } from './PageEditor';
import { PropertyBar, hasProperties } from './PropertyBar';
import type { Editor } from './useEditor';

export function EditorLayout({
  editor,
  pdf,
  pageCount,
  defaults,
  onDefaults,
  toolbar,
  side,
  fixedRatio,
  actionLabel,
  actionHint,
  actionDisabled,
  onAction,
}: {
  editor: Editor;
  pdf: PDFDocumentProxy | null;
  pageCount: number;
  defaults: EditorDefaults;
  onDefaults: (patch: Partial<EditorDefaults>) => void;
  /** Palette de l'outil, au-dessus de la page. */
  toolbar?: ReactNode;
  /** Contenu propre à l'outil dans la colonne latérale (sous la page sur mobile). */
  side?: ReactNode;
  fixedRatio?: boolean;
  actionLabel: string;
  actionHint?: string;
  actionDisabled?: boolean;
  onAction: () => void;
}) {
  const t = useT();
  const desktop = useMedia('(min-width: 1024px)');
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(editor);
  latest.current = editor;

  // Raccourcis valables partout dans l'outil, même quand le focus est retombé sur la page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = root.current;
      // Outil masqué pendant le traitement, ou fenêtre ouverte par-dessus : on ne touche à rien.
      if (!el || el.offsetParent === null || document.querySelector('[data-modal]')) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select')) return;
      const ed = latest.current;
      const key = e.key.toLowerCase();
      const command = e.ctrlKey || e.metaKey;
      if (command && !e.altKey && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
        ed.announce(t(e.shiftKey ? 'editor.redone' : 'editor.undone'));
      } else if (command && !e.altKey && key === 'y') {
        e.preventDefault();
        ed.redo();
        ed.announce(t('editor.redone'));
      } else if (e.key === 'Escape') {
        if (ed.mode.kind !== 'select') ed.setMode({ kind: 'select' });
        else if (ed.selectedId) ed.select(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [t]);

  // Format de toutes les pages, lu une seule fois, à la première demande.
  const sizes = useRef<{ pdf: PDFDocumentProxy; value: Promise<PageSize[]> } | null>(null);
  const pageSizes = (): Promise<PageSize[]> => {
    if (!pdf) return Promise.resolve([]);
    if (sizes.current?.pdf !== pdf) {
      const value = Promise.all(
        Array.from({ length: pageCount }, async (_, i) => {
          const viewport = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
          return { width: viewport.width, height: viewport.height };
        }),
      );
      sizes.current = { pdf, value };
    }
    return sizes.current.value;
  };

  const properties = hasProperties(editor, defaults);
  const bar = (variant: 'bar' | 'panel') => (
    <PropertyBar editor={editor} defaults={defaults} onDefaults={onDefaults} pageCount={pageCount} pageSizes={pageSizes} variant={variant} fixedRatio={fixedRatio} />
  );
  // Un appui sur un bouton de réglage ne doit pas refermer la saisie de texte en cours.
  const keepFocus = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('input, select, textarea')) e.preventDefault();
  };
  const action = (compact: boolean) => (
    <>
      {/* Sur mobile, la barre de propriétés prend la place du rappel : la page garde un maximum de hauteur. */}
      {actionHint && <p className={compact ? 'sr-only' : 'mb-2 text-sm text-ink-soft'} aria-live="polite">{actionHint}</p>}
      <Button variant="primary" size="lg" block onClick={onAction} disabled={actionDisabled}>
        {actionLabel}
        <ArrowRight className="size-5" aria-hidden="true" />
      </Button>
    </>
  );

  return (
    <div ref={root} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <PageEditor editor={editor} pdf={pdf} pageCount={pageCount} defaults={defaults} toolbar={toolbar} />
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        {desktop && (
          <div className="rounded-xl border border-line bg-surface p-4 shadow-soft" onMouseDown={keepFocus}>
            {properties ? bar('panel') : <p className="text-sm text-ink-soft">{t('editor.noSelection')}</p>}
          </div>
        )}
        {side}
        {desktop && <div>{action(false)}</div>}
      </div>
      {!desktop && (
        // Enfant direct de la grille : la zone reste collée en bas tout au long du défilement.
        <div className="sticky bottom-[calc(4.5rem+var(--safe-bottom))] z-20 -mx-4 min-w-0 border-t border-line bg-page/95 px-4 py-3 backdrop-blur md:bottom-0">
          {properties && <div className="mb-2" onMouseDown={keepFocus}>{bar('bar')}</div>}
          {action(properties)}
        </div>
      )}
    </div>
  );
}
