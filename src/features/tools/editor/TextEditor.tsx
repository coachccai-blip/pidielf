// Saisie directe d'un texte sur la page : une zone de texte posée à l'endroit
// exact du texte, à sa taille réelle, qui grandit avec lui.
import { useLayoutEffect, useRef, useState } from 'react';
import type { OverlayFont } from '@/core/pdf/overlayTypes';
import { useT } from '@/i18n';
import { LINE_HEIGHT } from './model';
import { FONT_STACKS } from './textLayout';

export interface TextStyle {
  font: OverlayFont;
  /** Corps, en points. */
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
}

export function TextEditor({
  left,
  top,
  width,
  scale,
  style,
  initial,
  onDone,
}: {
  /** Position et largeur dans la surface, en pixels. */
  left: number;
  top: number;
  width: number;
  /** Pixels par point PDF. */
  scale: number;
  style: TextStyle;
  initial: string;
  /** `byKey` : la saisie a été terminée au clavier (Échap, Ctrl + Entrée), le focus doit revenir dans la page. */
  onDone: (text: string, byKey: boolean) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const byKey = useRef(false);

  // En dessous de 16 px, iOS zoome sur le champ : on écrit plus gros, puis on réduit l'ensemble.
  const fontPx = style.size * scale;
  const shrink = Math.min(1, fontPx / 16);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, fontPx, width]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(value.replace(/\s+$/, ''), byKey.current);
  };

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      aria-label={t('editor.textField')}
      placeholder={t('editor.textPlaceholder')}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        // Échap ou Ctrl + Entrée terminent la saisie ; Entrée seule va à la ligne.
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.stopPropagation();
          byKey.current = true;
          e.currentTarget.blur();
        }
      }}
      className="absolute m-0 block resize-none overflow-hidden border-0 bg-transparent p-0 placeholder:opacity-50"
      style={{
        left,
        top,
        width: Math.max(24, width) / shrink,
        transform: shrink < 1 ? `scale(${shrink})` : undefined,
        transformOrigin: '0 0',
        fontFamily: FONT_STACKS[style.font],
        fontSize: fontPx / shrink,
        lineHeight: style.lineHeight ?? LINE_HEIGHT,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        textAlign: style.align ?? 'left',
        color: style.color,
        caretColor: style.color,
        // Repère de saisie posé sur la page blanche : couleurs fixes, lisibles en clair comme en sombre.
        outline: '1.5px dashed #1a73e8',
        outlineOffset: 3,
        borderRadius: 0,
        touchAction: 'manipulation',
      }}
    />
  );
}
