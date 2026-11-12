import { describe, expect, it } from 'vitest';
import { buildPageText, countWords, fold, rectsForRange, reflowPage, searchPage, type TextRun } from '@/core/text';

const run = (str: string, x: number, y: number, w: number, h = 0.02, eol = false): TextRun => ({ str, x, y, w, h, eol });

describe('recherche dans le texte', () => {
  const page = buildPageText([
    run('La bibliothèque des ', 0.1, 0.1, 0.4),
    run('elfes veille.', 0.5, 0.1, 0.26, 0.02, true),
    run('Chaque feuille garde une page ; ', 0.1, 0.14, 0.6),
    run('la BIBLIOTHEQUE dort.', 0.1, 0.18, 0.42, 0.02, true),
  ]);

  it('ignore la casse et les accents', () => {
    expect(fold('Été ŒUVRE Ça')).toBe('ete œuvre ca');
    const hits = searchPage(page, 3, 'bibliotheque');
    expect(hits).toHaveLength(2);
    expect(hits[0].page).toBe(3);
    expect(hits[0].match).toBe('bibliothèque');
    expect(hits[1].match).toBe('BIBLIOTHEQUE');
  });

  it('fournit un extrait autour de l’occurrence', () => {
    const [hit] = searchPage(page, 1, 'feuille');
    expect(hit.before.endsWith('Chaque ')).toBe(true);
    expect(hit.after.startsWith(' garde')).toBe(true);
  });

  it('place les rectangles au bon endroit', () => {
    const [hit] = searchPage(page, 1, 'bibliothèque');
    expect(hit.rects).toHaveLength(1);
    const r = hit.rects[0];
    // « bibliothèque » : caractères 3 à 15 d'un fragment de 20 caractères large de 0,4.
    expect(r.x).toBeCloseTo(0.1 + (0.4 * 3) / 20, 5);
    expect(r.w).toBeCloseTo((0.4 * 12) / 20, 5);
  });

  it('réunit une occurrence à cheval sur deux fragments de la même ligne', () => {
    const rects = rectsForRange(page, 16, 25); // « des elfes »
    expect(rects).toHaveLength(1);
    expect(rects[0].x + rects[0].w).toBeGreaterThan(0.5);
  });

  it('ne renvoie rien pour une recherche vide', () => {
    expect(searchPage(page, 1, '   ')).toEqual([]);
  });
});

describe('recomposition du texte', () => {
  it('reconstitue titres et paragraphes, et recolle les mots coupés', () => {
    const blocks = reflowPage([
      run('Chapitre premier', 0.1, 0.08, 0.5, 0.04, true),
      run('Sous les frondaisons, la biblio-', 0.1, 0.16, 0.8, 0.02, true),
      run('thèque des elfes veille sur les', 0.1, 0.19, 0.8, 0.02, true),
      run('pages anciennes.', 0.1, 0.22, 0.4, 0.02, true),
      run('Un nouveau paragraphe commence', 0.1, 0.29, 0.8, 0.02, true),
      run('ici et se poursuit.', 0.1, 0.32, 0.45, 0.02, true),
      run('12', 0.5, 0.95, 0.02, 0.02, true),
    ]);
    expect(blocks).toMatchObject([
      { kind: 'heading', level: 2, text: 'Chapitre premier' },
      { kind: 'para', text: 'Sous les frondaisons, la bibliothèque des elfes veille sur les pages anciennes.' },
      { kind: 'para', text: 'Un nouveau paragraphe commence ici et se poursuit.' },
    ]);
  });

  it('assemble les fragments d’une même ligne avec les espaces voulus', () => {
    const blocks = reflowPage([run('Bonjour', 0.1, 0.1, 0.1), run('le monde.', 0.22, 0.1, 0.14, 0.02, true)]);
    expect(blocks).toMatchObject([{ kind: 'para', text: 'Bonjour le monde.' }]);
    expect(blocks[0].y).toBeCloseTo(0.1);
  });

  it('renvoie une liste vide pour une page sans texte', () => {
    expect(reflowPage([])).toEqual([]);
  });

  it('compte les mots', () => {
    expect(countWords("L'elfe lit vingt-deux pages aujourd’hui.")).toBe(5);
  });
});
