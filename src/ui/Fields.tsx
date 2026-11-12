// Champs de formulaire du système de design.
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  // L'aide reste hors du <label> : le nom lu par les lecteurs d'écran est le libellé seul.
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-soft/70 disabled:opacity-50';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) onChange(v);
      }}
      onBlur={(e) => {
        let v = e.target.valueAsNumber;
        if (!Number.isFinite(v)) v = min ?? 0;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        onChange(v);
      }}
      className={cn(inputClass, className)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  ...rest
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
  'aria-label'?: string;
  id?: string;
}) {
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(inputClass, 'pr-8', className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/** Choix exclusif présenté en boutons accolés. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-1 rounded-lg border border-line bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 font-semibold whitespace-nowrap transition-colors duration-150',
              size === 'md' ? 'min-h-10 text-sm' : 'min-h-9 text-[0.8rem]',
              active ? 'bg-surface text-ink shadow-soft' : 'text-ink-soft hover:text-ink',
            )}
          >
            {o.icon && <span className="[&>svg]:size-4" aria-hidden="true">{o.icon}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block font-semibold">{label}</label>
        {hint && <p className="text-sm text-ink-soft">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full border transition-colors duration-150',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-2',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-5.5 rounded-full shadow-soft transition-transform duration-150',
            checked ? 'translate-x-5 bg-accent-ink' : 'bg-line-strong',
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-sm font-bold">
        {label}
        <span className="font-normal text-ink-soft tabular-nums">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="h-11 w-full"
      />
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ProgressBar({ value, label }: { value: number | null; label?: string }) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={cn('h-full rounded-full bg-accent transition-[width] duration-200', pct === null && 'w-1/3 animate-pulse')}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block size-5 animate-spin rounded-full border-2 border-line-strong border-t-accent', className)}
      aria-hidden="true"
    />
  );
}
