// Aperçu d'un élément au-dessus de la page, en SVG. Les couleurs codées en dur
// ici sont celles du contenu qui sera écrit dans le PDF (ou des repères posés
// sur la page blanche), pas celles de l'interface.
import { useEffect } from 'react';
import { arrowHead, svgPath } from '@/core/signature/path';
import { useT } from '@/i18n';
import { imageUrl } from './images';
import { LINE_HEIGHT, type EditorElement, type ElementOf, type PageSize } from './model';
import { FONT_STACKS, useTextLayout } from './textLayout';
import type { Editor } from './useEditor';

/** Largeur de la zone sensible autour d'un trait fin, en pixels. */
const HIT = 24;

interface ViewProps {
  el: EditorElement;
  /** Taille de la page à l'écran, en pixels. */
  width: number;
  height: number;
  /** Pixels par point PDF. */
  scale: number;
  pageSize: PageSize;
  editor: Editor;
  /** Faux pour une forme en cours de tracé : elle ne réagit pas au pointeur. */
  interactive?: boolean;
}

/** Nom d'un élément pour les lecteurs d'écran. */
export function elementName(el: EditorElement, t: ReturnType<typeof useT>): string {
  if (el.label) return el.label;
  if (el.type === 'text') return t('editor.el.text', { text: el.text.replace(/\s+/g, ' ').slice(0, 60) });
  return t(`editor.el.${el.type}`);
}

export function ElementView({ el, width, height, scale, pageSize, editor, interactive = true }: ViewProps) {
  const t = useT();
  const selected = editor.selectedId === el.id;
  const group = interactive
    ? {
        'data-el': el.id,
        tabIndex: 0,
        role: 'button',
        'aria-label': elementName(el, t),
        'aria-pressed': selected,
        onFocus: () => editor.select(el.id),
        // Le cadre de sélection sert d'indicateur de focus.
        style: { touchAction: 'none', outline: 'none', cursor: editor.mode.kind === 'select' ? 'move' : undefined } as const,
      }
    : { style: { pointerEvents: 'none' } as const };
  return <g {...group}>{renderShape(el, width, height, scale, pageSize, editor)}</g>;
}

function renderShape(el: EditorElement, W: number, H: number, scale: number, pageSize: PageSize, editor: Editor) {
  switch (el.type) {
    case 'text':
      return <TextShape el={el} width={W} height={H} scale={scale} pageSize={pageSize} editor={editor} />;
    case 'image':
      return (
        <image
          href={imageUrl(el.data, el.mime)}
          x={el.x * W}
          y={el.y * H}
          width={el.w * W}
          height={el.h * H}
          preserveAspectRatio="none"
          opacity={el.opacity ?? 1}
          pointerEvents="all"
        />
      );
    case 'rect':
    case 'ellipse': {
      const strokeWidth = el.stroke ? el.strokeWidth * scale : 0;
      const common = {
        fill: el.fill || 'none',
        stroke: el.stroke || 'none',
        strokeWidth,
        opacity: el.opacity ?? 1,
        pointerEvents: el.fill ? 'all' : 'stroke',
      } as const;
      const hit = { fill: 'none', stroke: 'transparent', strokeWidth: Math.max(HIT, strokeWidth), pointerEvents: 'stroke' } as const;
      if (el.type === 'rect') {
        const box = { x: el.x * W, y: el.y * H, width: el.w * W, height: el.h * H };
        return (
          <>
            <rect {...box} {...common} />
            <rect {...box} {...hit} />
          </>
        );
      }
      const oval = { cx: (el.x + el.w / 2) * W, cy: (el.y + el.h / 2) * H, rx: (el.w / 2) * W, ry: (el.h / 2) * H };
      return (
        <>
          <ellipse {...oval} {...common} />
          <ellipse {...oval} {...hit} />
        </>
      );
    }
    case 'line':
    case 'arrow': {
      const [x1, y1, x2, y2] = [el.x1 * W, el.y1 * H, el.x2 * W, el.y2 * H];
      const strokeWidth = el.strokeWidth * scale;
      const head = el.type === 'arrow' ? arrowHead(x1, y1, x2, y2, strokeWidth) : null;
      return (
        <>
          <g opacity={el.opacity ?? 1}>
            <line
              x1={x1}
              y1={y1}
              x2={head ? head.base[0] : x2}
              y2={head ? head.base[1] : y2}
              stroke={el.stroke}
              strokeWidth={strokeWidth}
              strokeLinecap={head ? 'butt' : 'round'}
            />
            {head && <polygon points={[head.tip, head.left, head.right].map((p) => p.join(',')).join(' ')} fill={el.stroke} />}
          </g>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(HIT, strokeWidth)} strokeLinecap="round" pointerEvents="stroke" />
        </>
      );
    }
    case 'ink': {
      const d = el.strokes.map((stroke) => svgPath(stroke.map(([x, y]) => [x * W, y * H]))).join('');
      const width = el.width * scale;
      const line = { d, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
      return (
        <>
          <path {...line} stroke={el.color} strokeWidth={width} opacity={el.opacity ?? 1} />
          <path {...line} stroke="transparent" strokeWidth={Math.max(HIT, width)} pointerEvents="stroke" />
        </>
      );
    }
    case 'highlight':
      return el.rects.map((r, i) => (
        <rect
          key={i}
          x={r.x * W}
          y={r.y * H}
          width={r.w * W}
          height={r.h * H}
          fill={el.color}
          fillOpacity={el.opacity ?? 0.4}
          style={{ mixBlendMode: 'multiply' }}
          pointerEvents="all"
        />
      ));
    case 'whiteout':
      // Le pointillé gris ne sert qu'à repérer le cache dans l'éditeur : il n'est pas écrit dans le PDF.
      return (
        <rect
          x={el.x * W}
          y={el.y * H}
          width={el.w * W}
          height={el.h * H}
          fill={el.color ?? '#ffffff'}
          stroke="#9aa3ad"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="all"
        />
      );
  }
}

function TextShape({ el, width: W, height: H, scale, pageSize, editor }: Omit<ViewProps, 'el' | 'interactive'> & { el: ElementOf<'text'> }) {
  const maxWidth = (el.autoWidth ? 1 - el.x : el.w) * pageSize.width;
  const { layout, fresh } = useTextLayout({
    text: el.text,
    font: el.font,
    size: el.size,
    bold: el.bold,
    italic: el.italic,
    lineHeight: el.lineHeight ?? LINE_HEIGHT,
    maxWidth,
  });

  // La boîte suit le texte : hauteur toujours, largeur tant qu'elle n'a pas été réglée à la main.
  useEffect(() => {
    if (!layout || !fresh) return;
    const w = el.autoWidth ? Math.min(1 - el.x, (layout.width + 0.5) / pageSize.width) : el.w;
    const h = layout.height / pageSize.height;
    if (Math.abs(w - el.w) > 1e-5 || Math.abs(h - el.h) > 1e-5) editor.patch(el.id, { w, h }, { record: 'none' });
  });

  if (editor.editingId === el.id) return null;
  const fontSize = el.size * scale;
  const pitch = fontSize * (el.lineHeight ?? LINE_HEIGHT);
  const lines = layout?.lines ?? el.text.split('\n').map((text) => ({ text, width: 0 }));
  const baseline = layout ? (layout.baseline / layout.lineHeight) * pitch : pitch * 0.8;
  const boxWidth = el.w * W;
  return (
    <>
      <rect x={el.x * W} y={el.y * H} width={Math.max(boxWidth, 16)} height={Math.max(el.h * H, pitch)} fill="transparent" pointerEvents="all" />
      {lines.map((line, i) => {
        const lineWidth = line.width * scale;
        const slack = lineWidth > 0 ? boxWidth - lineWidth : 0;
        return (
          <text
            key={i}
            x={el.x * W + (el.align === 'center' ? slack / 2 : el.align === 'right' ? slack : 0)}
            y={el.y * H + baseline + i * pitch}
            fontFamily={FONT_STACKS[el.font]}
            fontSize={fontSize}
            fontWeight={el.bold ? 700 : 400}
            fontStyle={el.italic ? 'italic' : 'normal'}
            fill={el.color}
            // La ligne occupe exactement la largeur qu'elle aura dans le PDF, même si la police d'écran diffère un peu.
            textLength={lineWidth > 0 ? lineWidth : undefined}
            lengthAdjust="spacingAndGlyphs"
            style={{ whiteSpace: 'pre', userSelect: 'none' }}
          >
            {line.text}
          </text>
        );
      })}
    </>
  );
}
