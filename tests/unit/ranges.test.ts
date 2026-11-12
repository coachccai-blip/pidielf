import { describe, expect, it } from 'vitest';
import { chunkRanges, formatPageList, pagesForScope, parsePageList, parseRanges } from '@/core/ranges';

describe('plages de pages', () => {
  it('lit des plages simples et ouvertes', () => {
    expect(parseRanges('1-3, 5, 8-', 10)).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
      { from: 8, to: 10 },
    ]);
    expect(parseRanges('-2', 10)).toEqual([{ from: 1, to: 2 }]);
    expect(parseRanges('4–2', 10)).toEqual([{ from: 2, to: 4 }]);
  });

  it('refuse les saisies invalides', () => {
    expect(parseRanges('', 10)).toBeNull();
    expect(parseRanges('0', 10)).toBeNull();
    expect(parseRanges('11', 10)).toBeNull();
    expect(parseRanges('a-b', 10)).toBeNull();
    expect(parseRanges('1-2-3', 10)).toBeNull();
  });

  it('produit une liste sans doublon, dans l’ordre de saisie', () => {
    expect(parsePageList('3, 1-3', 5)).toEqual([3, 1, 2]);
  });

  it('écrit une liste compacte', () => {
    expect(formatPageList([5, 1, 2, 3, 9, 8])).toBe('1-3, 5, 8-9');
    expect(formatPageList([])).toBe('');
  });

  it('calcule les portées', () => {
    expect(pagesForScope('even', 5)).toEqual([2, 4]);
    expect(pagesForScope('odd', 5)).toEqual([1, 3, 5]);
    expect(pagesForScope('custom', 5, '2-3')).toEqual([2, 3]);
    expect(pagesForScope('custom', 5, 'x')).toBeNull();
  });

  it('découpe toutes les N pages', () => {
    expect(chunkRanges(7, 3)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 7 },
    ]);
  });
});
