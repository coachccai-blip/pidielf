// Messages brefs, annoncés aux lecteurs d'écran.
import { useSyncExternalStore, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from './cn';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  action?: { label: string; onClick: () => void };
  sticky?: boolean;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, options: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
  const item: Toast = { id: nextId++, kind: options.kind ?? 'info', message, action: options.action, sticky: options.sticky };
  toasts = [...toasts.slice(-3), item];
  emit();
  if (!item.sticky) setTimeout(() => dismissToast(item.id), item.action ? 8000 : 4500);
  return item.id;
}

export const toastSuccess = (message: string, action?: Toast['action']) => toast(message, { kind: 'success', action });
export const toastError = (message: string, action?: Toast['action']) => toast(message, { kind: 'error', action });

const icons: Record<Toast['kind'], ReactNode> = {
  success: <CheckCircle2 className="text-accent" />,
  error: <CircleAlert className="text-danger" />,
  info: <Info className="text-ink-soft" />,
};

export function Toaster() {
  const t = useT();
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+var(--safe-bottom))] z-[60] flex flex-col items-center gap-2 px-3 md:bottom-6"
      role="status"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-md animate-rise items-center gap-3 rounded-lg border border-line bg-surface py-2 pr-2 pl-4 text-[0.95rem] shadow-lift',
          )}
        >
          <span className="shrink-0 [&>svg]:size-5" aria-hidden="true">{icons[item.kind]}</span>
          <span className="min-w-0 flex-1 py-1.5">{item.message}</span>
          {item.action && (
            <button
              type="button"
              className="min-h-9 shrink-0 rounded-md px-3 font-bold text-accent hover:bg-accent-soft"
              onClick={() => {
                dismissToast(item.id);
                item.action!.onClick();
              }}
            >
              {item.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label={t('common.close')}
            className="grid size-9 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-surface-2"
            onClick={() => dismissToast(item.id)}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
