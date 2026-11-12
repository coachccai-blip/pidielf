import { useT } from '@/i18n';
import { EmptyState } from '@/ui/Brand';

/** Affiché tant qu'un outil n'est pas encore livré (voir le plan de livraison). */
export function ComingSoon() {
  const t = useT();
  return <EmptyState title={t('tools.soonTitle')} text={t('tools.soonText')} mood="sleeping" />;
}
