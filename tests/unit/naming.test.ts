import { describe, expect, it } from 'vitest';
import { sanitizeFileName, suggestName, uniqueNames, withExt } from '@/core/naming';

describe('noms de fichiers', () => {
  it('propose nom-d-origine_outil.pdf', () => {
    expect(suggestName('contrat.pdf', 'signe')).toBe('contrat_signe.pdf');
    expect(suggestName('Été 2026.final.PDF', 'fusion')).toBe('Été 2026.final_fusion.pdf');
    expect(suggestName('scan.pdf', 'page-1', 'png')).toBe('scan_page-1.png');
  });

  it('retire les caractères interdits', () => {
    expect(sanitizeFileName('a/b:c*d?.pdf')).toBe('a b c d .pdf');
    expect(sanitizeFileName('   ')).toBe('document');
  });

  it('rend les noms uniques', () => {
    expect(uniqueNames(['a.pdf', 'A.pdf', 'b.pdf', 'a.pdf'])).toEqual(['a.pdf', 'A (2).pdf', 'b.pdf', 'a (3).pdf']);
  });

  it('change l’extension', () => {
    expect(withExt('doc.pdf', 'txt')).toBe('doc.txt');
  });
});
