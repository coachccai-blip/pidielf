// Signer : pose une signature visuelle (dessinée, tapée ou importée), des
// initiales, la date ou un texte. Les signatures restent sur l'appareil et se
// reposent en un appui.
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, ImageUp, Info, Keyboard, PenLine, Signature, Trash2, Type } from 'lucide-react';
import { suggestName } from '@/core/naming';
import { db, newId, type SignatureRecord } from '@/db';
import { currentLang, useT } from '@/i18n';
import { useToolSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { confirm } from '@/ui/dialogs';
import { Menu } from '@/ui/Overlay';
import { toastError } from '@/ui/toast';
import { pdfOp } from '@/workers/client';
import { pickFiles } from '@/features/library/import';
import { EditorLayout } from '../editor/EditorLayout';
import { baseDefaults, boundsOf, toPageOverlays, type EditorDefaults, type Point } from '../editor/model';
import { imageElement, textElement } from '../editor/shapes';
import { useEditor, type Editor } from '../editor/useEditor';
import { inputBytes, pdfBlob } from '../inputs';
import type { InputFile, ToolProps } from '../types';
import { usePdf } from '../usePdf';
import { ImportDialog, TypedDialog } from './dialogs';
import { INKS, decodeImage, type SignatureImage } from './raster';
import { SignaturePad } from './SignaturePad';

const overlays = pdfOp<typeof import('@/core/pdf/overlays')>('overlays');

type Kind = SignatureRecord['kind'];
type Creating = { kind: Kind; method: 'draw' | 'type' } | { kind: Kind; method: 'import'; source: HTMLCanvasElement };

interface SignerSettings {
  ink: string;
  remember: boolean;
  /** Réglages du texte et de la date (police, taille, couleur). */
  text: Partial<EditorDefaults>;
}

/** Cherche, à partir de `at`, un endroit libre : un élément posé sur un autre le cacherait. */
function freeSpot(editor: Editor, at: Point): Point {
  const spot = { ...at };
  for (let i = 0; i < 12; i++) {
    const taken = editor.elements.some((el) => {
      const b = boundsOf(el);
      return spot.x > b.x - 0.06 && spot.x < b.x + b.w + 0.06 && spot.y > b.y - 0.03 && spot.y < b.y + b.h + 0.03;
    });
    if (!taken) break;
    // On descend d'un cran ; arrivé en bas, on repart du haut, un peu plus à droite.
    spot.y += 0.07;
    if (spot.y > 0.9) {
      spot.y = 0.1;
      spot.x = Math.min(0.85, spot.x + 0.12);
    }
  }
  return spot;
}

function SavedSignature({ record, name, onPlace, onDelete }: { record: SignatureRecord; name: string; onPlace: () => void; onDelete: () => void }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const created = URL.createObjectURL(record.blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [record.blob]);
  return (
    <li className="flex shrink-0 items-center rounded-lg border border-line bg-surface p-1 shadow-soft">
      <button type="button" onClick={onPlace} aria-label={t('signer.place', { name })} title={t('signer.place', { name })} className="flex h-11 items-center gap-2 rounded-md pr-2 pl-1 hover:bg-surface-2">
        {/* Fond blanc fixe : l'encre sombre doit rester lisible en thème sombre. */}
        <span className="grid h-9 w-20 place-items-center rounded-sm bg-white px-1">
          {url && <img src={url} alt="" className="max-h-8 max-w-full object-contain" />}
        </span>
        <span className="text-xs font-bold text-ink-soft">{t(`signer.kindShort.${record.kind}`)}</span>
      </button>
      <button type="button" onClick={onDelete} aria-label={t('signer.deleteSaved', { name })} title={t('signer.deleteSaved', { name })} className="grid size-11 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-danger-soft hover:text-danger">
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

export default function Signer({ inputs, run }: ToolProps) {
  return <Session key={inputs[0].key} input={inputs[0]} run={run} />;
}

function Session({ input, run }: { input: InputFile; run: ToolProps['run'] }) {
  const t = useT();
  const pdf = usePdf(input.blob);
  const editor = useEditor();
  const [settings, setSettings] = useToolSettings<SignerSettings>('signer', { ink: INKS[0].value, remember: true, text: {} });
  const defaults: EditorDefaults = { ...baseDefaults, size: 12, textColor: '#111111', ...settings.text };
  const saved = useLiveQuery(() => db.signatures.orderBy('createdAt').reverse().toArray(), []);
  const [menu, setMenu] = useState<{ kind: Kind; anchor: Point } | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  /** Octets de chaque signature enregistrée : la même image posée dix fois n'est lue qu'une fois. */
  const bytes = useRef(new Map<string, Uint8Array>());

  const place = (data: Uint8Array, image: { width: number; height: number }, kind: Kind) => {
    const view = editor.view.current;
    if (!view) return;
    const at = freeSpot(editor, view.visibleCenter());
    editor.setMode({ kind: 'select' });
    editor.add([imageElement({ data, mime: 'image/png', ...image }, at, view.pageSize, kind === 'initials' ? 0.12 : 0.3, { label: t(`signer.kind.${kind}`) })]);
    view.reveal(at);
  };

  const placeSaved = async (record: SignatureRecord) => {
    let data = bytes.current.get(record.id);
    if (!data) bytes.current.set(record.id, (data = new Uint8Array(await record.blob.arrayBuffer())));
    place(data, record, record.kind);
  };

  const created = async (image: SignatureImage, kind: Kind) => {
    setCreating(null);
    const data = new Uint8Array(await image.blob.arrayBuffer());
    if (settings.remember) {
      const id = newId();
      bytes.current.set(id, data);
      try {
        await db.signatures.add({ id, kind, blob: image.blob, width: image.width, height: image.height, createdAt: Date.now() });
      } catch {
        toastError(t('signer.saveFailed'));
      }
    }
    place(data, image, kind);
  };

  const remove = async (record: SignatureRecord, name: string) => {
    if (!(await confirm({ title: t('signer.deleteTitle'), message: t('signer.deleteText', { name }), confirmLabel: t('common.delete'), danger: true }))) return;
    bytes.current.delete(record.id);
    await db.signatures.delete(record.id);
  };

  const importImage = async (kind: Kind) => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,.png,.jpg,.jpeg', multiple: false });
    if (!file) return;
    try {
      setCreating({ kind, method: 'import', source: await decodeImage(file) });
    } catch {
      toastError(t('signer.import.unreadable'));
    }
  };

  const openMenu = (kind: Kind, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, anchor: { x: r.left, y: r.bottom + 6 } });
  };

  const addDate = () => {
    const view = editor.view.current;
    if (!view) return;
    const today = new Intl.DateTimeFormat(currentLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    const at = freeSpot(editor, view.visibleCenter());
    editor.setMode({ kind: 'select' });
    editor.add([textElement(today, { x: Math.max(0, at.x - 0.07), y: at.y }, defaults, view.pageSize)]);
    view.reveal(at);
  };

  const addText = () => {
    const view = editor.view.current;
    if (!view) return;
    const at = freeSpot(editor, view.visibleCenter());
    editor.setMode({ kind: 'select' });
    editor.select(null);
    editor.setDraft({ at: { x: Math.max(0, at.x - 0.15), y: at.y } });
    view.reveal(at);
  };

  const start = () =>
    run(async (ctx) => {
      const out = await overlays('applyOverlays', { bytes: await inputBytes(input), pages: toPageOverlays(editor.pages) }, ctx);
      return [{ name: suggestName(input.name, t('signer.suffix')), blob: pdfBlob(out), pageCount: input.pageCount }];
    });

  // « Signature 2 », « Initiales 1 » : un nom par signature enregistrée, pour les lecteurs d'écran.
  const names = new Map<string, string>();
  const counts: Record<Kind, number> = { signature: 0, initials: 0 };
  for (const record of [...(saved ?? [])].reverse()) names.set(record.id, `${t(`signer.kind.${record.kind}`)} ${++counts[record.kind]}`);

  const dialogTitle = creating ? t(`signer.new.${creating.kind}`) : '';
  const common = {
    title: dialogTitle,
    remember: settings.remember,
    onRemember: (remember: boolean) => setSettings({ remember }),
    onCancel: () => setCreating(null),
    onDone: (image: SignatureImage) => void created(image, creating!.kind),
  };

  return (
    <>
      <EditorLayout
        editor={editor}
        pdf={pdf}
        pageCount={input.pageCount}
        defaults={defaults}
        onDefaults={(patch) => setSettings({ text: { ...settings.text, ...patch } })}
        fixedRatio
        toolbar={
          <div className="flex flex-col gap-3">
            <p className="flex gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-soft">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('signer.notice')}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button variant="cat" icon={<Signature />} onClick={(e) => openMenu('signature', e)}>{t('signer.add.signature')}</Button>
              <Button icon={<PenLine />} onClick={(e) => openMenu('initials', e)}>{t('signer.add.initials')}</Button>
              <Button icon={<CalendarDays />} onClick={addDate}>{t('signer.add.date')}</Button>
              <Button icon={<Type />} onClick={addText}>{t('signer.add.text')}</Button>
            </div>
            {saved && saved.length > 0 && (
              <section aria-label={t('signer.saved')} className="flex flex-col gap-1.5">
                <p className="text-xs font-bold text-ink-soft">{t('signer.saved')}</p>
                <ul className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
                  {saved.map((record) => {
                    const name = names.get(record.id)!;
                    return <SavedSignature key={record.id} record={record} name={name} onPlace={() => void placeSaved(record)} onDelete={() => void remove(record, name)} />;
                  })}
                </ul>
              </section>
            )}
          </div>
        }
        side={
          <div className="rounded-xl border border-line bg-surface p-4 text-sm shadow-soft">
            <p className="mb-1.5 font-bold">{t('signer.helpTitle')}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-soft">
              <li>{t('signer.help.place')}</li>
              <li>{t('signer.help.resize')}</li>
              <li>{t('signer.help.saved')}</li>
            </ul>
          </div>
        }
        actionLabel={t('signer.action')}
        actionHint={editor.total === 0 ? t('signer.empty') : t('signer.summary', { count: editor.total })}
        actionDisabled={editor.total === 0}
        onAction={start}
      />

      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        title={menu ? t(`signer.new.${menu.kind}`) : ''}
        anchor={menu?.anchor}
        sections={[
          {
            items: [
              { id: 'draw', label: t('signer.method.draw'), icon: <PenLine />, onSelect: () => setCreating({ kind: menu!.kind, method: 'draw' }) },
              { id: 'type', label: t('signer.method.type'), icon: <Keyboard />, onSelect: () => setCreating({ kind: menu!.kind, method: 'type' }) },
              { id: 'import', label: t('signer.method.import'), icon: <ImageUp />, onSelect: () => void importImage(menu!.kind) },
            ],
          },
        ]}
      />
      {creating?.method === 'draw' && <SignaturePad {...common} ink={settings.ink} onInk={(ink) => setSettings({ ink })} />}
      {creating?.method === 'type' && <TypedDialog {...common} ink={settings.ink} onInk={(ink) => setSettings({ ink })} initials={creating.kind === 'initials'} />}
      {creating?.method === 'import' && <ImportDialog {...common} source={creating.source} />}
    </>
  );
}
