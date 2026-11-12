// Appui long (tactile) et clic droit (souris) : même menu, sans dépendre du survol.
import { useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';

export interface PressPoint { x: number; y: number }

export function useLongPress(onLongPress: (point: PressPoint) => void, delay = 480) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<PressPoint | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: (e: RPointerEvent) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(12);
        onLongPress(start.current!);
      }, delay);
    },
    onPointerMove: (e: RPointerEvent) => {
      if (!start.current || !timer.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: RMouseEvent) => {
      e.preventDefault();
      clear();
      if (!fired.current) onLongPress({ x: e.clientX, y: e.clientY });
      fired.current = true;
    },
    /** À appeler dans onClick : annule le clic qui suit un appui long. */
    consumeClick: (e: RMouseEvent): boolean => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      return false;
    },
  };
}
