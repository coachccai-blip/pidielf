// Surlignage et annotations : barre de sélection, fiche d'une annotation,
// export (PDF avec annotations intégrées, PDF d'origine, notes en texte ou Markdown).
import { useEffect, useRef, useState } from 'react';
import { Copy, Download, FileText, Highlighter, Share2, StickyNote, Trash2, Underline } from 'lucide-react';
import { db, newId, type AnnotationRecord, type FileRecord, type HighlightColor, type NRect } from '@/db';
import { suggestName, withExt } from '@/core/naming';
import type { Overlay, PageOverlays } from '@/core/pdf/overlayTypes';
import { useT } from '@/i18n';
import { getSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Spinner } from '@/ui/Fields';
import { Dialog } from '@/ui/Overlay';
import { toastError, toastSuccess } from '@/ui/toast';
import { pdfOp } from '@/workers/client';
import { canShareFiles, downloadBlob, shareFiles } from '@/features/export/actions';
import { savePdfToLibrary } from '@/features/library/import';
import type { AnnotationHistory } from './history';
import { colorOf, isVertical, pastelOf } from './PageView';
import type { PageSize } from './useDocument';

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];

const swatch: Record<HighlightColor, string> = {
  yellow: '#ffdd57',
  green: '#8cde96',
  blue: '#8cc6ff',
  pink: '#ffa0c8',
};

// ---- Sélection → rectangles normalisés --------------------------------------

/** Réunit les rectangles d'une même ligne. */
function mergeLineRects(rects: NRect[]): NRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: NRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.6 && r.x <= last.x + last.w + r.h * 0.6) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      last.h = Math.max(last.y + last.h, r.y + r.h) - top;
      last.y = top;
      last.w = right - last.x;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export interface SelectionInfo {
  quote: string;
  /** Rectangles par page. */
  pages: Map<number, NRect[]>;
  bounds: DOMRect;
}

export function readSelection(): SelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = range.startContainer.parentElement?.closest('.textLayer');
  const end = range.endContainer.parentElement?.closest('.textLayer');
  if (!start && !end) return null;
  const quote = selection.toString().replace(/\s+/g, ' ').trim();
  if (!quote) return null;
  const sheets = [...document.querySelectorAll<HTMLElement>('[data-page] > .pdf-sheet')].map((el) => ({
    page: Number(el.parentElement!.dataset.page),
    box: el.getBoundingClientRect(),
  }));
  const pages = new Map<number, NRect[]>();
  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const sheet = sheets.find((s) => cx >= s.box.left && cx <= s.box.right && cy >= s.box.top && cy <= s.box.bottom);
    if (!sheet) continue;
    // Les conteneurs (page entière) renvoient aussi un rectangle : on les écarte.
    if (rect.width > sheet.box.width * 0.98 && rect.height > sheet.box.height * 0.5) continue;
    const list = pages.get(sheet.page) ?? [];
    list.push({
      x: (rect.left - sheet.box.left) / sheet.box.width,
      y: (rect.top - sheet.box.top) / sheet.box.height,
      w: rect.width / sheet.box.width,
      h: rect.height / sheet.box.height,
    });
    pages.set(sheet.page, list);
  }
  if (pages.size === 0) return null;
  for (const [page, rects] of pages) pages.set(page, mergeLineRects(rects));
  return { quote, pages, bounds: range.getBoundingClientRect() };
}

export async function addFromSelection(history: AnnotationHistory, fileId: string, info: SelectionInfo, kind: 'highlight' | 'underline', color: string): Promise<string> {
  const records: AnnotationRecord[] = [...info.pages].map(([page, rects]) => ({ id: newId(), fileId, page, createdAt: Date.now(), kind, color, rects, quote: info.quote }));
  // Une sélection à cheval sur plusieurs pages s'annule d'un seul geste.
  await history.apply(records.map((after) => ({ after })));
  return records[0].id;
}

// ---- Barre de sélection -----------------------------------------------------

/** Petite barre qui apparaît quand du texte est sélectionné. */
export function SelectionToolbar({ fileId, history, onNote }: { fileId: string; history: AnnotationHistory; onNote: (id: string) => void }) {
  const t = useT();
  const [info, setInfo] = useState<SelectionInfo | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setInfo(readSelection()), 180);
    };
    document.addEventListener('selectionchange', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', update);
    };
  }, []);

  if (!info) return null;
  const clear = () => {
    window.getSelection()?.removeAllRanges();
    setInfo(null);
  };
  const act = async (kind: 'highlight' | 'underline', color: string, note = false) => {
    const id = await addFromSelection(history, fileId, info, kind, color);
    clear();
    if (note) onNote(id);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.quote);
      toastSuccess(t('reader.annotations.copied'));
    } catch {
      toastError(t('errors.generic'));
    }
    clear();
  };

  // Sous la sélection (le menu natif des téléphones s'affiche au-dessus), sinon au-dessus.
  const width = 304;
  const below = info.bounds.bottom + 64 < window.innerHeight;
  const top = below ? info.bounds.bottom + 10 : Math.max(8, info.bounds.top - 58);
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, info.bounds.left + info.bounds.width / 2 - width / 2));

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={t('reader.annotations.selectionBar')}
      // Garde la sélection quand on appuie sur un bouton de la barre.
      onPointerDown={(e) => e.preventDefault()}
      style={{ top, left, width }}
      className="fixed z-40 flex animate-rise items-center justify-between rounded-xl border border-line bg-surface p-1 text-ink shadow-lift"
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t('reader.annotations.highlightIn', { color: t(`reader.annotations.colors.${c}`) })}
          title={t('reader.annotations.highlightIn', { color: t(`reader.annotations.colors.${c}`) })}
          onClick={() => void act('highlight', c)}
          className="grid size-11 place-items-center rounded-md hover:bg-surface-2"
        >
          <span className="grid size-7 place-items-center rounded-full border border-black/20" style={{ background: swatch[c] }}>
            <Highlighter className="size-3.5 text-black/70" aria-hidden="true" />
          </span>
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px bg-line" aria-hidden="true" />
      <BarButton label={t('reader.annotations.underline')} onClick={() => void act('underline', 'blue')}><Underline /></BarButton>
      <BarButton label={t('reader.annotations.addNote')} onClick={() => void act('highlight', 'yellow', true)}><StickyNote /></BarButton>
      <BarButton label={t('reader.annotations.copy')} onClick={() => void copy()}><Copy /></BarButton>
    </div>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-11 place-items-center rounded-md hover:bg-surface-2 [&>svg]:size-5">
      {children}
    </button>
  );
}

// ---- Fiche d'une annotation -------------------------------------------------

export function AnnotationDialog({ annotation, history, onClose }: { annotation: AnnotationRecord | null; history: AnnotationHistory; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  useEffect(() => setText(annotation?.text ?? ''), [annotation?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!annotation) return null;
  const fresh = annotation.kind === 'note' && !annotation.text;

  const save = async () => {
    const value = text.trim();
    if (fresh) {
      // Note tout juste posée : elle n'entre dans l'historique qu'une fois écrite.
      await db.annotations.delete(annotation.id);
      if (value) await history.add({ ...annotation, text: value });
    } else if (annotation.kind === 'note' && !value) await history.remove(annotation.id);
    else await history.update(annotation.id, { text: value || undefined });
    onClose();
  };
  const remove = async () => {
    if (fresh) await db.annotations.delete(annotation.id);
    else await history.remove(annotation.id);
    onClose();
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={() => void save()}
      title={t(`reader.annotations.kinds.${annotation.kind}`)}
      footer={
        <>
          <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>{t('common.delete')}</Button>
          <Button variant="primary" onClick={() => void save()}>{t('common.done')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <p className="text-sm text-ink-soft">{t('tools.pageN', { n: annotation.page })}</p>
        {annotation.quote && (
          <blockquote className="max-h-32 overflow-y-auto rounded-md border-l-4 border-line-strong bg-surface-2 px-3 py-2 text-sm italic">
            {annotation.quote}
          </blockquote>
        )}
        {(annotation.kind === 'highlight' || annotation.kind === 'marker') && (
          <div role="radiogroup" aria-label={t('reader.annotations.color')} className="flex gap-1">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={annotation.color === c}
                aria-label={t(`reader.annotations.colors.${c}`)}
                onClick={() => void history.update(annotation.id, { color: c })}
                className={cn('grid size-11 place-items-center rounded-md', annotation.color === c && 'bg-surface-2 ring-2 ring-accent')}
              >
                <span className="size-7 rounded-full border border-black/20" style={{ background: swatch[c] }} />
              </button>
            ))}
          </div>
        )}
        {annotation.kind !== 'ink' && annotation.kind !== 'marker' && (
          <label className="flex flex-col gap-1.5 text-sm font-bold">
            {t('reader.annotations.noteLabel')}
            <textarea
              data-autofocus={annotation.kind === 'note' || undefined}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-line-strong bg-surface p-3 text-base font-normal"
            />
          </label>
        )}
      </div>
    </Dialog>
  );
}

// ---- Export -----------------------------------------------------------------

const exportColor: Record<string, string> = { yellow: '#ffdd57', green: '#8cde96', blue: '#8cc6ff', pink: '#ffa0c8' };

/** Convertit les annotations du lecteur en éléments à intégrer au PDF. */
export function annotationsToOverlays(annotations: AnnotationRecord[], sizes: PageSize[] = []): PageOverlays[] {
  const byPage = new Map<number, Overlay[]>();
  for (const a of annotations) {
    const list = byPage.get(a.page) ?? [];
    if (a.kind === 'highlight' && a.rects) list.push({ type: 'highlight', rects: a.rects, color: exportColor[a.color] ?? a.color });
    if (a.kind === 'underline' && a.rects) {
      const size = sizes[a.page - 1];
      const vertical = size ? a.rects.filter((r) => isVertical(r, size)) : [];
      const horizontal = a.rects.filter((r) => !vertical.includes(r));
      if (horizontal.length) list.push({ type: 'underline', rects: horizontal, color: colorOf(a.color) });
      // Texte vertical : le trait longe le côté gauche, comme à l'écran.
      for (const r of vertical) list.push({ type: 'line', x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h, stroke: colorOf(a.color), strokeWidth: 1.2 });
    }
    if (a.kind === 'ink' && a.strokes) list.push({ type: 'ink', strokes: a.strokes, color: colorOf(a.color), width: a.width ?? 2 });
    if (a.kind === 'marker' && a.strokes) list.push({ type: 'ink', strokes: a.strokes, color: pastelOf(a.color), width: a.width ?? 14, opacity: 0.5 });
    if (a.text) {
      const at = a.kind === 'note' ? { x: a.x ?? 0, y: a.y ?? 0 } : a.rects?.[0] ? { x: a.rects[0].x + a.rects[0].w, y: a.rects[0].y } : null;
      if (at) list.push({ type: 'note', x: at.x, y: at.y, text: a.text });
    }
    if (list.length) byPage.set(a.page, list);
  }
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([page, overlays]) => ({ page, overlays }));
}

/** Notes et surlignages en texte brut ou en Markdown. */
export function notesAsText(annotations: AnnotationRecord[], title: string, format: 'txt' | 'md', pageLabel: (n: number) => string): string {
  const sorted = [...annotations].filter((a) => a.quote || a.text).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
  const lines: string[] = [format === 'md' ? `# ${title}` : title, ''];
  let page = 0;
  for (const a of sorted) {
    if (a.page !== page) {
      page = a.page;
      lines.push(format === 'md' ? `## ${pageLabel(page)}` : `— ${pageLabel(page)} —`, '');
    }
    if (a.quote) lines.push(format === 'md' ? `> ${a.quote}` : `« ${a.quote} »`);
    if (a.text) lines.push(...(a.quote && format === 'md' ? [''] : []), a.text);
    lines.push('');
  }
  return lines.join('\n');
}

const overlays = pdfOp<typeof import('@/core/pdf/overlays')>('overlays');

export function ExportDialog({
  open,
  onClose,
  file,
  blob,
  annotations,
  sizes,
}: {
  open: boolean;
  onClose: () => void;
  file: FileRecord;
  blob: Blob;
  annotations: AnnotationRecord[];
  sizes: PageSize[];
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const has = annotations.length > 0;
  const hasNotes = annotations.some((a) => a.quote || a.text);

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      console.error(err);
      toastError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const annotated = async (): Promise<{ name: string; blob: Blob }> => {
    const bytes = await overlays('applyOverlays', { bytes: new Uint8Array(await blob.arrayBuffer()), pages: annotationsToOverlays(annotations, sizes) });
    return { name: suggestName(file.name, t('reader.export.suffix')), blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }) };
  };

  const downloadAnnotated = () =>
    guard(async () => {
      const out = await annotated();
      await downloadBlob(out.name, out.blob);
      if (getSettings().saveToLibrary) {
        await savePdfToLibrary(out.name, out.blob, { origin: 'tool', tool: 'annotations', parentId: file.id });
        toastSuccess(t('export.savedToLibrary'));
      }
      onClose();
    });
  const shareAnnotated = () => guard(async () => void (await shareFiles([has ? await annotated() : { name: file.name, blob }])));
  const notes = (format: 'txt' | 'md') =>
    guard(async () => {
      const text = notesAsText(annotations, file.name.replace(/\.pdf$/i, ''), format, (n) => t('tools.pageN', { n }));
      await downloadBlob(withExt(suggestName(file.name, t('reader.export.notesSuffix')), format), new Blob([text], { type: 'text/plain;charset=utf-8' }));
    });

  return (
    <Dialog open={open} onClose={onClose} title={t('reader.export.title')}>
      <div className="flex flex-col gap-2.5 pb-3">
        {!file.encrypted && (
          <Choice
            icon={busy ? <Spinner /> : <Highlighter />}
            title={t('reader.export.withAnnotations')}
            text={has ? t('reader.export.withAnnotationsText') : t('reader.export.none')}
            disabled={busy || !has}
            onClick={downloadAnnotated}
          />
        )}
        <Choice icon={<Download />} title={t('reader.export.original')} text={t('reader.export.originalText')} disabled={busy} onClick={() => guard(async () => void (await downloadBlob(file.name, blob)))} />
        <Choice icon={<FileText />} title={t('reader.export.notesTxt')} text={t('reader.export.notesText')} disabled={busy || !hasNotes} onClick={() => notes('txt')} />
        <Choice icon={<FileText />} title={t('reader.export.notesMd')} text={t('reader.export.notesText')} disabled={busy || !hasNotes} onClick={() => notes('md')} />
        {canShareFiles() && !file.encrypted && (
          <Choice icon={<Share2 />} title={t('export.share')} text={has ? t('reader.export.shareText') : t('reader.export.originalText')} disabled={busy} onClick={shareAnnotated} />
        )}
      </div>
    </Dialog>
  );
}

function Choice({ icon, title, text, disabled, onClick }: { icon: React.ReactNode; title: string; text: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left hover:bg-surface-2 disabled:opacity-50"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent [&>svg]:size-5" aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="block font-bold">{title}</span>
        <span className="block text-sm text-ink-soft">{text}</span>
      </span>
    </button>
  );
}
