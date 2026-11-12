// Logo, mascotte et motifs maison.
import logoUrl from '@/assets/logo.webp';
import { cn } from './cn';

/** Logo de l'application (décoratif : le nom « PidiElf » l'accompagne ou le remplace pour les lecteurs d'écran). */
export function Logo({ className }: { className?: string }) {
  return <img src={logoUrl} alt="" width={144} height={144} decoding="async" draggable={false} className={cn('select-none', className)} />;
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Logo className="size-10" />
      <span className="font-display text-[1.7rem] leading-none font-semibold tracking-tight">
        Pidi<span className="text-accent">Elf</span>
      </span>
    </span>
  );
}

export type MascotMood = 'reading' | 'happy' | 'searching' | 'sleeping';

/** Petite mascotte elfe pour les écrans vides et les messages de réussite. */
export function Mascot({ mood = 'reading', className }: { mood?: MascotMood; className?: string }) {
  const eyes =
    mood === 'sleeping' ? (
      <path d="M49 60q4 3 8 0M67 60q4 3 8 0" strokeWidth="2.4" />
    ) : mood === 'happy' ? (
      <path d="M49 61q4-5 8 0M67 61q4-5 8 0" strokeWidth="2.4" />
    ) : (
      <>
        <circle cx="53" cy="60" r="2.6" fill="var(--c-ink)" stroke="none" />
        <circle cx="71" cy="60" r="2.6" fill="var(--c-ink)" stroke="none" />
      </>
    );
  return (
    <svg viewBox="0 0 124 132" fill="none" className={className} aria-hidden="true" stroke="var(--c-ink)" strokeLinecap="round" strokeLinejoin="round">
      {/* étoiles */}
      <path d="M14 22l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8zM108 12l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" fill="var(--cat-lire-bg)" strokeWidth="1.4" />
      {/* oreilles pointues */}
      <path d="M38 62C26 58 19 50 16 40c10 1 19 6 25 13zM86 62c12-4 19-12 22-22-10 1-19 6-25 13z" fill="var(--cat-convertir-bg)" strokeWidth="2.2" />
      {/* visage */}
      <circle cx="62" cy="60" r="25" fill="var(--cat-convertir-bg)" strokeWidth="2.2" />
      {/* bonnet feuille */}
      <path d="M36 54c0-18 11-32 26-38 15 6 26 20 26 38-8-7-17-10-26-10s-18 3-26 10z" fill="var(--cat-organiser-bg)" strokeWidth="2.2" />
      <path d="M62 16v28M62 30l-8-6M62 37l9-7" strokeWidth="1.8" opacity=".6" />
      {eyes}
      <path d={mood === 'searching' ? 'M58 71h8' : 'M57 70q5 5 10 0'} strokeWidth="2.2" />
      <circle cx="46" cy="67" r="3.4" fill="var(--cat-securiser-bg)" stroke="none" />
      <circle cx="78" cy="67" r="3.4" fill="var(--cat-securiser-bg)" stroke="none" />
      {/* livre ouvert */}
      <path d="M62 98c-9-7-21-8-34-6v28c13-2 25-1 34 6 9-7 21-8 34-6V92c-13-2-25-1-34 6z" fill="var(--c-surface)" strokeWidth="2.2" />
      <path d="M62 98v28M36 101c7-.6 13 0 19 3M36 109c7-.6 13 0 19 3M88 101c-7-.6-13 0-19 3M88 109c-7-.6-13 0-19 3" strokeWidth="1.6" opacity=".55" />
      {/* mains */}
      <circle cx="29" cy="107" r="5" fill="var(--cat-convertir-bg)" strokeWidth="2" />
      <circle cx="95" cy="107" r="5" fill="var(--cat-convertir-bg)" strokeWidth="2" />
      {mood === 'sleeping' && <path d="M96 30h8l-8 9h8M108 44h5l-5 6h5" strokeWidth="1.8" />}
    </svg>
  );
}

export function EmptyState({
  title,
  text,
  mood,
  children,
}: {
  title: string;
  text?: string;
  mood?: MascotMood;
  children?: React.ReactNode;
}) {
  return (
    <div className="elf-pattern flex flex-col items-center rounded-xl border border-dashed border-line-strong/50 px-6 py-10 text-center">
      <Mascot mood={mood} className="mb-4 h-32 w-auto" />
      <h2 className="text-2xl">{title}</h2>
      {text && <p className="mt-2 max-w-md text-ink-soft">{text}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
