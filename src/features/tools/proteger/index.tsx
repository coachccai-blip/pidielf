// Protéger : mot de passe d'ouverture (AES 256 bits) et restrictions
// d'impression, de copie et de modification. Les mots de passe ne vivent que
// dans l'état de ce composant, le temps du traitement.
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Info, KeyRound, Lock, Plus, Trash2, X } from 'lucide-react';
import { suggestName } from '@/core/naming';
import { estimateStrength, generatePassword } from '@/core/password';
import { formatBytes, useT } from '@/i18n';
import { useToolSettings } from '@/lib/settings';
import { Button, IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Switch } from '@/ui/Fields';
import { pdfOp } from '@/workers/client';
import { inputBytes, pdfBlob } from '../inputs';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { ToolProps } from '../types';
import { PageThumb, usePdf } from '../usePdf';
import { PasswordField } from './PasswordField';

const crypto = pdfOp<typeof import('@/core/pdf/crypto')>('crypto');

const PERMISSIONS = ['print', 'copy', 'modify'] as const;

export default function Proteger({ inputs, setInputs, addMore, run }: ToolProps) {
  const t = useT();
  // Seules les trois autorisations sont mémorisées — jamais un mot de passe.
  const [permissions, setPermissions] = useToolSettings('proteger', { print: true, copy: true, modify: true });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [owner, setOwner] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const pdf = usePdf(inputs[0].blob);

  const strength = useMemo(() => estimateStrength(password), [password]);
  const restricted = PERMISSIONS.some((p) => !permissions[p]);
  const mismatch = confirmation !== '' && confirmation !== password;
  // Avec le même mot de passe dans les deux rôles, ouvrir le fichier donnerait tous les droits.
  const sameOwner = restricted && owner !== '' && owner === password;
  const batch = inputs.length > 1;

  const problem = !password
    ? t('proteger.needPassword')
    : !confirmation
      ? t('proteger.needConfirmation')
      : mismatch
        ? t('proteger.mismatch')
        : sameOwner
          ? t('proteger.ownerSame')
          : null;

  const start = () =>
    run(async (ctx) => {
      // Sans mot de passe propriétaire choisi, on en tire un au hasard : il n'est ni affiché ni gardé.
      const secrets = { userPassword: password, ownerPassword: owner || generatePassword() };
      try {
        const outputs = [];
        for (const [i, file] of inputs.entries()) {
          ctx.progress(i / inputs.length, batch ? t('tools.fileOf', { n: i + 1, total: inputs.length }) : undefined);
          const bytes = await crypto('encryptPdf', { bytes: await inputBytes(file), ...secrets, permissions }, { signal: ctx.signal });
          outputs.push({ name: suggestName(file.name, t('proteger.suffix')), blob: pdfBlob(bytes), pageCount: file.pageCount, parentId: file.libraryId });
        }
        return { outputs, note: t('proteger.note') };
      } finally {
        setPassword('');
        setConfirmation('');
        setOwner('');
      }
    });

  return (
    <ToolLayout
      preview={
        <div className="flex flex-col gap-3">
          <section className="flex items-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-soft" aria-label={t('proteger.previewTitle')}>
            <div className="relative w-20 shrink-0 sm:w-28">
              <PageThumb pdf={pdf} page={1} width={112} className="rounded-sm border border-line" />
              <span className="absolute -right-2 -bottom-2 grid size-9 place-items-center rounded-full border-2 border-surface bg-cat text-cat-ink" aria-hidden="true">
                <Lock className="size-4" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl">{t('proteger.previewTitle')}</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                <li className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 size-4 shrink-0 text-cat-ink" aria-hidden="true" />
                  <span>{t('proteger.previewOpen')}</span>
                </li>
                {PERMISSIONS.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    {permissions[p] ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                    )}
                    <span>{t(`proteger.preview.${p}.${permissions[p] ? 'on' : 'off'}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <ul className="flex flex-col gap-2">
            {inputs.map((file) => (
              <li key={file.key} className="flex items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pr-1.5 pl-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{file.name}</p>
                  <p className="text-xs text-ink-soft">{t('common.pages', { count: file.pageCount })} · {formatBytes(file.blob.size)}</p>
                </div>
                {batch && (
                  <IconButton label={t('tools.remove', { name: file.name })} onClick={() => setInputs(inputs.filter((f) => f.key !== file.key))} className="text-danger">
                    <Trash2 />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
          <Button icon={<Plus />} onClick={addMore} className="self-start">{t('tools.addFiles')}</Button>
        </div>
      }
      options={
        <>
          <OptionGroup title={t('proteger.passwordTitle')}>
            <PasswordField label={t('proteger.password')} value={password} onChange={setPassword} />
            <StrengthMeter empty={!password} score={strength.score} label={t(`proteger.strength.${strength.label}`)} advice={strength.advice && t(`proteger.advice.${strength.advice}`)} />
            <PasswordField
              label={t('proteger.confirmation')}
              value={confirmation}
              onChange={setConfirmation}
              error={mismatch ? t('proteger.mismatch') : undefined}
              onEnter={problem ? undefined : start}
            />
            <p className="text-xs text-ink-soft">{t('proteger.keepSafe')}</p>
          </OptionGroup>

          <OptionGroup title={t('proteger.permissionsTitle')}>
            {PERMISSIONS.map((p) => (
              <Switch key={p} checked={permissions[p]} onChange={(v) => setPermissions({ [p]: v })} label={t(`proteger.allow.${p}`)} />
            ))}
            <p className="flex gap-2 rounded-lg bg-surface-2 p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
              <span>{t('proteger.honest')}</span>
            </p>
          </OptionGroup>

          <div className="border-t border-line pt-2">
            <button
              type="button"
              aria-expanded={advanced}
              aria-controls="proteger-advanced"
              onClick={() => setAdvanced(!advanced)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md font-semibold"
            >
              {t('proteger.advanced')}
              <ChevronDown className={cn('size-5 transition-transform duration-150', advanced && 'rotate-180')} aria-hidden="true" />
            </button>
            <div id="proteger-advanced" hidden={!advanced} className="flex flex-col gap-2 pt-1">
              <PasswordField
                label={t('proteger.owner')}
                value={owner}
                onChange={setOwner}
                error={sameOwner ? t('proteger.ownerSame') : undefined}
                hint={t('proteger.ownerHint')}
              />
              <p className="text-xs text-ink-soft">{t('proteger.ownerRandom')}</p>
            </div>
          </div>
        </>
      }
      actionLabel={t('proteger.action')}
      actionHint={problem ?? (batch ? t('tools.batchCount', { count: inputs.length }) : t('proteger.summary'))}
      actionDisabled={problem !== null}
      onAction={start}
    />
  );
}

/** Solidité du mot de passe : barre à cinq crans et mot, pour ne pas dépendre de la couleur. */
function StrengthMeter({ empty, score, label, advice }: { empty: boolean; score: number; label: string; advice?: string }) {
  const t = useT();
  const tone = score <= 1 ? 'bg-danger' : score === 2 ? 'bg-ink-soft' : 'bg-accent';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-200', !empty && i <= score ? tone : 'bg-line')} />
        ))}
      </div>
      <p className="min-h-5 text-sm" aria-live="polite">
        {empty ? (
          <span className="text-ink-soft">{t('proteger.strengthEmpty')}</span>
        ) : (
          <>
            {t('proteger.strengthLabel')} <strong>{label}</strong>
            {advice && <span className="text-ink-soft"> — {advice}</span>}
          </>
        )}
      </p>
    </div>
  );
}
