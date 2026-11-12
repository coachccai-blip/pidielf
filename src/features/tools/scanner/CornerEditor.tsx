// Réglage des quatre coins d'une page photographiée : poignées à faire glisser
// (doigt, souris) ou à déplacer au clavier, avec une loupe pour viser juste.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isValidQuad, type Point, type Quad } from '@/core/image/geometry';
import { useT } from '@/i18n';
import type { QuarterTurn } from '@/lib/images';
import { cn } from '@/ui/cn';

/** Zone tactile d'une poignée (le repère visible fait 24 px). */
const HIT = 44;
/** Marge autour de la photo : une poignée posée dans un angle reste entièrement saisissable. */
const PAD = HIT / 2;
const LOUPE = 112;
const ZOOM = 2.5;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function CornerEditor({
  source,
  rotation,
  quad,
  onChange,
  maxHeight,
}: {
  /** Photo (non tournée) à l'échelle de l'aperçu. */
  source: HTMLCanvasElement;
  rotation: QuarterTurn;
  /** Coins en coordonnées normalisées (0 – 1) de la photo tournée. */
  quad: Quad;
  onChange: (quad: Quad) => void;
  /** Hauteur disponible, en pixels CSS. */
  maxHeight: number;
}) {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLCanvasElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);
  // Pendant un geste, les coins suivent le pointeur ici ; ils sont transmis au relâchement.
  const [draft, setDraft] = useState(quad);
  const latest = useRef(draft);
  const drag = useRef<{ index: number; dx: number; dy: number } | null>(null);
  /** Coin montré dans la loupe : celui qu'on fait glisser ou qu'on déplace au clavier. */
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    latest.current = quad;
    setDraft(quad);
  }, [quad]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const quarter = rotation === 90 || rotation === 270;
  const imageWidth = quarter ? source.height : source.width;
  const imageHeight = quarter ? source.width : source.height;
  const scale = Math.max(0, Math.min((available - 2 * PAD) / imageWidth, (maxHeight - 2 * PAD) / imageHeight));
  const width = Math.max(1, Math.floor(imageWidth * scale));
  const height = Math.max(1, Math.floor(imageHeight * scale));

  // La photo, tournée comme l'utilisateur l'a demandé.
  useEffect(() => {
    const canvas = photo.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    ctx.translate(imageWidth / 2, imageHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
  }, [source, rotation, imageWidth, imageHeight]);

  // La loupe agrandit la zone située sous le coin actif.
  useEffect(() => {
    const canvas = loupe.current;
    const from = photo.current;
    const ctx = canvas?.getContext('2d');
    if (active === null || !canvas || !from || !ctx) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = LOUPE * density;
    const span = (LOUPE / ZOOM) * (imageWidth / width); // pixels de la photo visibles dans la loupe
    const point = draft[active];
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(from, point.x * imageWidth - span / 2, point.y * imageHeight - span / 2, span, span, 0, 0, canvas.width, canvas.height);
  }, [active, draft, imageWidth, imageHeight, width]);

  const update = (index: number, point: Point, commit: boolean) => {
    const next = latest.current.map((p, i) => (i === index ? point : p)) as Quad;
    latest.current = next;
    setDraft(next);
    if (commit) onChange(next);
  };

  const release = () => {
    if (!drag.current) return;
    drag.current = null;
    setActive(null);
    onChange(latest.current);
  };

  const valid = isValidQuad(draft);
  const px = (p: Point) => `${PAD + p.x * width},${PAD + p.y * height}`;
  const outline = draft.map(px).join(' ');

  return (
    <div ref={wrap} className="flex w-full flex-col items-center">
      <div
        ref={stage}
        className="relative shrink-0 touch-none select-none"
        style={{ width: width + 2 * PAD, height: height + 2 * PAD }}
      >
        <canvas ref={photo} aria-hidden="true" className="absolute rounded-sm bg-surface-2" style={{ left: PAD, top: PAD, width, height }} />
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          {/* Ce qui restera hors de la page est assombri. */}
          <path d={`M${PAD},${PAD}h${width}v${height}h${-width}z M${outline}z`} fillRule="evenodd" className="fill-overlay" />
          <polygon points={outline} fill="none" strokeWidth={5} strokeLinejoin="round" className="stroke-surface" />
          <polygon
            points={outline}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeDasharray={valid ? undefined : '7 6'}
            className={valid ? 'stroke-accent' : 'stroke-danger'}
          />
        </svg>
        {draft.map((point, index) => (
          <button
            key={index}
            type="button"
            aria-label={t(`scanner.corner${index}`)}
            data-corner={index}
            className="absolute grid cursor-grab touch-none place-items-center rounded-full active:cursor-grabbing"
            style={{ width: HIT, height: HIT, left: point.x * width, top: point.y * height }}
            onPointerDown={(e) => {
              const box = stage.current!.getBoundingClientRect();
              e.currentTarget.setPointerCapture(e.pointerId);
              // Le coin garde son écart avec le doigt : il ne saute pas sous le pointeur.
              drag.current = {
                index,
                dx: e.clientX - box.left - PAD - point.x * width,
                dy: e.clientY - box.top - PAD - point.y * height,
              };
              setActive(index);
            }}
            onPointerMove={(e) => {
              const grip = drag.current;
              if (grip?.index !== index) return;
              const box = stage.current!.getBoundingClientRect();
              update(index, { x: clamp01((e.clientX - box.left - PAD - grip.dx) / width), y: clamp01((e.clientY - box.top - PAD - grip.dy) / height) }, false);
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 1; // en pixels affichés
              const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              const delta = move[e.key];
              if (!delta) return;
              e.preventDefault();
              setActive(index);
              update(index, { x: clamp01(point.x + delta[0] / width), y: clamp01(point.y + delta[1] / height) }, true);
            }}
            onBlur={() => !drag.current && setActive(null)}
          >
            <span
              className={cn(
                'size-6 rounded-full border-[3px] bg-surface/30 shadow-lift ring-2 ring-surface transition-transform duration-150',
                valid ? 'border-accent' : 'border-danger',
                active === index && 'scale-125',
              )}
            />
          </button>
        ))}
        {active !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute overflow-hidden rounded-full border-2 border-surface shadow-lift ring-1 ring-line-strong"
            // La loupe se place du côté opposé au coin déplacé, pour ne jamais être sous le doigt.
            style={{ width: LOUPE, height: LOUPE, top: PAD + 6, [draft[active].x < 0.5 ? 'right' : 'left']: PAD + 6 }}
          >
            <canvas ref={loupe} className="size-full" />
            <span className="absolute top-1/2 left-0 h-px w-full bg-accent" />
            <span className="absolute top-0 left-1/2 h-full w-px bg-accent" />
            <span className="absolute top-1/2 left-1/2 size-3 -translate-1/2 rounded-full border-2 border-accent ring-1 ring-surface" />
          </div>
        )}
      </div>
    </div>
  );
}
