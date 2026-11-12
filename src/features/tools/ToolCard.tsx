import { useT } from '@/i18n';
import { href, routes } from '@/lib/router';
import { cn } from '@/ui/cn';
import { categoryIcons, toolsByCategory, toolCategories, type ToolMeta } from './registry';

export function ToolCard({ tool, fileIds, compact }: { tool: ToolMeta; fileIds?: string[]; compact?: boolean }) {
  const t = useT();
  return (
    <a
      href={href(routes.tool(tool.id, fileIds))}
      data-cat={tool.cat}
      className={cn(
        'group flex gap-3 rounded-lg border border-cat-ink/10 bg-cat text-cat-ink shadow-soft transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]',
        compact ? 'min-h-14 items-center px-3 py-2' : 'min-h-[5.5rem] flex-col p-3.5',
      )}
    >
      <span className={cn('grid shrink-0 place-items-center rounded-md bg-surface/70', compact ? 'size-9' : 'size-10')} aria-hidden="true">
        <tool.icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block leading-tight font-bold">{t(`tools.${tool.id}.name`)}</span>
        {!compact && <span className="mt-0.5 block text-[0.82rem] leading-snug opacity-90">{t(`tools.${tool.id}.desc`)}</span>}
      </span>
    </a>
  );
}

/** Grille des outils, regroupés par catégorie : couleur, icône et libellé. */
export function ToolGrid({ fileIds, compact }: { fileIds?: string[]; compact?: boolean }) {
  const t = useT();
  return (
    <div className={cn('flex flex-col', compact ? 'gap-5' : 'gap-7')}>
      {toolCategories.map((cat) => {
        const Icon = categoryIcons[cat];
        return (
          <section key={cat} data-cat={cat} aria-labelledby={`cat-${cat}`}>
            <h3 id={`cat-${cat}`} className={cn('mb-2.5 flex items-center gap-2', compact ? 'text-lg' : 'text-2xl')}>
              <span className="grid size-7 place-items-center rounded-full bg-cat text-cat-ink" aria-hidden="true">
                <Icon className="size-4" />
              </span>
              {t(`categories.${cat}`)}
            </h3>
            <div className={cn('grid gap-2.5', compact ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
              {toolsByCategory(cat).map((tool) => (
                <ToolCard key={tool.id} tool={tool} fileIds={fileIds} compact={compact} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
