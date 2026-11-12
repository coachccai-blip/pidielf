// Confirmations et saisies sous forme de promesses : `await confirm({...})`.
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useT } from '@/i18n';
import { Button, IconButton } from './Button';
import { Dialog } from './Overlay';

interface ConfirmRequest {
  type: 'confirm';
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
interface PromptRequest {
  type: 'prompt';
  title: string;
  message?: string;
  label: string;
  initial?: string;
  password?: boolean;
  confirmLabel?: string;
  error?: string;
  resolve: (value: string | null) => void;
}
type Request = ConfirmRequest | PromptRequest;

let queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirm(options: Omit<ConfirmRequest, 'type' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { type: 'confirm', ...options, resolve }];
    emit();
  });
}

export function prompt(options: Omit<PromptRequest, 'type' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { type: 'prompt', ...options, resolve }];
    emit();
  });
}

function shift() {
  queue = queue.slice(1);
  emit();
}

export function DialogHost() {
  const t = useT();
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue,
  );
  const request = items[0];
  if (!request) return null;
  if (request.type === 'confirm') {
    const done = (ok: boolean) => {
      request.resolve(ok);
      shift();
    };
    return (
      <Dialog
        open
        size="sm"
        title={request.title}
        onClose={() => done(false)}
        footer={
          <>
            <Button onClick={() => done(false)}>{request.cancelLabel ?? t('common.cancel')}</Button>
            <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => done(true)} data-autofocus>
              {request.confirmLabel ?? t('common.confirm')}
            </Button>
          </>
        }
      >
        {request.message && <p className="text-ink-soft">{request.message}</p>}
      </Dialog>
    );
  }
  return <PromptDialog key={items.length + request.title} request={request} />;
}

function PromptDialog({ request }: { request: PromptRequest }) {
  const t = useT();
  const [value, setValue] = useState(request.initial ?? '');
  const [visible, setVisible] = useState(false);
  const done = (v: string | null) => {
    request.resolve(v);
    shift();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() || request.password) done(value);
  };
  return (
    <Dialog open size="sm" title={request.title} onClose={() => done(null)}>
      <form onSubmit={submit} className="flex flex-col gap-3 pb-2">
        {request.message && <p className="text-ink-soft">{request.message}</p>}
        {request.error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{request.error}</p>}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {request.label}
          <span className="flex items-center gap-1">
            <input
              data-autofocus
              type={request.password && !visible ? 'password' : 'text'}
              autoComplete={request.password ? 'off' : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => !request.password && e.target.select()}
              className="min-h-11 w-full min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-base font-normal"
            />
            {request.password && (
              <IconButton label={visible ? t('common.hidePassword') : t('common.showPassword')} onClick={() => setVisible((v) => !v)}>
                {visible ? <EyeOff /> : <Eye />}
              </IconButton>
            )}
          </span>
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => done(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit">{request.confirmLabel ?? t('common.confirm')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
