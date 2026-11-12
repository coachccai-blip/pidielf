// Éditer : ajoute du contenu par-dessus les pages — texte, images, formes,
// flèches, dessin libre, surlignage et caches blancs.
import { type ReactNode } from 'react';
import { Circle, Eraser, Highlighter, ImagePlus, Info, Minus, MousePointer2, MoveUpRight, Pencil, Square, TextCursorInput, Type } from 'lucide-react';
import { classifyError } from '@/core/errors';
import { suggestName } from '@/core/naming';
import { useT } from '@/i18n';
import { useToolSettings } from '@/lib/settings';
import { IconButton } from '@/ui/Button';
import { toastError } from '@/ui/toast';
import { pdfOp } from '@/workers/client';
import { pickFiles } from '@/features/library/import';
import { EditorLayout } from '../editor/EditorLayout';
import { readImageFile } from '../editor/images';
import { baseDefaults, toPageOverlays } from '../editor/model';
import { imageElement } from '../editor/shapes';
import { useEditor, type DrawShape, type Editor } from '../editor/useEditor';
import { inputBytes, pdfBlob } from '../inputs';
import type { InputFile, ToolProps } from '../types';
import { usePdf } from '../usePdf';

const overlays = pdfOp<typeof import('@/core/pdf/overlays')>('overlays');

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif';

type PaletteId = 'select' | 'text' | 'image' | DrawShape;

const palette: Array<{ id: PaletteId; icon: ReactNode }> = [
  { id: 'select', icon: <MousePointer2 /> },
  { id: 'text', icon: <Type /> },
  { id: 'image', icon: <ImagePlus /> },
  { id: 'rect', icon: <Square /> },
  { id: 'ellipse', icon: <Circle /> },
  { id: 'line', icon: <Minus /> },
  { id: 'arrow', icon: <MoveUpRight /> },
  { id: 'ink', icon: <Pencil /> },
  { id: 'highlight', icon: <Highlighter /> },
  { id: 'whiteout', icon: <Eraser /> },
  { id: 'cover', icon: <TextCursorInput /> },
];

/** Outil actif de la palette, déduit de l'état de l'éditeur. */
function activeTool(editor: Editor): PaletteId {
  const mode = editor.mode;
  if (mode.kind === 'draw') return mode.shape;
  if (mode.kind === 'place') return 'image';
  return mode.kind;
}

export default function Editer({ inputs, run }: ToolProps) {
  // Un autre fichier : on repart d'une page blanche.
  return <Session key={inputs[0].key} input={inputs[0]} run={run} />;
}

function Session({ input, run }: { input: InputFile; run: ToolProps['run'] }) {
  const t = useT();
  const pdf = usePdf(input.blob);
  const editor = useEditor();
  const [defaults, setDefaults] = useToolSettings('editer', baseDefaults);
  const active = activeTool(editor);

  const pickImage = async () => {
    const [file] = await pickFiles({ accept: IMAGE_TYPES, multiple: false });
    if (!file) return;
    try {
      const image = await readImageFile(file);
      editor.setMode({ kind: 'place', make: (at, page) => imageElement(image, at, page, 0.4) });
    } catch (err) {
      toastError(t(classifyError(err) === 'unsupported' ? 'editer.imageUnsupported' : 'errors.generic'));
    }
  };

  const choose = (id: PaletteId) => {
    if (id === 'image') void pickImage();
    else if (id === 'select' || id === 'text') editor.setMode({ kind: id });
    else editor.setMode({ kind: 'draw', shape: id });
  };

  const start = () =>
    run(async (ctx) => {
      const bytes = await overlays('applyOverlays', { bytes: await inputBytes(input), pages: toPageOverlays(editor.pages) }, ctx);
      return [{ name: suggestName(input.name, t('editer.suffix')), blob: pdfBlob(bytes), pageCount: input.pageCount }];
    });

  return (
    <EditorLayout
      editor={editor}
      pdf={pdf}
      pageCount={input.pageCount}
      defaults={defaults}
      onDefaults={setDefaults}
      toolbar={
        <div className="flex flex-col gap-2">
          <div role="toolbar" aria-label={t('editer.tools')} className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1 shadow-soft">
            {palette.map((tool) => (
              <IconButton key={tool.id} label={t(`editer.tool.${tool.id}`)} active={active === tool.id} onClick={() => choose(tool.id)}>
                {tool.icon}
              </IconButton>
            ))}
          </div>
          <p className="min-h-10 text-sm text-ink-soft" aria-live="polite">
            <span className="font-bold text-ink">{t(`editer.tool.${active}`)}</span> — {t(`editer.hint.${active}`)}
          </p>
        </div>
      }
      side={
        <div className="flex gap-3 rounded-xl border border-line bg-surface p-4 text-sm shadow-soft">
          <Info className="mt-0.5 size-5 shrink-0 text-ink-soft" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="font-bold">{t('editer.limitTitle')}</p>
            <p className="text-ink-soft">{t('editer.limitText')}</p>
            <p className="text-ink-soft">{t('editer.limitCover')}</p>
          </div>
        </div>
      }
      actionLabel={t('editer.action')}
      actionHint={editor.total === 0 ? t('editer.empty') : t('editer.summary', { count: editor.total })}
      actionDisabled={editor.total === 0}
      onAction={start}
    />
  );
}
