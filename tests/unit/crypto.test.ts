import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { decryptPdf, encryptPdf } from '@/core/pdf/crypto';
import { fixture, pageCount, useNodeQpdf } from './helpers';

beforeAll(useNodeQpdf);

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('protéger et déverrouiller', () => {
  it('chiffre en AES 256 bits puis déverrouille avec le bon mot de passe', async () => {
    const original = await fixture('sample-3p.pdf');
    const locked = await encryptPdf({
      bytes: original,
      userPassword: 'clair-de-lune',
      ownerPassword: 'proprio',
      permissions: { print: false, copy: false, modify: false },
    });
    const text = latin1(locked);
    expect(text).toContain('/Encrypt');
    expect(text).toMatch(/\/V 5/); // AES-256
    expect(text).not.toContain('lune1'); // le contenu n'est plus lisible
    await expect(PDFDocument.load(locked)).rejects.toThrow();

    const unlocked = await decryptPdf({ bytes: locked, password: 'clair-de-lune' });
    expect(latin1(unlocked)).not.toContain('/Encrypt');
    expect(await pageCount(unlocked)).toBe(3);
  });

  it('refuse un mauvais mot de passe sans rien contourner', async () => {
    await expect(decryptPdf({ bytes: await fixture('protected.pdf'), password: 'faux' })).rejects.toMatchObject({ code: 'bad-password' });
  });

  it('déverrouille la fixture protégée', async () => {
    const unlocked = await decryptPdf({ bytes: await fixture('protected.pdf'), password: 'elfe' });
    expect(await pageCount(unlocked)).toBe(3);
  });
});
