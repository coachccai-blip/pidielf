// Champ de mot de passe avec bouton afficher / masquer. Sa valeur ne vit que
// dans l'état du composant parent : elle n'est jamais enregistrée.
import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useT } from '@/i18n';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';

export function PasswordField({
  label,
  value,
  onChange,
  hint,
  error,
  autoComplete = 'new-password',
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Message d'erreur affiché sous le champ et annoncé aux lecteurs d'écran. */
  error?: string;
  autoComplete?: 'new-password' | 'off';
  /** Touche Entrée dans le champ (lancer le traitement, par exemple). */
  onEnter?: () => void;
}) {
  const t = useT();
  const id = useId();
  const [visible, setVisible] = useState(false);
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <div
        className={cn(
          'flex items-center rounded-md border bg-surface focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus',
          error ? 'border-danger' : 'border-line-strong',
        )}
      >
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onEnter && ((e) => e.key === 'Enter' && onEnter())}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={127}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          className="min-h-11 w-full min-w-0 flex-1 rounded-md bg-transparent pl-3 text-base text-ink outline-none"
        />
        <IconButton label={t(visible ? 'common.hidePassword' : 'common.showPassword')} active={visible} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff /> : <Eye />}
        </IconButton>
      </div>
      {note && (
        <p id={`${id}-note`} role={error ? 'alert' : undefined} className={error ? 'text-sm font-semibold text-danger' : 'text-xs text-ink-soft'}>
          {note}
        </p>
      )}
    </div>
  );
}
