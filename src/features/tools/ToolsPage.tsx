import { useT } from '@/i18n';
import { Page } from '@/features/shell/Shell';
import { ToolGrid } from './ToolCard';

export default function ToolsPage({ fileIds }: { fileIds?: string[] }) {
  const t = useT();
  return (
    <Page title={t('tools.title')} subtitle={t('tools.subtitle')}>
      <ToolGrid fileIds={fileIds} />
    </Page>
  );
}
