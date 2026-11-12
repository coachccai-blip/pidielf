// Déverrouiller : retire la protection d'un PDF avec un mot de passe que
// l'utilisateur connaît. Rien n'est deviné, rien n'est contourné, et aucun mot
// de passe n'est enregistré.
import { useEffect, useRef, useState } from 'react';
import { FileWarning, Lock, LockOpen, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { suggestName } from '@/core/naming';
import type { EncryptionInfo } from '@/core/qpdf';
import { formatBytes, useT } from '@/i18n';
import { Button, IconButton } from '@/ui/Button';
import { Spinner, Switch } from '@/ui/Fields';
import { pdfOp } from '@/workers/client';
import { inputBytes, pdfBlob } from '../inputs';
import { PasswordField } from '../proteger/PasswordField';
import { OptionGroup, ToolLayout } from '../ToolLayout';
import type { InputFile, OutputFile, ToolProps } from '../types';
import { PageThumb, usePdf } from '../usePdf';

const crypto = pdfOp<typeof import('@/core/pdf/crypto')>('crypto');

/**
 * Ce qui protège un fichier :
 * - `open` : un mot de passe est demandé à l'ouverture ;
 * - `restricted` : il s'ouvre librement mais porte des restrictions (mot de passe propriétaire exigé) ;
 * - `free` : restrictions posées sans aucun mot de passe ;
 * - `none` : aucune protection ; `damaged` : fichier illisible.
 */
type Protection = { kind: 'checking' | 'open' | 'free' | 'none' | 'damaged' } | { kind: 'restricted'; limits: string[] };
type Failure = 'bad-password' | 'owner-required' | 'not-encrypted';

const REASONS: Record<Failure, string> = { 'bad-password': 'wrong', 'owner-required': 'owner', 'not-encrypted': 'none' };

function classify(info: EncryptionInfo): Protection {
  if (!info.encrypted) return { kind: 'none' };
  if (info.needsPassword) return { kind: 'open' };
  if (info.passwordRole === 'owner') return { kind: 'free' };
  const p = info.permissions;
  return { kind: 'restricted', limits: p ? (['print', 'copy', 'modify'] as const).filter((k) => !p[k]) : [] };
}

export default function Deverrouiller({ inputs, setInputs, addMore, run }: ToolProps) {
  const t = useT();
  const [protections, setProtections] = useState<Record<string, Protection>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [shared, setShared] = useState('');
  const [same, setSame] = useState(false);
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  const inspected = useRef(new Set<string>());

  // Les fichiers qui s'ouvrent sans mot de passe sont examinés : protégés par de simples restrictions, ou pas du tout ?
  useEffect(() => {
    void (async () => {
      for (const file of inputs) {
        if (file.encrypted || inspected.current.has(file.key)) continue;
        inspected.current.add(file.key);
        const protection = await crypto('inspectEncryption', { bytes: await inputBytes(file) }).then(classify, (): Protection => ({ kind: 'damaged' }));
        setProtections((prev) => ({ ...prev, [file.key]: protection }));
      }
    })();
  }, [inputs]);

  const protectionOf = (file: InputFile): Protection => (file.encrypted ? { kind: 'open' } : (protections[file.key] ?? { kind: 'checking' }));
  const needsPassword = (file: InputFile) => ['open', 'restricted'].includes(protectionOf(file).kind);
  const asking = inputs.filter(needsPassword);
  const useShared = same && asking.length > 1;
  const passwordOf = (file: InputFile) => (protectionOf(file).kind === 'free' ? '' : useShared ? shared : (passwords[file.key] ?? ''));
  const ready = inputs.filter((f) => protectionOf(f).kind === 'free' || (needsPassword(f) && passwordOf(f) !== ''));
  const checking = inputs.some((f) => protectionOf(f).kind === 'checking');

  const typePassword = (keys: string[], update: () => void) => {
    update();
    if (keys.some((k) => failures[k])) setFailures(Object.fromEntries(Object.entries(failures).filter(([k]) => !keys.includes(k))));
  };

  const start = () =>
    run(async (ctx) => {
      const outputs: OutputFile[] = [];
      const failed: Record<string, Failure> = {};
      try {
        for (const [i, file] of ready.entries()) {
          ctx.progress(i / ready.length, ready.length > 1 ? t('tools.fileOf', { n: i + 1, total: ready.length }) : undefined);
          const result = await crypto('unlockPdf', { bytes: await inputBytes(file), password: passwordOf(file) }, { signal: ctx.signal });
          if (result.status !== 'unlocked') failed[file.key] = result.status;
          else outputs.push({ name: suggestName(file.name, t('deverrouiller.suffix')), blob: pdfBlob(result.bytes), pageCount: result.pageCount, parentId: file.libraryId });
        }
      } finally {
        // Les mots de passe ne survivent pas au traitement, qu'il réussisse ou non.
        setPasswords({});
        setShared('');
      }
      setFailures(failed);
      // Rien à remettre : retour aux réglages, où chaque fichier affiche déjà ce qui n'a pas marché.
      if (outputs.length === 0) throw new DOMException('Annulé', 'AbortError');
      if (outputs.length === inputs.length) return { outputs, note: t('deverrouiller.note', { count: outputs.length }) };
      // Fichiers laissés de côté : on dit lesquels, et pourquoi.
      const left = inputs
        .filter((f) => failed[f.key] || !ready.includes(f))
        .map((f) => {
          const kind = protectionOf(f).kind;
          const reason = failed[f.key] ? REASONS[failed[f.key]] : kind === 'none' || kind === 'damaged' ? kind : 'missing';
          return t('deverrouiller.leftItem', { name: f.name, reason: t(`deverrouiller.reason.${reason}`) });
        });
      return { outputs, note: t('deverrouiller.notePartial', { count: outputs.length, list: left.join(' ; ') }) };
    });

  const canStart = ready.length > 0 && !checking;
  const hint = checking
    ? t('deverrouiller.checking')
    : inputs.every((f) => ['none', 'damaged'].includes(protectionOf(f).kind))
      ? t('deverrouiller.nothing', { count: inputs.length })
      : ready.length === 0
        ? t('deverrouiller.needPassword', { count: asking.length })
        : ready.length < inputs.length
          ? t('deverrouiller.summaryPartial', { ready: ready.length, total: inputs.length })
          : t('deverrouiller.summary', { count: ready.length });

  return (
    <ToolLayout
      preview={
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {inputs.map((file) => (
              <FileCard
                key={file.key}
                file={file}
                protection={protectionOf(file)}
                password={useShared ? null : (passwords[file.key] ?? '')}
                onPassword={(value) => typePassword([file.key], () => setPasswords({ ...passwords, [file.key]: value }))}
                failure={failures[file.key]}
                onEnter={canStart ? start : undefined}
                onRemove={inputs.length > 1 ? () => setInputs(inputs.filter((f) => f.key !== file.key)) : undefined}
              />
            ))}
          </ul>
          <Button icon={<Plus />} onClick={addMore} className="self-start">{t('tools.addFiles')}</Button>
        </div>
      }
      options={
        <>
          {asking.length > 1 && (
            <OptionGroup title={t('deverrouiller.batchTitle')}>
              <Switch checked={same} onChange={setSame} label={t('deverrouiller.same')} />
              {same && (
                <PasswordField
                  label={t('deverrouiller.shared')}
                  value={shared}
                  onChange={(value) => typePassword(asking.map((f) => f.key), () => setShared(value))}
                  autoComplete="off"
                  onEnter={canStart ? start : undefined}
                />
              )}
            </OptionGroup>
          )}
          <OptionGroup title={t('deverrouiller.policyTitle')}>
            <ul className="flex flex-col gap-2 text-sm">
              {(['known', 'never', 'owner'] as const).map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cat-ink" aria-hidden="true" />
                  <span>{t(`deverrouiller.policy.${line}`)}</span>
                </li>
              ))}
            </ul>
          </OptionGroup>
        </>
      }
      actionLabel={t('deverrouiller.action')}
      actionHint={hint}
      actionDisabled={!canStart}
      onAction={start}
    />
  );
}

function FileCard({
  file,
  protection,
  password,
  onPassword,
  failure,
  onEnter,
  onRemove,
}: {
  file: InputFile;
  protection: Protection;
  /** `null` : le mot de passe commun s'applique à ce fichier. */
  password: string | null;
  onPassword: (value: string) => void;
  failure?: Failure;
  onEnter?: () => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const { kind } = protection;
  // Un fichier verrouillé à l'ouverture n'a pas d'aperçu : on ne peut pas le lire sans son mot de passe.
  const pdf = usePdf(kind === 'open' || kind === 'damaged' ? null : file.blob);
  const asks = kind === 'open' || kind === 'restricted';
  const status =
    protection.kind === 'restricted'
      ? t(protection.limits.length ? 'deverrouiller.status.restricted' : 'deverrouiller.status.restrictedOther', {
          list: protection.limits.map((l) => t(`deverrouiller.limit.${l}`)).join(', '),
        })
      : t(`deverrouiller.status.${kind}`);
  const error = failure && t(`deverrouiller.failure.${failure}`);

  return (
    <li className="flex gap-3 rounded-xl border border-line bg-surface p-3 shadow-soft">
      <div className="w-12 shrink-0 sm:w-16">
        {kind === 'open' || kind === 'damaged' ? (
          <span className="grid aspect-[3/4] w-full place-items-center rounded-sm bg-cat text-cat-ink" aria-hidden="true">
            {kind === 'open' ? <Lock className="size-5" /> : <FileWarning className="size-5" />}
          </span>
        ) : (
          <PageThumb pdf={pdf} page={1} width={64} className="rounded-sm border border-line" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{file.name}</p>
            <p className="text-xs text-ink-soft">
              {file.pageCount > 0 && `${t('common.pages', { count: file.pageCount })} · `}
              {formatBytes(file.blob.size)}
            </p>
          </div>
          {onRemove && (
            <IconButton size="sm" label={t('tools.remove', { name: file.name })} onClick={onRemove} className="text-danger">
              <Trash2 />
            </IconButton>
          )}
        </div>
        <p className="flex items-start gap-2 text-sm" role="status">
          {kind === 'checking' ? (
            <Spinner className="mt-0.5 size-4" />
          ) : kind === 'none' ? (
            <LockOpen className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
          ) : kind === 'damaged' ? (
            <FileWarning className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          ) : (
            <Lock className="mt-0.5 size-4 shrink-0 text-cat-ink" aria-hidden="true" />
          )}
          <span>{status}</span>
        </p>
        {asks &&
          (password === null ? (
            <p className={error ? 'text-sm font-semibold text-danger' : 'text-sm text-ink-soft'} role={error ? 'alert' : undefined}>
              {error ?? t('deverrouiller.usesShared')}
            </p>
          ) : (
            <PasswordField
              label={t(kind === 'restricted' ? 'deverrouiller.ownerPassword' : 'deverrouiller.password')}
              value={password}
              onChange={onPassword}
              autoComplete="off"
              error={error}
              hint={kind === 'restricted' ? t('deverrouiller.ownerHint') : undefined}
              onEnter={onEnter}
            />
          ))}
      </div>
    </li>
  );
}
