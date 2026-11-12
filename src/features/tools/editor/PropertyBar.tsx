// Propriétés de l'élément sélectionné — ou, sans sélection, réglages de l'outil
// en main (couleur du crayon, police du prochain texte…). En barre défilante
// en bas d'écran sur mobile, en panneau dans la colonne latérale sur bureau.
import type { ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, Copy, Files, Italic, Minus, PencilLine, Plus, Trash2 } from 'lucide-react';
import type { OverlayFont } from '@/core/pdf/overlayTypes';
import { formatPercent, useT } from '@/i18n';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { NumberInput, Select } from '@/ui/Fields';
import { elementName } from './ElementView';
import { moved, type EditorDefaults, type EditorElement, type ElementOf, type NewElement, type PageSize } from './model';
import { shapeFromDrag, textElement } from './shapes';
import { useTextLayout } from './textLayout';
import type { Editor } from './useEditor';

export interface NamedColor { value: string; key: string }

const INK_COLORS: NamedColor[] = [
  { value: '#1a1a1a', key: 'black' },
  { value: '#6b7280', key: 'grey' },
  { value: '#d92d20', key: 'red' },
  { value: '#e8710a', key: 'orange' },
  { value: '#188038', key: 'green' },
  { value: '#1d4ed8', key: 'blue' },
  { value: '#ffffff', key: 'white' },
];
const HIGHLIGHT_COLORS: NamedColor[] = [
  { value: '#ffe066', key: 'yellow' },
  { value: '#b5f2a8', key: 'green' },
  { value: '#ffb8d9', key: 'pink' },
  { value: '#a8d8ff', key: 'blue' },
  { value: '#ffd199', key: 'orange' },
];
const WHITEOUT_COLORS: NamedColor[] = [{ value: '#ffffff', key: 'white' }];

/** Vrai si une coche sombre se lit mieux qu'une coche claire sur cette couleur. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}

export function Swatches({
  label,
  value,
  colors,
  onChange,
  none,
  custom,
  wrap,
}: {
  label: string;
  value: string;
  colors: NamedColor[];
  onChange: (color: string) => void;
  /** Propose « aucune » (valeur vide). */
  none?: boolean;
  /** Propose une couleur libre. */
  custom?: boolean;
  /** Passe à la ligne quand la place manque (panneau latéral) au lieu de défiler. */
  wrap?: boolean;
}) {
  const t = useT();
  const current = value.toLowerCase();
  const listed = colors.some((c) => c.value === current) || (none && !current);
  const swatch = 'grid size-7 place-items-center rounded-full border border-line-strong';
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex items-center', wrap && 'flex-wrap')}>
      {none && (
        <button type="button" role="radio" aria-checked={!current} aria-label={t('editor.color.none')} title={t('editor.color.none')} onClick={() => onChange('')} className="grid size-11 shrink-0 place-items-center rounded-full pointer-fine:size-9">
          {/* Barre oblique : « aucune couleur » ne repose pas sur la couleur seule. */}
          <span className={cn(swatch, 'relative overflow-hidden bg-surface', !current && 'ring-2 ring-focus ring-offset-2 ring-offset-surface')}>
            <span className="absolute h-0.5 w-9 rotate-45 bg-danger" />
          </span>
        </button>
      )}
      {colors.map((c) => {
        const checked = c.value === current;
        return (
          <button key={c.value} type="button" role="radio" aria-checked={checked} aria-label={t(`editor.color.${c.key}`)} title={t(`editor.color.${c.key}`)} onClick={() => onChange(c.value)} className="grid size-11 shrink-0 place-items-center rounded-full pointer-fine:size-9">
            <span className={cn(swatch, checked && 'ring-2 ring-focus ring-offset-2 ring-offset-surface')} style={{ background: c.value }}>
              {checked && <Check className="size-4" style={{ color: isLight(c.value) ? '#1a1a1a' : '#ffffff' }} aria-hidden="true" />}
            </span>
          </button>
        );
      })}
      {custom && (
        <label className="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full focus-within:outline-2 focus-within:outline-focus pointer-fine:size-9" title={t('editor.color.custom')}>
          <input type="color" value={/^#[0-9a-f]{6}$/.test(current) ? current : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${label} : ${t('editor.color.custom')}`} className="absolute inset-0 size-full cursor-pointer opacity-0" />
          <span
            className={cn(swatch, !listed && 'ring-2 ring-focus ring-offset-2 ring-offset-surface')}
            style={{ background: listed ? 'conic-gradient(#e33, #ee3, #3c3, #3cc, #33e, #c3c, #e33)' : current }}
          >
            {!listed && <Check className="size-4" style={{ color: isLight(current) ? '#1a1a1a' : '#ffffff' }} aria-hidden="true" />}
          </span>
        </label>
      )}
    </div>
  );
}

function Stepper({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  const t = useT();
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 10) / 10)));
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      <IconButton variant="soft" label={t('editor.decrease', { label })} disabled={value <= min} onClick={() => set(value - step)}>
        <Minus />
      </IconButton>
      <NumberInput aria-label={t('editor.inPoints', { label })} value={value} onChange={set} min={min} max={max} step={step} className="w-16! px-1 text-center tabular-nums" />
      <IconButton variant="soft" label={t('editor.increase', { label })} disabled={value >= max} onClick={() => set(value + step)}>
        <Plus />
      </IconButton>
    </div>
  );
}

/** Bouton à deux états (gras, italique) ou choix exclusif (alignement) : l'état actif se voit au fond et au contour. */
function Toggle({ label, on, radio, onClick, children }: { label: string; on: boolean; radio?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? on : undefined}
      aria-pressed={radio ? undefined : on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-md border transition-colors duration-150 [&>svg]:size-5',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface-2 text-ink hover:bg-line',
      )}
    >
      {children}
    </button>
  );
}

function Section({ label, panel, children }: { label: string; panel: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex shrink-0 flex-col gap-0.5', panel && 'w-full gap-1')}>
      <span className={cn('font-bold whitespace-nowrap', panel ? 'text-sm' : 'text-xs text-ink-soft')}>{label}</span>
      {children}
    </div>
  );
}

/**
 * Prévient quand le texte contient des caractères que les polices intégrées au
 * PDF ne savent pas écrire : la mise en lignes (la même que pour le PDF) les a
 * remplacés par « ? ».
 */
function UnsupportedNotice({ el }: { el: ElementOf<'text'> }) {
  const t = useT();
  const { layout, fresh } = useTextLayout({ text: el.text, font: el.font, size: el.size, bold: el.bold, italic: el.italic });
  const marks = (text: string) => text.split('?').length;
  if (!layout || !fresh || marks(layout.lines.map((l) => l.text).join('')) <= marks(el.text)) return null;
  return <p className="shrink-0 self-center text-xs text-ink-soft lg:text-sm">{t('editor.unsupportedChars')}</p>;
}

/** Réglages par défaut correspondant à une modification d'élément : le prochain élément les reprendra. */
function defaultsFrom(type: EditorElement['type'], changes: Record<string, unknown>): Partial<EditorDefaults> {
  const out: Partial<EditorDefaults> = {};
  const has = (key: string) => changes[key] !== undefined || key in changes;
  if (type === 'text') {
    if (has('color')) out.textColor = changes.color as string;
    if (has('size')) out.size = changes.size as number;
    if (has('font')) out.font = changes.font as OverlayFont;
  } else if (type === 'ink') {
    if (has('color')) out.inkColor = changes.color as string;
    if (has('width')) out.inkWidth = changes.width as number;
  } else if (type === 'highlight') {
    if (has('color')) out.highlight = changes.color as string;
  } else if (type === 'rect' || type === 'ellipse' || type === 'line' || type === 'arrow') {
    if (has('stroke')) out.stroke = changes.stroke as string;
    if (has('strokeWidth')) out.strokeWidth = changes.strokeWidth as number;
    if (has('fill')) out.fill = (changes.fill as string | undefined) ?? '';
  }
  return out;
}

/** Élément fictif portant les réglages de l'outil en main, quand rien n'est sélectionné. */
function toolTemplate(editor: Editor, defaults: EditorDefaults): NewElement | null {
  const mode = editor.mode;
  const page = editor.view.current?.pageSize ?? { width: 595, height: 842 };
  if (mode.kind === 'text' || editor.draft) return textElement('', { x: 0, y: 0 }, { ...defaults, size: editor.draft?.size ?? defaults.size }, page);
  if (mode.kind !== 'draw') return null;
  if (mode.shape === 'ink') return { type: 'ink', strokes: [], color: defaults.inkColor, width: defaults.inkWidth };
  if (mode.shape === 'whiteout' || mode.shape === 'cover') return null;
  return shapeFromDrag(mode.shape, { x: 0, y: 0 }, { x: 0.1, y: 0.1 }, defaults);
}

/** Vrai s'il y a quelque chose à régler : un élément sélectionné, ou un outil qui a des réglages. */
export function hasProperties(editor: Editor, defaults: EditorDefaults): boolean {
  return !!editor.selected || !!toolTemplate(editor, defaults);
}

export function PropertyBar({
  editor,
  defaults,
  onDefaults,
  pageCount,
  pageSizes,
  variant,
  fixedRatio,
}: {
  editor: Editor;
  defaults: EditorDefaults;
  onDefaults: (patch: Partial<EditorDefaults>) => void;
  pageCount: number;
  /** Format de chaque page du document (pour répéter un élément sur toutes). */
  pageSizes: () => Promise<PageSize[]>;
  variant: 'bar' | 'panel';
  /** Les images gardent toujours leurs proportions (signatures) : le réglage n'est pas proposé. */
  fixedRatio?: boolean;
}) {
  const t = useT();
  const selected = editor.selected;
  const template = selected ? null : toolTemplate(editor, defaults);
  const el = (selected ?? template) as EditorElement | null;
  if (!el) return null;
  const panel = variant === 'panel';

  const apply = (changes: Record<string, unknown>, group?: string) => {
    if (selected) editor.patch(selected.id, changes as Partial<EditorElement>, { group });
    // Le texte en cours de saisie n'est pas encore un élément : seuls les réglages changent.
    if (!editor.draft?.size || !('size' in changes)) onDefaults(defaultsFrom(el.type, changes));
    else editor.setDraft({ ...editor.draft, size: changes.size as number });
  };

  const name = selected ? elementName(selected, t) : t(`editor.el.${el.type}`);
  const sections: ReactNode[] = [];
  const section = (key: string, label: string, node: ReactNode) => sections.push(<Section key={key} label={label} panel={panel}>{node}</Section>);

  if (el.type === 'text') {
    if (selected) {
      section('edit', t('editor.prop.content'), (
        <IconButton variant="soft" label={t('editor.editText')} onClick={() => editor.setEditing(selected.id)}>
          <PencilLine />
        </IconButton>
      ));
    }
    section('size', t('editor.prop.size'), <Stepper label={t('editor.prop.size')} value={el.size} min={4} max={200} onChange={(size) => apply({ size }, 'size')} />);
    section('color', t('editor.prop.color'), <Swatches label={t('editor.prop.color')} value={el.color} colors={INK_COLORS} custom wrap={panel} onChange={(color) => apply({ color }, 'color')} />);
    section('font', t('editor.prop.font'), (
      <Select<OverlayFont>
        aria-label={t('editor.prop.font')}
        value={el.font}
        onChange={(font) => apply({ font })}
        className={panel ? undefined : 'w-36'}
        options={[
          { value: 'sans', label: t('editor.font.sans') },
          { value: 'serif', label: t('editor.font.serif') },
          { value: 'mono', label: t('editor.font.mono') },
        ]}
      />
    ));
    if (selected?.type === 'text') {
      section('style', t('editor.prop.style'), (
        <div className="flex gap-1">
          <Toggle label={t('editor.bold')} on={!!selected.bold} onClick={() => apply({ bold: !selected.bold })}><Bold /></Toggle>
          <Toggle label={t('editor.italic')} on={!!selected.italic} onClick={() => apply({ italic: !selected.italic })}><Italic /></Toggle>
        </div>
      ));
      const align = selected.align ?? 'left';
      section('align', t('editor.prop.align'), (
        <div role="radiogroup" aria-label={t('editor.prop.align')} className="flex gap-1">
          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([value, Icon]) => (
            <Toggle key={value} radio label={t(`editor.align.${value}`)} on={align === value} onClick={() => apply({ align: value })}><Icon /></Toggle>
          ))}
        </div>
      ));
    }
  } else if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'line' || el.type === 'arrow') {
    const closed = el.type === 'rect' || el.type === 'ellipse';
    section('stroke', closed ? t('editor.prop.stroke') : t('editor.prop.color'), (
      <Swatches label={closed ? t('editor.prop.stroke') : t('editor.prop.color')} value={el.stroke ?? ''} colors={INK_COLORS} custom wrap={panel} onChange={(stroke) => apply({ stroke }, 'stroke')} />
    ));
    section('width', t('editor.prop.strokeWidth'), <Stepper label={t('editor.prop.strokeWidth')} value={el.strokeWidth} min={0.5} max={24} step={0.5} onChange={(strokeWidth) => apply({ strokeWidth }, 'width')} />);
    if (closed) {
      section('fill', t('editor.prop.fill'), (
        <Swatches label={t('editor.prop.fill')} value={el.fill ?? ''} colors={INK_COLORS} none custom wrap={panel} onChange={(fill) => apply({ fill: fill || undefined }, 'fill')} />
      ));
    }
  } else if (el.type === 'ink') {
    section('color', t('editor.prop.color'), <Swatches label={t('editor.prop.color')} value={el.color} colors={INK_COLORS} custom wrap={panel} onChange={(color) => apply({ color }, 'color')} />);
    section('width', t('editor.prop.strokeWidth'), <Stepper label={t('editor.prop.strokeWidth')} value={el.width} min={0.5} max={24} step={0.5} onChange={(width) => apply({ width }, 'width')} />);
  } else if (el.type === 'highlight') {
    section('color', t('editor.prop.color'), <Swatches label={t('editor.prop.color')} value={el.color} colors={HIGHLIGHT_COLORS} wrap={panel} onChange={(color) => apply({ color }, 'color')} />);
  } else if (el.type === 'whiteout') {
    section('color', t('editor.prop.color'), <Swatches label={t('editor.prop.color')} value={el.color ?? '#ffffff'} colors={WHITEOUT_COLORS} custom wrap={panel} onChange={(color) => apply({ color }, 'color')} />);
  }

  if (selected && (selected.type === 'image' || selected.type === 'rect' || selected.type === 'ellipse' || selected.type === 'line' || selected.type === 'arrow' || selected.type === 'ink')) {
    const opacity = selected.opacity ?? 1;
    section('opacity', `${t('editor.prop.opacity')} · ${formatPercent(opacity)}`, (
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={opacity}
        aria-label={t('editor.prop.opacity')}
        onChange={(e) => apply({ opacity: e.target.valueAsNumber }, 'opacity')}
        className={cn('h-11', panel ? 'w-full' : 'w-36')}
      />
    ));
  }
  if (selected?.type === 'image' && !fixedRatio) {
    section('ratio', t('editor.prop.ratio'), (
      <label className="flex min-h-11 items-center gap-2 text-sm whitespace-nowrap">
        <input type="checkbox" checked={selected.keepRatio !== false} onChange={(e) => apply({ keepRatio: e.target.checked })} />
        {t('editor.keepRatio')}
      </label>
    ));
  }

  const duplicate = () => {
    if (!selected) return;
    const { id, ...copy } = moved(selected, 0.02, 0.02);
    editor.add([copy as NewElement]);
  };
  const actions = selected && (
    <>
      <IconButton variant="soft" label={t('editor.duplicate')} onClick={duplicate}><Copy /></IconButton>
      {pageCount > 1 && (
        <IconButton
          variant="soft"
          label={t('editor.copyToAll')}
          onClick={async () => {
            editor.copyToAllPages(selected.id, await pageSizes());
            editor.announce(t('editor.copiedToAll', { count: pageCount - 1 }));
          }}
        >
          <Files />
        </IconButton>
      )}
    </>
  );
  const remove = selected && (
    <IconButton
      variant="soft"
      label={t('editor.delete')}
      className="text-danger"
      onClick={() => {
        editor.remove(selected.id);
        editor.announce(t('editor.deleted'));
      }}
    >
      <Trash2 />
    </IconButton>
  );
  const hint = el.type === 'whiteout' ? t('editor.whiteoutHint') : null;
  const notice = selected?.type === 'text' ? <UnsupportedNotice el={selected} /> : null;

  if (panel) {
    return (
      <section aria-label={t('editor.properties', { name })} className="flex flex-col gap-4">
        <h3 className="truncate font-display text-xl font-semibold">{name}</h3>
        {sections}
        {hint && <p className="text-sm text-ink-soft">{hint}</p>}
        {notice}
        {selected && <div className="flex flex-wrap gap-2 border-t border-line pt-3">{actions}{remove}</div>}
      </section>
    );
  }
  return (
    <div role="toolbar" aria-label={t('editor.properties', { name })} className="flex items-end gap-2">
      <div className="scrollbar-thin flex min-w-0 flex-1 items-end gap-4 overflow-x-auto pb-1">
        {sections}
        {hint && <p className="w-56 shrink-0 self-center text-xs text-ink-soft">{hint}</p>}
        {notice && <div className="w-56 shrink-0 self-center">{notice}</div>}
        {actions && <div className="flex shrink-0 gap-1 pr-1">{actions}</div>}
      </div>
      {remove && <div className="shrink-0 border-l border-line pb-1 pl-2">{remove}</div>}
    </div>
  );
}
