// Gestes sur la surface d'édition : sélectionner, déplacer, tirer une poignée,
// pincer à deux doigts, tracer une forme, poser un texte ou une image.
// Tout passe par les événements « pointer » : doigt, stylet et souris.
import { useEffect, useRef, useState } from 'react';
import {
  LINE_HEIGHT, dragHandle, keepsRatio, moved, scaled,
  type EditorDefaults, type EditorElement, type Handle, type NewElement, type PageSize, type Point,
} from './model';
import { clampPoint, defaultShape, shapeFromDrag } from './shapes';
import type { DrawShape, Editor, Recording } from './useEditor';

type Action =
  | { kind: 'move'; origin: EditorElement; latest: EditorElement; start: Point; wasSelected: boolean; moved: boolean }
  | { kind: 'resize'; origin: EditorElement; latest: EditorElement; handle: Handle }
  | { kind: 'pinch'; origin: EditorElement; latest: EditorElement; distance: number }
  | { kind: 'draw'; shape: DrawShape; start: Point; points: number[][] }
  | { kind: 'tap'; start: Point; target: string | null }
  | { kind: 'background' }
  | { kind: 'ignore' };

interface Options {
  editor: Editor;
  surface: React.RefObject<HTMLDivElement | null>;
  pageSize: PageSize | null;
  defaults: EditorDefaults;
}

export function useGestures({ editor, surface, pageSize, defaults }: Options) {
  const pointers = useRef(new Map<number, Point>());
  const action = useRef<Action | null>(null);
  /** Une étape d'annulation a déjà été créée pendant le geste en cours. */
  const recorded = useRef(false);
  /** Dessin libre : les traits successifs rejoignent le même élément. */
  const inkSession = useRef<string | null>(null);
  const [drawing, setDrawing] = useState<NewElement | null>(null);

  useEffect(() => {
    inkSession.current = null;
  }, [editor.mode, editor.page]);

  const rect = () => surface.current!.getBoundingClientRect();
  const toPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = rect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const spread = (): number => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const record = (): Recording => {
    const mode = recorded.current ? 'none' : 'push';
    recorded.current = true;
    return mode;
  };
  const elementAt = (target: Element): EditorElement | null => {
    const id = target.closest('[data-el]')?.getAttribute('data-el');
    return (id && editor.elements.find((el) => el.id === id)) || null;
  };

  function create(shape: Exclude<DrawShape, 'ink'>, el: NewElement) {
    if (shape === 'highlight') {
      // Le surligneur reste en main : on enchaîne les passages.
      editor.add([el], { select: false });
      return;
    }
    editor.setMode({ kind: 'select' });
    if (shape !== 'cover' || el.type !== 'whiteout' || !pageSize) {
      editor.add([el]);
      return;
    }
    // Cache puis réécriture : le texte s'ouvre sur le cache, à la taille de la ligne masquée.
    editor.add([el], { select: false });
    const heightPt = el.h * pageSize.height;
    const oneLine = heightPt <= 30;
    const size = oneLine ? Math.min(24, Math.max(6, Math.round(heightPt / 1.25))) : defaults.size;
    const inset = 2 / pageSize.width;
    const top = oneLine ? el.y + (heightPt - size * LINE_HEIGHT) / 2 / pageSize.height : el.y + 2 / pageSize.height;
    editor.setDraft({ at: { x: el.x + inset, y: Math.max(0, top) }, width: Math.max(0.02, el.w - 2 * inset), size });
  }

  function addStroke(points: number[][]) {
    const current = inkSession.current ? editor.elements.find((el) => el.id === inkSession.current) : null;
    if (current?.type === 'ink' && current.color === defaults.inkColor && current.width === defaults.inkWidth) {
      editor.replace({ ...current, strokes: [...current.strokes, points] });
    } else {
      [inkSession.current] = editor.add([{ type: 'ink', strokes: [points], color: defaults.inkColor, width: defaults.inkWidth }], { select: false });
    }
  }

  /** Crée l'élément de l'outil actif au centre de la zone visible (clavier). */
  function createAtCenter() {
    const view = editor.view.current;
    if (!view || !pageSize) return;
    const at = view.visibleCenter();
    const mode = editor.mode;
    if (mode.kind === 'draw' && mode.shape !== 'ink') create(mode.shape, defaultShape(mode.shape, at, defaults, pageSize));
    else if (mode.kind === 'text') {
      editor.setMode({ kind: 'select' });
      editor.setDraft({ at });
    } else if (mode.kind === 'place') {
      editor.setMode({ kind: 'select' });
      editor.add([mode.make(at, pageSize)]);
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pageSize || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as Element;
    if (target.closest('textarea')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (editor.editingId || editor.draft) {
      // Un appui hors de la zone de saisie la valide ; il ne fait rien d'autre.
      (document.activeElement as HTMLElement | null)?.blur();
      action.current = { kind: 'ignore' };
      return;
    }
    if (pointers.current.size === 2 && editor.mode.kind === 'select') {
      // Deuxième doigt : on passe au pincement de l'élément sélectionné.
      const a = action.current;
      const el = a && 'latest' in a && a.latest.id === editor.selectedId ? a.latest : editor.selected;
      action.current = el ? { kind: 'pinch', origin: el, latest: el, distance: Math.max(1, spread()) } : { kind: 'ignore' };
      return;
    }
    if (pointers.current.size > 1) return;

    recorded.current = false;
    const point = toPoint(e);
    const mode = editor.mode;
    if (mode.kind === 'draw') {
      const start = clampPoint(point);
      action.current = { kind: 'draw', shape: mode.shape, start, points: [[start.x, start.y]] };
      return;
    }
    const el = elementAt(target);
    if (mode.kind !== 'select') {
      action.current = { kind: 'tap', start: clampPoint(point), target: el?.id ?? null };
      return;
    }
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined;
    if (handle && editor.selected) {
      action.current = { kind: 'resize', origin: editor.selected, latest: editor.selected, handle };
    } else if (el) {
      action.current = { kind: 'move', origin: el, latest: el, start: point, wasSelected: editor.selectedId === el.id, moved: false };
      editor.select(el.id);
      target.closest<SVGGElement>('[data-el]')?.focus({ preventScroll: true });
    } else {
      action.current = { kind: 'background' };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !pageSize) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = action.current;
    if (!a) return;
    const point = toPoint(e);
    const ratio = pageSize.width / pageSize.height;
    switch (a.kind) {
      case 'move': {
        if (!a.moved) {
          // Un petit tremblement n'est pas un déplacement : c'est un appui.
          const r = rect();
          const distance = Math.hypot((point.x - a.start.x) * r.width, (point.y - a.start.y) * r.height);
          if (distance < (e.pointerType === 'mouse' ? 3 : 8)) return;
          a.moved = true;
        }
        a.latest = moved(a.origin, point.x - a.start.x, point.y - a.start.y);
        editor.replace(a.latest, { record: record() });
        break;
      }
      case 'resize':
        a.latest = dragHandle(a.origin, a.handle, point, ratio, keepsRatio(a.origin) || e.shiftKey);
        editor.replace(a.latest, { record: record() });
        break;
      case 'pinch':
        if (pointers.current.size < 2) break;
        a.latest = scaled(a.origin, spread() / a.distance, ratio);
        editor.replace(a.latest, { record: record() });
        break;
      case 'draw': {
        const to = clampPoint(point);
        if (a.shape === 'ink') {
          const [lx, ly] = a.points[a.points.length - 1];
          const r = rect();
          if (Math.hypot((to.x - lx) * r.width, (to.y - ly) * r.height) < 1.5) break;
          a.points.push([to.x, to.y]);
          setDrawing({ type: 'ink', strokes: [a.points.slice()], color: defaults.inkColor, width: defaults.inkWidth });
        } else {
          setDrawing(shapeFromDrag(a.shape, a.start, to, defaults));
        }
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const a = action.current;
    if (pointers.current.size > 0) {
      // Fin du pincement : le doigt restant ne déplace rien tant qu'il n'est pas relevé.
      if (a?.kind === 'pinch') action.current = { kind: 'ignore' };
      return;
    }
    action.current = null;
    if (!a || !pageSize) return;
    switch (a.kind) {
      case 'move':
        // Toucher un texte déjà sélectionné, sans le déplacer : on le modifie.
        if (!a.moved && a.wasSelected && a.origin.type === 'text') editor.setEditing(a.origin.id);
        break;
      case 'background':
        editor.select(null);
        break;
      case 'draw': {
        setDrawing(null);
        if (a.shape === 'ink') {
          addStroke(a.points);
          break;
        }
        const end = clampPoint(toPoint(e));
        const r = rect();
        const tiny = Math.hypot((end.x - a.start.x) * r.width, (end.y - a.start.y) * r.height) < 6;
        create(a.shape, tiny ? defaultShape(a.shape, a.start, defaults, pageSize) : shapeFromDrag(a.shape, a.start, end, defaults));
        break;
      }
      case 'tap': {
        const mode = editor.mode;
        editor.setMode({ kind: 'select' });
        const hit = a.target ? editor.elements.find((el) => el.id === a.target) : null;
        if (mode.kind === 'place') editor.add([mode.make(a.start, pageSize)]);
        else if (hit?.type === 'text') {
          editor.select(hit.id);
          editor.setEditing(hit.id);
        } else editor.setDraft({ at: a.start });
        break;
      }
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    // Le navigateur a repris la main (défilement) : le geste est abandonné.
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) action.current = null;
    setDrawing(null);
  };

  return { drawing, createAtCenter, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
