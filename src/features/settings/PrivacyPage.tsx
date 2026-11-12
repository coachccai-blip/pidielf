import { ArrowLeft, CloudOff, Cookie, Database, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useT } from '@/i18n';
import { href, routes } from '@/lib/router';
import { Page } from '@/features/shell/Shell';

const points = [
  { icon: CloudOff, key: 'local' },
  { icon: Database, key: 'storage' },
  { icon: Cookie, key: 'tracking' },
  { icon: KeyRound, key: 'passwords' },
  { icon: Trash2, key: 'erase' },
] as const;

/** Page Confidentialité : quelques lignes simples, dans les deux langues. */
export default function PrivacyPage() {
  const t = useT();
  return (
    <Page
      title={t('privacy.title')}
      subtitle={t('privacy.subtitle')}
      icon={<ShieldCheck />}
      cat="organiser"
      back={
        <a href={href(routes.settings)} aria-label={t('common.back')} title={t('common.back')} className="grid size-11 shrink-0 place-items-center rounded-md text-cat-ink hover:bg-surface/50">
          <ArrowLeft className="size-5" />
        </a>
      }
    >
      <ul className="mx-auto flex max-w-2xl flex-col gap-3">
        {points.map(({ icon: Icon, key }) => (
          <li key={key} className="flex gap-4 rounded-xl border border-line bg-surface p-4 shadow-soft">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
              <Icon className="size-5" />
            </span>
            <div>
              <h2 className="font-sans text-lg font-bold">{t(`privacy.${key}Title`)}</h2>
              <p className="mt-0.5 text-ink-soft">{t(`privacy.${key}Text`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Page>
  );
}
