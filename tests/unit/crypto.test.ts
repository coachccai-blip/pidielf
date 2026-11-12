import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { decryptPdf, encryptPdf, inspectEncryption, unlockPdf } from '@/core/pdf/crypto';
import { qpdfEncrypt } from '@/core/qpdf';
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

  it('applique les restrictions demandées', async () => {
    const original = await fixture('sample-3p.pdf');
    const locked = await encryptPdf({
      bytes: original,
      userPassword: 'clair-de-lune',
      ownerPassword: 'proprio',
      permissions: { print: true, copy: false, modify: false },
    });
    // Avec le mot de passe d'ouverture, les restrictions s'appliquent.
    const asUser = await inspectEncryption({ bytes: locked, password: 'clair-de-lune' });
    expect(asUser).toMatchObject({
      encrypted: true,
      needsPassword: false,
      passwordRole: 'user',
      permissions: { print: true, copy: false, modify: false },
      restricted: true,
      method: 'AESv3',
      pageCount: 3,
    });
    expect((await inspectEncryption({ bytes: locked, password: 'proprio' })).passwordRole).toBe('owner');
    // /P : bit 3 (impression) posé, bits 4 (modification) et 5 (copie) retirés.
    const p = Number(/\/P (-?\d+)/.exec(latin1(locked))![1]);
    expect([p & 4, p & 8, p & 16]).toEqual([4, 0, 0]);

    const open = await encryptPdf({ bytes: original, userPassword: 'a', ownerPassword: 'b', permissions: { print: true, copy: true, modify: true } });
    expect(await inspectEncryption({ bytes: open, password: 'a' })).toMatchObject({ restricted: false, permissions: { print: true, copy: true, modify: true } });
  });

  it('accepte un mot de passe qui ressemble à une option', async () => {
    const locked = await encryptPdf({
      bytes: await fixture('sample-3p.pdf'),
      userPassword: '--print=none é "x"',
      ownerPassword: '--decrypt',
      permissions: { print: true, copy: true, modify: true },
    });
    expect(await pageCount(await decryptPdf({ bytes: locked, password: '--print=none é "x"' }))).toBe(3);
  });

  it('ne rechiffre pas un fichier déjà protégé', async () => {
    const options = { userPassword: 'nouveau', ownerPassword: 'autre', permissions: { print: true, copy: true, modify: true } };
    await expect(encryptPdf({ bytes: await fixture('protected.pdf'), ...options })).rejects.toMatchObject({ code: 'encrypted' });
    await expect(encryptPdf({ bytes: await restrictedOnly(), ...options })).rejects.toMatchObject({ code: 'encrypted' });
  });
});

/** Fichier qui s'ouvre sans mot de passe, mais dont l'impression, la copie et la modification sont interdites. */
const restrictedOnly = async () =>
  qpdfEncrypt(await fixture('sample-3p.pdf'), { userPassword: '', ownerPassword: 'maître', permissions: { print: false, copy: false, modify: false } });

describe('inspecter la protection', () => {
  it('reconnaît un fichier non protégé', async () => {
    expect(await inspectEncryption({ bytes: await fixture('sample-3p.pdf') })).toEqual({ encrypted: false, needsPassword: false, pageCount: 3 });
  });

  it('signale qu’un mot de passe est nécessaire, puis son rôle', async () => {
    const bytes = await fixture('protected.pdf');
    expect(await inspectEncryption({ bytes })).toEqual({ encrypted: true, needsPassword: true });
    expect(await inspectEncryption({ bytes, password: 'elfe' })).toMatchObject({ needsPassword: false, passwordRole: 'user', pageCount: 3 });
    expect(await inspectEncryption({ bytes, password: 'proprietaire' })).toMatchObject({ needsPassword: false, passwordRole: 'owner' });
    await expect(inspectEncryption({ bytes, password: 'faux' })).rejects.toMatchObject({ code: 'bad-password' });
  });

  it('décrit un fichier protégé seulement par des restrictions', async () => {
    const info = await inspectEncryption({ bytes: await restrictedOnly() });
    expect(info).toMatchObject({ encrypted: true, needsPassword: false, passwordRole: 'user', restricted: true, permissions: { print: false, copy: false, modify: false } });
  });

  it('ne laisse jamais sortir le mot de passe d’ouverture', async () => {
    // qpdf l'écrit en clair quand on lui donne le mot de passe propriétaire.
    const info = await inspectEncryption({ bytes: await fixture('protected.pdf'), password: 'proprietaire' });
    expect(JSON.stringify(info)).not.toContain('elfe');
  });

  it('signale un fichier abîmé', async () => {
    await expect(inspectEncryption({ bytes: new TextEncoder().encode('ceci n’est pas un PDF') })).rejects.toMatchObject({ code: 'damaged' });
  });
});

describe('déverrouiller avec un mot de passe connu', () => {
  it('retire le mot de passe d’ouverture', async () => {
    const result = await unlockPdf({ bytes: await fixture('protected.pdf'), password: 'elfe' });
    expect(result).toMatchObject({ status: 'unlocked', pageCount: 3 });
    if (result.status !== 'unlocked') return;
    expect(latin1(result.bytes)).not.toContain('/Encrypt');
    expect(await pageCount(result.bytes)).toBe(3);
    expect(await inspectEncryption({ bytes: result.bytes })).toMatchObject({ encrypted: false });
  });

  it('accepte aussi le mot de passe propriétaire', async () => {
    expect(await unlockPdf({ bytes: await fixture('protected.pdf'), password: 'proprietaire' })).toMatchObject({ status: 'unlocked' });
  });

  it('refuse un mauvais mot de passe, ou son absence', async () => {
    const bytes = await fixture('protected.pdf');
    expect(await unlockPdf({ bytes, password: 'faux' })).toEqual({ status: 'bad-password' });
    expect(await unlockPdf({ bytes, password: '' })).toEqual({ status: 'bad-password' });
  });

  it('exige le mot de passe propriétaire pour lever de simples restrictions', async () => {
    const bytes = await restrictedOnly();
    // Le fichier s'ouvre sans mot de passe : sans celui du propriétaire, on ne touche à rien.
    expect(await unlockPdf({ bytes, password: '' })).toEqual({ status: 'owner-required' });
    expect(await unlockPdf({ bytes, password: 'au hasard' })).toEqual({ status: 'bad-password' });

    const result = await unlockPdf({ bytes, password: 'maître' });
    expect(result.status).toBe('unlocked');
    if (result.status !== 'unlocked') return;
    expect(await inspectEncryption({ bytes: result.bytes })).toMatchObject({ encrypted: false, pageCount: 3 });
  });

  it('laisse de côté un fichier qui n’est pas protégé', async () => {
    expect(await unlockPdf({ bytes: await fixture('sample-3p.pdf'), password: 'peu importe' })).toEqual({ status: 'not-encrypted' });
  });
});
