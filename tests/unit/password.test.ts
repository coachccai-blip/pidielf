import { describe, expect, it } from 'vitest';
import { estimateStrength, generatePassword } from '@/core/password';

const score = (password: string) => estimateStrength(password).score;

describe('solidité d’un mot de passe', () => {
  it('note zéro un mot de passe vide ou trop courant', () => {
    expect(estimateStrength('')).toEqual({ score: 0, label: 'veryWeak', advice: 'short' });
    for (const common of ['password', 'motdepasse', 'azerty', 'AZERTY123', 'P@ssw0rd', 'Soleil2024!', 'iloveyou', '000000']) {
      expect(estimateStrength(common), common).toMatchObject({ score: 0, advice: 'common' });
    }
  });

  it('ne se laisse pas impressionner par les suites et les répétitions', () => {
    for (const pattern of ['123456789012', 'aaaaaaaaaaaaaaaa', 'abcdefghijklmnop', 'qsdfghjklm', 'azertyuiopqsdf']) {
      expect(estimateStrength(pattern), pattern).toMatchObject({ score: 0, advice: 'pattern' });
    }
  });

  it('plafonne les mots de passe courts, même variés', () => {
    expect(score('Zx9!')).toBe(0);
    expect(score('k7Jq9xP')).toBeLessThanOrEqual(1);
    expect(estimateStrength('k7Jq9xPw')).toMatchObject({ score: 2, label: 'fair', advice: 'short' });
  });

  it('récompense la longueur et la variété', () => {
    expect(score('clair-de-lune')).toBe(3);
    expect(score('kT9#vLq2!xZp')).toBe(3);
    expect(estimateStrength('cheval correct pile agrafe')).toEqual({ score: 4, label: 'strong' });
    expect(score('j’aime les crêpes au sucre')).toBe(4);
  });

  it('croît avec la longueur', () => {
    const base = 'vTm4-qLz8-';
    const scores = [1, 2, 3, 4].map((n) => score(base.repeat(4).slice(0, n * 5)));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(scores[0]).toBeLessThan(scores[3]);
  });

  it('conseille de varier un long mot de passe d’une seule famille', () => {
    expect(estimateStrength('mplokijnuhbygv')).toMatchObject({ advice: 'variety' });
  });
});

describe('mot de passe aléatoire', () => {
  it('tire des mots de passe solides et tous différents', () => {
    const drawn = Array.from({ length: 50 }, () => generatePassword());
    expect(new Set(drawn).size).toBe(50);
    for (const password of drawn) {
      expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(score(password)).toBe(4);
    }
    expect(generatePassword(12)).toHaveLength(12);
  });
});
