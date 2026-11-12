// Cadre de sélection et poignées. Ils sont posés sur la page (blanche quel que
// soit le thème) : leurs couleurs sont donc fixes, avec un liseré blanc pour
// rester visibles sur un contenu sombre.
import { boundsOf, handlePoint, handlesOf, type EditorElement, type Handle } from './model';

const BLUE = '#1a73e8';
/** Diamètre visible d'une poignée. */
const DOT = 16;
/** Part de la zone sensible qui reste du côté de l'élément : le reste déborde vers l'extérieur. */
const INSIDE = 10;

const cursors: Record<Handle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', w: 'ew-resize', e: 'ew-resize', p1: 'move', p2: 'move',
};

export function SelectionFrame({ el, width, height, coarse }: { el: EditorElement; width: number; height: number; coarse: boolean }) {
  const b = boundsOf(el);
  const boxed = el.type !== 'line' && el.type !== 'arrow';
  // Zone sensible d'au moins 44 px au doigt ; plus fine à la souris.
  const hit = coarse ? 44 : 26;
  return (
    <div className="pointer-events-none absolute inset-0">
      {boxed && (
        <div
          className="absolute"
          style={{
            left: b.x * width - 3,
            top: b.y * height - 3,
            width: b.w * width + 6,
            height: b.h * height + 6,
            outline: `2px solid ${BLUE}`,
            boxShadow: '0 0 0 3.5px rgba(255,255,255,0.85)',
          }}
        />
      )}
      {handlesOf(el, b.w * width, b.h * height).map((handle) => {
        const p = handlePoint(el, handle);
        // La zone sensible déborde vers l'extérieur pour laisser l'intérieur d'un petit élément saisissable.
        const dx = !boxed ? 0.5 : handle.includes('w') ? (hit - INSIDE) / hit : INSIDE / hit;
        const dy = !boxed || handle === 'w' || handle === 'e' ? 0.5 : handle.startsWith('n') ? (hit - INSIDE) / hit : INSIDE / hit;
        // Les poignées latérales d'un texte s'écartent un peu plus : elles ne doivent pas masquer ses premières lettres.
        const side = handle === 'w' || handle === 'e';
        const offset = side ? 3 + DOT / 2 : 3;
        const cx = p.x * width + (boxed ? (handle.includes('w') ? -offset : offset) : 0);
        const cy = p.y * height + (boxed && !side ? (handle.startsWith('n') ? -offset : offset) : 0);
        return (
          <div
            key={handle}
            data-handle={handle}
            className="pointer-events-auto absolute"
            style={{ left: cx - hit * dx, top: cy - hit * dy, width: hit, height: hit, touchAction: 'none', cursor: cursors[handle] }}
          >
            <span
              className="absolute rounded-full"
              style={{
                left: hit * dx - DOT / 2,
                top: hit * dy - DOT / 2,
                width: DOT,
                height: DOT,
                background: '#ffffff',
                border: `2.5px solid ${BLUE}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
