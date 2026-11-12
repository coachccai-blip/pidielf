// Zone de dessin plein écran pour signer au doigt, au stylet ou à la souris.
// Le trait est lissé et son épaisseur suit la vitesse (ou la pression quand
// l'appareil la mesure). Le résultat est un PNG transparent rogné.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Smartphone, Undo2 } from 'lucide-react';
import { defaultStroke, fitStrokes, keepPoint, strokeSamples, type InkPoint, type Sample } from '@/core/signature/stroke';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Fields';
import { useMedia } from '../editor/PageEditor';
import { Swatches } from '../editor/PropertyBar';
import { INKS, drawSamples, strokesToPng, type SignatureImage } from './raster';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SignaturePad({
  title,
  ink,
  onInk,
  remember,
  onRemember,
  onCancel,
  onDone,
}: {
  title: string;
  ink: string;
  onInk: (color: string) => void;
  remember: boolean;
  onRemember: (value: boolean) => void;
  onCancel: () => void;
  onDone: (image: SignatureImage) => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<InkPoint[][]>([]);
  const [busy, setBusy] = useState(false);
  const current = useRef<InkPoint[] | null>(null);
  const cache = useRef(new WeakMap<InkPoint[], Sample[]>());
  const frame = useRef(0);
  const portraitPhone = useMedia('(orientation: portrait) and (max-width: 700px)');
  const state = useRef({ strokes, ink });
  state.current = { strokes, ink };

  const samplesOf = (stroke: InkPoint[], finished: boolean): Sample[] => {
    if (!finished) return strokeSamples(stroke, defaultStroke);
    let samples = cache.current.get(stroke);
    if (!samples) cache.current.set(stroke, (samples = strokeSamples(stroke, defaultStroke)));
    return samples;
  };

  const redraw = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = canvas.current;
      const ctx = el?.getContext('2d');
      if (!el || !ctx) return;
      const dpr = el.width / Math.max(1, el.clientWidth);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, el.clientWidth, el.clientHeight);
      for (const stroke of state.current.strokes) drawSamples(ctx, samplesOf(stroke, true), state.current.ink);
      if (current.current) drawSamples(ctx, samplesOf(current.current, false), state.current.ink);
    });
  };

  // Le canvas suit la taille de l'écran (rotation du téléphone) : les traits déjà faits sont recadrés.
  useLayoutEffect(() => {
    const box = holder.current;
    const el = canvas.current;
    if (!box || !el) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      el.width = Math.max(1, Math.round(box.clientWidth * dpr));
      el.height = Math.max(1, Math.round(box.clientHeight * dpr));
      setStrokes((list) => fitStrokes(list, box.clientWidth, box.clientHeight));
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(redraw);

  // Fenêtre modale : focus retenu à l'intérieur, Échap pour fermer, page figée derrière.
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    node?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (!node) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Tab') {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointOf = (e: PointerEvent | React.PointerEvent): InkPoint => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, pressure: e.pointerType === 'mouse' ? undefined : e.pressure };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (current.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = [pointOf(e)];
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current;
    if (!stroke || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    // Les positions intermédiaires (entre deux images) donnent un trait plus fidèle.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const event of events.length > 0 ? events : [e.nativeEvent]) {
      const point = pointOf(event);
      if (keepPoint(stroke[stroke.length - 1], point, defaultStroke.minDistance)) stroke.push(point);
    }
    redraw();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current;
    if (!stroke || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    current.current = null;
    setStrokes((list) => [...list, stroke]);
  };

  const validate = async () => {
    setBusy(true);
    const image = await strokesToPng(strokes, ink);
    setBusy(false);
    if (image) onDone(image);
  };

  const empty = strokes.length === 0;
  return createPortal(
    <div ref={dialog} data-modal role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-surface outline-none">
      {/* Téléphone couché : toute la hauteur va au dessin ; le titre reste annoncé par la fenêtre. */}
      <header className="px-4 pt-[max(0.5rem,var(--safe-top))] pb-1.5 [@media(max-height:480px)]:hidden">
        <h2 className="truncate text-xl">{title}</h2>
        {portraitPhone && (
          <p className="flex items-center gap-1.5 text-xs text-ink-soft">
            <Smartphone className="size-4 shrink-0 rotate-90" aria-hidden="true" />
            {t('signer.pad.rotate')}
          </p>
        )}
      </header>
      {/* Feuille blanche quel que soit le thème : c'est le support de l'encre, pas un élément d'interface. */}
      <div ref={holder} className="relative mx-3 min-h-0 flex-1 [@media(max-height:480px)]:mt-[max(0.5rem,var(--safe-top))] overflow-hidden rounded-lg border border-line-strong bg-white">
        <canvas
          ref={canvas}
          role="img"
          aria-label={t('signer.pad.area')}
          className="absolute inset-0 size-full cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-[28%] border-b-2 border-dashed border-[#c5cad0]" aria-hidden="true" />
        {empty && (
          <p className="pointer-events-none absolute inset-x-0 bottom-[calc(28%+0.5rem)] text-center text-sm text-[#7a828a]" aria-hidden="true">
            {t('signer.pad.here')}
          </p>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2 pb-[max(0.5rem,var(--safe-bottom))]">
        <Swatches label={t('signer.ink')} value={ink} colors={INKS} onChange={onInk} />
        <div className="flex gap-1">
          <Button icon={<Undo2 />} disabled={empty} onClick={() => setStrokes((list) => list.slice(0, -1))} aria-label={t('signer.pad.undo')} title={t('signer.pad.undo')}>
            <span className="hidden lg:inline">{t('signer.pad.undo')}</span>
          </Button>
          <Button icon={<Eraser />} disabled={empty} onClick={() => setStrokes([])} aria-label={t('signer.pad.clear')} title={t('signer.pad.clear')}>
            <span className="hidden lg:inline">{t('signer.pad.clear')}</span>
          </Button>
        </div>
        <Checkbox checked={remember} onChange={onRemember} label={t('signer.remember')} />
        <div className="ml-auto flex gap-2">
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={empty || busy} onClick={() => void validate()}>{t('common.confirm')}</Button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
