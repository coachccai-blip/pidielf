// Organiser les pages : grille de miniatures à réordonner, supprimer, dupliquer,
// pivoter, compléter d'une page blanche ou des pages d'un autre PDF.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine, CheckCheck, CopyPlus, File, FilePlus2, Plus, Redo2, RotateCcw, RotateCw, Trash2, Undo2, X,
} from 'lucide-react';
import { classifyError } from '@/core/errors';
import { suggestName } from '@/core/naming';
import { useT } from '@/i18n';
import { Button, IconButton } from '@/ui/Button';
import { Menu, type MenuSection } from '@/ui/Overlay';
import { toastError } from '@/ui/toast';
import { pdfOp } from '@/workers/client';
import { pickFiles } from '@/features/library/import';
import { inputBytes, pdfBlob, prepareFiles } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { InputFile, ToolProps } from '../types';
import { PageCard, type Origin, type Point } from './PageCard';
import {
  A4, blankSheet, commit, dropSheets, duplicateSheets, insertSheets, isUntouched, lastOf, redo, removeSheets, rotateSheets, rotatedSize, sendSheets, shiftSheets,
  sourceSheets, startHistory, toOrganizePlan, undo, type History, type Sheet, type Size,
} from './plan';
import { MouseOrPenSensor } from './sensors';
import { usePdfs } from './usePdfs';

const organize = pdfOp<typeof import('@/core/pdf/organize')>('organize');

// L'outil est remonté quand on revient du résultat vers les réglages : le
// travail en cours sur ce fichier (plan, historique, PDF insérés) est gardé ici.
let draft: { key: string; history: History<Sheet[]>; extra: InputFile[] } | null = null;

// Réglages des capteurs, hors du composant : des objets stables évitent de
// redessiner toutes les miniatures à chaque sélection (dnd-kit compare par identité).
const MOUSE = { activationConstraint: { distance: 6 } };
const TOUCH = { activationConstraint: { delay: 180, tolerance: 8 } };
const KEYBOARD = { coordinateGetter: sortableKeyboardCoordinates };

/** Lettre d'un PDF inséré, telle qu'elle apparaît sous ses pages : B, C, D… */
const letterOf = (source: number): string => (source < 26 ? String.fromCharCode(65 + source) : `#${source + 1}`);

const below = (el: HTMLElement): Point => {
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.bottom + 4 };
};

export default function Organiser(props: ToolProps) {
  return <Organizer key={props.inputs[0].key} {...props} />;
}

function Organizer({ tool, inputs, run }: ToolProps) {
  const t = useT();
  const input = inputs[0];
  const [history, setHistory] = useState(() => (draft?.key === input.key ? draft.history : startHistory(sourceSheets(0, input.pageCount))));
  const [extra, setExtra] = useState<InputFile[]>(() => (draft?.key === input.key ? draft.extra : []));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; anchor: Point } | null>(null);
  const [insertMenu, setInsertMenu] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const plan = history.present;
  const sources = useMemo(() => [input, ...extra], [input, extra]);
  const pdfs = usePdfs(useMemo(() => sources.map((s) => s.blob), [sources]));
  const ids = useMemo(() => plan.map((s) => s.id), [plan]);
  // La sélection ne garde que les feuilles encore présentes (après une suppression ou une annulation).
  const selection = useMemo(() => new Set(ids.filter((id) => selected.has(id))), [ids, selected]);
  const origins = useMemo(() => sources.map((s, i): Origin | undefined => (i === 0 ? undefined : { letter: letterOf(i), name: s.name })), [sources]);

  // Derniers états, pour les actions asynchrones et les rappels stables passés aux cartes.
  const live = useRef({ plan, pdfs, sources, selection });
  live.current = { plan, pdfs, sources, selection };

  useEffect(() => {
    draft = { key: input.key, history, extra };
  }, [input.key, history, extra]);

  const apply = useCallback((change: (plan: Sheet[]) => Sheet[]) => setHistory((h) => commit(h, change(h.present))), []);
  const goBack = useCallback(() => setHistory(undo), []);
  const goForward = useCallback(() => setHistory(redo), []);

  // Annuler / rétablir au clavier, sauf pendant une saisie ou quand un menu est ouvert.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (!root.current || root.current.offsetParent === null) return; // outil masqué pendant le traitement
      if (document.querySelector('[data-modal]') || (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) goForward();
        else goBack();
      } else if (key === 'y') {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goForward]);

  const sensors = useSensors(useSensor(MouseOrPenSensor, MOUSE), useSensor(TouchSensor, TOUCH), useSensor(KeyboardSensor, KEYBOARD));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    apply((p) => dropSheets(p, live.current.selection, String(active.id), String(over.id)));
  };
  const position = (id: UniqueIdentifier | undefined) => live.current.plan.findIndex((s) => s.id === id) + 1;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const openMenu = useCallback((id: string, anchor: Point) => setMenu({ id, anchor }), []);

  /** Taille affichée d'une feuille, rotation comprise : celle que prendra une page blanche voisine. */
  const sizeOf = async (sheet: Sheet): Promise<Size> => {
    if (sheet.kind === 'blank') return { width: sheet.width, height: sheet.height };
    try {
      const page = await live.current.pdfs[sheet.source]?.getPage(sheet.page);
      if (!page) return A4;
      const view = page.getViewport({ scale: 1 });
      return rotatedSize({ width: view.width, height: view.height }, sheet.rotate);
    } catch {
      return A4;
    }
  };

  // Les feuilles insérées deviennent la sélection et sont amenées à l'écran :
  // on voit ce qui vient d'arriver, prêt à être déplacé.
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    if (!arrived.current) return;
    root.current?.querySelector(`[data-sheet="${arrived.current}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    arrived.current = null;
  }, [plan]);
  const welcome = (sheets: Sheet[]) => {
    setSelected(new Set(sheets.map((s) => s.id)));
    arrived.current = sheets[0].id;
  };

  const insertBlank = async (anchor: string | null) => {
    const current = live.current.plan;
    const neighbour = anchor ? current.find((s) => s.id === anchor) : current[current.length - 1];
    const sheet = blankSheet(neighbour ? await sizeOf(neighbour) : A4);
    apply((p) => insertSheets(p, anchor, [sheet]));
    welcome([sheet]);
  };

  const insertPdf = async (anchor: string | null) => {
    const files = await pickFiles({ accept: 'application/pdf,.pdf', multiple: true });
    if (files.length === 0) return;
    setBusy(true);
    try {
      // prepareFiles compte les pages et demande le mot de passe des PDF protégés.
      const { inputs: added, rejected } = await prepareFiles(files, tool);
      if (rejected > 0) toastError(t('tools.choose.rejectedPdf', { count: rejected }));
      if (added.length === 0) return;
      const first = live.current.sources.length;
      const sheets = added.flatMap((file, k) => sourceSheets(first + k, file.pageCount));
      setExtra((prev) => [...prev, ...added]);
      apply((p) => insertSheets(p, anchor, sheets));
      welcome(sheets);
    } catch (err) {
      console.error(err);
      toastError(t(classifyError(err) === 'damaged' ? 'errors.damaged.title' : 'errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    const { used, items } = toOrganizePlan(plan);
    run(async (ctx) => {
      const bytes = await Promise.all(used.map((i) => inputBytes(sources[i])));
      const out = await organize('organizePdf', { sources: bytes, plan: items }, ctx);
      return [{ name: suggestName(input.name, t('organiser.suffix')), blob: pdfBlob(out), pageCount: plan.length }];
    });
  };

  const all = plan.length > 0 && selection.size === plan.length;
  const anchor = lastOf(plan, selection);
  const menuIndex = menu ? plan.findIndex((s) => s.id === menu.id) : -1;
  const one = useMemo(() => new Set(menu ? [menu.id] : []), [menu]);

  const insertItems = (after: string | null) => [
    { id: 'blank', label: t('organiser.insertBlank'), icon: <File />, onSelect: () => void insertBlank(after) },
    { id: 'pdf', label: t('organiser.insertPdf'), icon: <FilePlus2 />, disabled: busy, onSelect: () => void insertPdf(after) },
  ];
  const pageMenu: MenuSection[] = [
    {
      items: [
        { id: 'earlier', label: t('organiser.moveEarlier'), icon: <ArrowLeft />, disabled: menuIndex <= 0, onSelect: () => apply((p) => shiftSheets(p, one, -1)) },
        { id: 'later', label: t('organiser.moveLater'), icon: <ArrowRight />, disabled: menuIndex === plan.length - 1, onSelect: () => apply((p) => shiftSheets(p, one, 1)) },
        { id: 'first', label: t('organiser.moveFirst'), icon: <ArrowLeftToLine />, disabled: menuIndex <= 0, onSelect: () => apply((p) => sendSheets(p, one, 'start')) },
        { id: 'last', label: t('organiser.moveLast'), icon: <ArrowRightToLine />, disabled: menuIndex === plan.length - 1, onSelect: () => apply((p) => sendSheets(p, one, 'end')) },
      ],
    },
    {
      items: [
        { id: 'left', label: t('organiser.rotateLeft'), icon: <RotateCcw />, onSelect: () => apply((p) => rotateSheets(p, one, -90)) },
        { id: 'right', label: t('organiser.rotateRight'), icon: <RotateCw />, onSelect: () => apply((p) => rotateSheets(p, one, 90)) },
        { id: 'copy', label: t('organiser.duplicate'), icon: <CopyPlus />, onSelect: () => apply((p) => duplicateSheets(p, one)) },
      ],
    },
    { title: t('organiser.insertAfterThis'), items: insertItems(menu?.id ?? null) },
    { items: [{ id: 'delete', label: t('common.delete'), icon: <Trash2 />, danger: true, onSelect: () => apply((p) => removeSheets(p, one)) }] },
  ];

  return (
    <>
      <ToolLayout
        wide
        preview={
          <div ref={root} className="flex flex-col gap-3">
            <p className="text-sm text-ink-soft">{t('organiser.hint')}</p>

            <div role="group" aria-label={t('organiser.toolbar')} className="sticky top-0 z-10 -mx-1 flex items-center gap-1.5 bg-page/95 px-1 py-1.5 backdrop-blur">
              <Button
                icon={all ? <X /> : <CheckCheck />}
                disabled={plan.length === 0}
                aria-label={all ? t('organiser.selectNone') : t('organiser.selectAll')}
                onClick={() => setSelected(all ? new Set() : new Set(ids))}
              >
                <span className="sm:hidden">{all ? t('organiser.noneShort') : t('organiser.allShort')}</span>
                <span className="hidden sm:inline">{all ? t('organiser.selectNone') : t('organiser.selectAll')}</span>
              </Button>
              <Button icon={<Plus />} aria-haspopup="menu" onClick={(e) => setInsertMenu(below(e.currentTarget))}>{t('organiser.insert')}</Button>
              <span className="flex-1" />
              <IconButton label={t('organiser.undo')} disabled={history.past.length === 0} onClick={goBack}><Undo2 /></IconButton>
              <IconButton label={t('organiser.redo')} disabled={history.future.length === 0} onClick={goForward}><Redo2 /></IconButton>
            </div>

            {plan.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-ink-soft">{t('organiser.emptyText')}</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
                accessibility={{
                  screenReaderInstructions: { draggable: t('organiser.dnd.instructions') },
                  announcements: {
                    onDragStart: ({ active }) => t('organiser.dnd.start', { n: position(active.id) }),
                    onDragOver: ({ over }) => (over ? t('organiser.dnd.over', { n: position(over.id) }) : undefined),
                    onDragEnd: ({ over }) => (over ? t('organiser.dnd.end', { n: position(over.id) }) : t('organiser.dnd.cancel')),
                    onDragCancel: () => t('organiser.dnd.cancel'),
                  },
                }}
              >
                <SortableContext items={ids} strategy={rectSortingStrategy}>
                  <ol
                    className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 xl:grid-cols-6"
                    onKeyDown={(e) => {
                      if (e.key === 'Delete' && selection.size > 0) apply((p) => removeSheets(p, selection));
                    }}
                  >
                    {plan.map((sheet, index) => (
                      <PageCard
                        key={sheet.id}
                        sheet={sheet}
                        index={index}
                        selected={selection.has(sheet.id)}
                        pdf={sheet.kind === 'page' ? pdfs[sheet.source] : null}
                        origin={sheet.kind === 'page' ? origins[sheet.source] : undefined}
                        onToggle={toggle}
                        onMenu={openMenu}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            )}

            <p className="sr-only" role="status">{selection.size > 0 ? t('organiser.selected', { count: selection.size }) : ''}</p>
            {selection.size > 0 && (
              // Collée en bas de la grille, juste au-dessus du bouton principal (lui-même collé en bas
              // de l'écran sur mobile) et de la barre de navigation.
              <div
                role="group"
                aria-label={t('organiser.selectionBar')}
                className="sticky bottom-[calc(11rem+var(--safe-bottom))] z-20 flex max-w-full items-stretch gap-0.5 self-stretch overflow-x-auto rounded-xl border border-line-strong bg-surface p-1 shadow-lift sm:self-center md:bottom-[6.75rem] lg:bottom-4"
              >
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  aria-label={t('organiser.clearSelection', { count: selection.size })}
                  title={t('organiser.clearSelection', { count: selection.size })}
                  className="inline-flex min-h-11 min-w-12 shrink-0 items-center justify-center gap-0.5 rounded-md border border-cat-ink/30 bg-cat px-1.5 text-sm font-bold text-cat-ink tabular-nums"
                >
                  <X className="size-4" aria-hidden="true" />
                  {selection.size}
                </button>
                <BarButton label={t('organiser.moveEarlier')} short={t('organiser.short.earlier')} icon={<ArrowLeft />} onClick={() => apply((p) => shiftSheets(p, selection, -1))} />
                <BarButton label={t('organiser.moveLater')} short={t('organiser.short.later')} icon={<ArrowRight />} onClick={() => apply((p) => shiftSheets(p, selection, 1))} />
                <BarButton label={t('organiser.rotateLeft')} short={t('organiser.short.left')} icon={<RotateCcw />} onClick={() => apply((p) => rotateSheets(p, selection, -90))} />
                <BarButton label={t('organiser.rotateRight')} short={t('organiser.short.right')} icon={<RotateCw />} onClick={() => apply((p) => rotateSheets(p, selection, 90))} />
                <BarButton label={t('organiser.duplicate')} short={t('organiser.short.duplicate')} icon={<CopyPlus />} onClick={() => apply((p) => duplicateSheets(p, selection))} />
                <BarButton label={t('common.delete')} short={t('common.delete')} icon={<Trash2 />} danger onClick={() => apply((p) => removeSheets(p, selection))} />
              </div>
            )}
          </div>
        }
        options={
          <>
            {extra.some((_, i) => plan.some((s) => s.kind === 'page' && s.source === i + 1)) && (
              <OptionGroup title={t('organiser.filesTitle')}>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {extra.map((file, i) =>
                    plan.some((s) => s.kind === 'page' && s.source === i + 1) ? (
                      <li key={file.key} className="flex items-baseline gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-cat text-xs font-bold text-cat-ink">{letterOf(i + 1)}</span>
                        <span className="min-w-0 break-words">{file.name} <span className="text-ink-soft">· {t('common.pages', { count: file.pageCount })}</span></span>
                      </li>
                    ) : null,
                  )}
                </ul>
              </OptionGroup>
            )}
            <OptionGroup title={t('organiser.helpTitle')}>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-soft">
                <li>{t('organiser.help.select')}</li>
                <li>{t('organiser.help.move')}</li>
                <li>{t('organiser.help.more')}</li>
                <li>{t('organiser.help.insert')}</li>
                <li>{t('organiser.help.keys')}</li>
              </ul>
            </OptionGroup>
          </>
        }
        actionLabel={t('organiser.action')}
        actionHint={
          plan.length === 0
            ? t('organiser.empty')
            : isUntouched(plan, input.pageCount)
              ? t('organiser.unchanged')
              : t('organiser.summary', { count: plan.length })
        }
        actionDisabled={plan.length === 0}
        onAction={start}
      />

      <Menu
        open={!!menu && menuIndex >= 0}
        onClose={() => setMenu(null)}
        title={t('tools.pageN', { n: menuIndex + 1 })}
        anchor={menu?.anchor}
        sections={pageMenu}
      />
      <Menu
        open={!!insertMenu}
        onClose={() => setInsertMenu(null)}
        title={t('organiser.insert')}
        anchor={insertMenu}
        sections={[{ title: anchor ? t('organiser.insertAfter', { n: ids.indexOf(anchor) + 1 }) : t('organiser.insertEnd'), items: insertItems(anchor) }]}
      />
    </>
  );
}

/** Action de la barre de sélection : icône seule sur téléphone, avec un mot dessous dès qu'il y a la place. */
function BarButton({ label, short, icon, danger, onClick }: { label: string; short: string; icon: ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 transition-colors duration-150 hover:bg-surface-2 sm:min-w-16 sm:px-2 sm:py-1 [&>svg]:size-5 ${danger ? 'text-danger' : 'text-ink'}`}
    >
      {icon}
      <span className="hidden text-xs font-semibold sm:block" aria-hidden="true">{short}</span>
    </button>
  );
}
