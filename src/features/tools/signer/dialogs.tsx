// Signature tapée au clavier (écriture manuscrite) et signature importée
// depuis une image.
import { useEffect, useState } from 'react';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { Checkbox, Field, Segmented, Switch, TextInput } from '@/ui/Fields';
import { Dialog } from '@/ui/Overlay';
import { Swatches } from '../editor/PropertyBar';
import { INKS, SCRIPT_FONT, importedToPng, textToPng, type SignatureImage } from './raster';

interface CommonProps {
  title: string;
  remember: boolean;
  onRemember: (value: boolean) => void;
  onCancel: () => void;
  onDone: (image: SignatureImage) => void;
}

function Footer({ disabled, onCancel, onConfirm }: { disabled: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={disabled} onClick={onConfirm}>{t('common.confirm')}</Button>
    </>
  );
}

/** Feuille blanche d'aperçu : l'encre se juge sur du papier, quel que soit le thème. */
const paper = 'grid min-h-28 place-items-center overflow-hidden rounded-lg border border-line-strong bg-white p-4';

export function TypedDialog({ title, ink, onInk, remember, onRemember, onCancel, onDone, initials }: CommonProps & { ink: string; onInk: (color: string) => void; initials: boolean }) {
  const t = useT();
  const [text, setText] = useState('');
  const [weight, setWeight] = useState<'regular' | 'bold'>('regular');
  const [busy, setBusy] = useState(false);

  const validate = async () => {
    setBusy(true);
    const image = await textToPng(text, ink, weight === 'bold');
    setBusy(false);
    if (image) onDone(image);
  };

  return (
    <Dialog open title={title} onClose={onCancel} footer={<Footer disabled={!text.trim() || busy} onCancel={onCancel} onConfirm={() => void validate()} />}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !busy) void validate();
        }}
      >
        <Field label={initials ? t('signer.typed.initialsLabel') : t('signer.typed.nameLabel')}>
          <TextInput data-autofocus value={text} onChange={(e) => setText(e.target.value)} maxLength={60} autoComplete="off" />
        </Field>
        <div className={paper} aria-hidden="true">
          <span className="max-w-full truncate px-2 text-5xl leading-tight" style={{ fontFamily: SCRIPT_FONT, fontWeight: weight === 'bold' ? 700 : 400, color: ink }}>
            {text.trim() || t('signer.typed.sample')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Swatches label={t('signer.ink')} value={ink} colors={INKS} onChange={onInk} />
          <Segmented
            label={t('signer.typed.weight')}
            value={weight}
            onChange={setWeight}
            size="sm"
            options={[
              { value: 'regular', label: t('signer.typed.regular') },
              { value: 'bold', label: t('signer.typed.bold') },
            ]}
          />
        </div>
        <Checkbox checked={remember} onChange={onRemember} label={t('signer.remember')} />
      </form>
    </Dialog>
  );
}

export function ImportDialog({ title, source, remember, onRemember, onCancel, onDone }: CommonProps & { source: HTMLCanvasElement }) {
  const t = useT();
  const [transparent, setTransparent] = useState(true);
  const [result, setResult] = useState<{ image: SignatureImage | null; url: string | null } | null>(null);

  // L'aperçu montre exactement l'image qui sera posée.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void importedToPng(source, transparent).then((image) => {
      if (cancelled) return;
      url = image ? URL.createObjectURL(image.blob) : null;
      setResult({ image, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, transparent]);

  const image = result?.image ?? null;
  return (
    <Dialog open title={title} onClose={onCancel} footer={<Footer disabled={!image} onCancel={onCancel} onConfirm={() => image && onDone(image)} />}>
      <div className="flex flex-col gap-4">
        <div className={paper}>
          {result?.url && <img src={result.url} alt={t('signer.import.preview')} className="max-h-40 max-w-full object-contain" />}
          {result && !result.url && <p role="alert" className="text-center text-sm text-[#8a2530]">{t('signer.import.blank')}</p>}
        </div>
        <Switch checked={transparent} onChange={setTransparent} label={t('signer.import.transparent')} hint={t('signer.import.transparentHint')} />
        <Checkbox checked={remember} onChange={onRemember} label={t('signer.remember')} />
      </div>
    </Dialog>
  );
}
