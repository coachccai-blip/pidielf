import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'soft' | 'ghost' | 'danger' | 'cat';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-soft',
  soft: 'bg-surface-2 text-ink hover:bg-line border border-line',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger hover:brightness-95 border border-danger/30',
  cat: 'bg-cat text-cat-ink hover:brightness-95 border border-cat-ink/15',
};
const sizes: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-[0.95rem] gap-2',
  lg: 'min-h-13 px-6 text-base gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'soft', size = 'md', icon, block, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold select-none transition-[filter,background-color,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon && <span className="shrink-0 [&>svg]:size-[1.15em]" aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Libellé lu par les lecteurs d'écran (obligatoire). */
  label: string;
  active?: boolean;
  variant?: 'ghost' | 'soft' | 'cat';
  size?: 'md' | 'sm';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-40',
        size === 'md' ? 'size-11 [&>svg]:size-5' : 'size-9 [&>svg]:size-[1.05rem]',
        variant === 'ghost' && 'text-ink hover:bg-surface-2',
        variant === 'soft' && 'border border-line bg-surface-2 text-ink hover:bg-line',
        variant === 'cat' && 'bg-cat text-cat-ink',
        active && 'bg-accent-soft text-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
