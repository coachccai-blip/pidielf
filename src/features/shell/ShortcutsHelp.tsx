import { useT } from '@/i18n';
import { Dialog } from '@/ui/Overlay';

const groups: Array<{ title: string; items: Array<[string[], string]> }> = [
  {
    title: 'help.general',
    items: [
      [['?'], 'help.openHelp'],
      [['Échap'], 'help.close'],
      [['Tab'], 'help.tab'],
    ],
  },
  {
    title: 'help.reader',
    items: [
      [['←', '→'], 'help.turn'],
      [['Espace'], 'help.space'],
      [['+', '−'], 'help.zoom'],
      [['Ctrl', 'F'], 'help.search'],
      [['F'], 'help.fullscreen'],
      [['B'], 'help.bookmark'],
      [['T'], 'help.toc'],
      [['M'], 'help.mode'],
    ],
  },
  {
    title: 'help.editor',
    items: [
      [['Ctrl', 'Z'], 'help.undo'],
      [['Ctrl', 'Maj', 'Z'], 'help.redo'],
      [['Suppr'], 'help.delete'],
      [['←', '↑', '↓', '→'], 'help.move'],
    ],
  },
];

/** Aide listant les raccourcis clavier (touche « ? »). */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')}>
      <div className="flex flex-col gap-5 pb-3">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xl">{t(g.title)}</h3>
            <dl className="flex flex-col divide-y divide-line">
              {g.items.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-ink-soft">{t(label)}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {keys.map((k) => (
                      <kbd key={k} className="min-w-8 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-center font-sans text-sm font-bold">
                        {t(`help.keys.${k}`) === `help.keys.${k}` ? k : t(`help.keys.${k}`)}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
