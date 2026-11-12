// Ouverture d'un document dans le lecteur : lecture du fichier, mot de passe
// des PDF protégés (jamais enregistré), puis affichage.
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { db, type FileRecord } from '@/db';
import { getFileBlob } from '@/db/files';
import { useT } from '@/i18n';
import { makeCover, openPdf, PdfOpenError, type PDFDocumentProxy } from '@/lib/pdfjs';
import { href, navigate, routes } from '@/lib/router';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/Brand';
import { prompt } from '@/ui/dialogs';
import { Spinner } from '@/ui/Fields';
import { Reader } from './Reader';

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'locked' }
  | { status: 'ready'; file: FileRecord; blob: Blob; pdf: PDFDocumentProxy };

export default function ReaderPage({ fileId }: { fileId: string }) {
  const t = useT();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    (async () => {
      const [file, blob] = await Promise.all([db.files.get(fileId), getFileBlob(fileId)]);
      if (cancelled) return;
      if (!file || !blob) {
        setState({ status: 'missing' });
        return;
      }
      let password: string | undefined;
      let error: string | undefined;
      for (;;) {
        try {
          opened = await openPdf(blob, password);
          break;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof PdfOpenError && (err.code === 'password' || err.code === 'bad-password')) {
            if (err.code === 'bad-password') error = t('tools.password.wrong');
            const answer = await prompt({
              title: t('tools.password.title'),
              message: t('reader.passwordText', { name: file.name }),
              label: t('tools.password.label'),
              password: true,
              confirmLabel: t('common.open'),
              error,
            });
            if (cancelled) return;
            if (answer === null) {
              setState({ status: 'locked' });
              return;
            }
            password = answer;
            continue;
          }
          console.error(err);
          setState({ status: 'error' });
          return;
        }
      }
      if (cancelled) {
        void opened.loadingTask.destroy();
        return;
      }
      // Un PDF protégé n'avait ni nombre de pages ni couverture à l'import.
      if (file.pageCount !== opened.numPages) await db.files.update(file.id, { pageCount: opened.numPages });
      if (file.encrypted && !(await db.covers.get(file.id))) {
        const cover = await makeCover(opened);
        if (cover) await db.covers.put({ id: file.id, blob: cover });
      }
      if (cancelled) return;
      setState({ status: 'ready', file: { ...file, pageCount: opened.numPages }, blob, pdf: opened });
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setState({ status: 'error' });
    });
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, attempt]);

  if (state.status === 'ready') return <Reader file={state.file} blob={state.blob} pdf={state.pdf} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-10">
      {state.status === 'loading' ? (
        <p className="flex items-center justify-center gap-3 text-ink-soft" role="status">
          <Spinner /> {t('reader.opening')}
        </p>
      ) : (
        <EmptyState
          mood={state.status === 'locked' ? 'sleeping' : 'searching'}
          title={t(`reader.${state.status}Title`)}
          text={t(`reader.${state.status}Text`)}
        >
          {state.status === 'locked' && (
            <Button
              variant="primary"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              {t('reader.retryPassword')}
            </Button>
          )}
          <Button icon={<ArrowLeft />} onClick={() => navigate(routes.library)}>{t('nav.library')}</Button>
        </EmptyState>
      )}
      <a href={href(routes.home)} className="sr-only">{t('nav.home')}</a>
    </div>
  );
}
