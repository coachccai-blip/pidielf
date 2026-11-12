import { PDFDocument, PDFHexString, PDFName, type PDFRef } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { organizePdf } from '@/core/pdf/organize';
import { splitPdf } from '@/core/pdf/split';
import {
  buildParts, chapterLevel, chapterParts, defaultRangesText, formatRange, hasUsableChapters, isWholeDocument, partNames, partSize, uncoveredPages,
} from '@/core/splitPlan';
import { readChapters } from '@/features/tools/diviser/outline';
import {
  HISTORY_LIMIT, blankSheet, commit, dropSheets, duplicateSheets, insertSheets, isUntouched, lastOf, redo, removeSheets, rotateSheets, rotatedSize, sendSheets,
  shiftSheets, sourceSheets, startHistory, toOrganizePlan, undo, type Sheet,
} from '@/features/tools/organiser/plan';
import { fixture, pageCount, pageSizes, rotations } from './helpers';

describe('diviser — plan de découpe', () => {
  it('transforme les débuts de chapitre en parties, triées et sans doublon', () => {
    const parts = chapterParts(
      [
        { title: 'Conclusion', page: 9 },
        { title: ' Introduction ', page: 3 },
        { title: 'Doublon', page: 3 },
        { title: 'Méthode', page: 5 },
      ],
      12,
    );
    expect(parts).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4, title: 'Introduction' },
      { from: 5, to: 8, title: 'Méthode' },
      { from: 9, to: 12, title: 'Conclusion' },
    ]);
  });

  it('ignore les chapitres hors du document et ne crée pas de partie avant la page 1', () => {
    expect(chapterParts([{ title: 'A', page: 1 }, { title: 'B', page: 0 }, { title: 'C', page: 99 }, { title: 'D', page: 2.5 }, { title: 'E', page: 4 }], 6)).toEqual([
      { from: 1, to: 3, title: 'A' },
      { from: 4, to: 6, title: 'E' },
    ]);
    expect(chapterParts([], 6)).toEqual([]);
  });

  it('ne juge un sommaire exploitable que s’il découpe vraiment le document', () => {
    expect(hasUsableChapters([{ title: 'Tout', page: 1 }], 8)).toBe(false);
    expect(hasUsableChapters([{ title: 'Suite', page: 2 }], 8)).toBe(true);
    expect(hasUsableChapters([], 8)).toBe(false);
  });

  it('descend sous une entrée racine unique pour trouver les chapitres', () => {
    interface Node { title: string; items?: Node[] }
    const chapters: Node[] = [{ title: 'Un' }, { title: 'Deux' }];
    expect(chapterLevel<Node>([{ title: 'Livre', items: chapters }])).toBe(chapters);
    const flat: Node[] = [{ title: 'Un', items: [{ title: 'Section' }] }, { title: 'Deux' }];
    expect(chapterLevel(flat)).toBe(flat);
    expect(chapterLevel([{ title: 'Seul', items: [] }])).toEqual([{ title: 'Seul', items: [] }]);
  });

  it('construit les parties de chaque mode', () => {
    expect(buildParts({ mode: 'ranges', pageCount: 12, ranges: '1-3, 5, 8-' })).toEqual([{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 8, to: 12 }]);
    expect(buildParts({ mode: 'every', pageCount: 7, every: 3 })).toEqual([{ from: 1, to: 3 }, { from: 4, to: 6 }, { from: 7, to: 7 }]);
    expect(buildParts({ mode: 'single', pageCount: 3 })).toEqual([{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 3 }]);
    expect(buildParts({ mode: 'chapters', pageCount: 6, chapters: [{ title: 'B', page: 4 }] })).toEqual([{ from: 1, to: 3 }, { from: 4, to: 6, title: 'B' }]);
  });

  it('refuse les réglages invalides', () => {
    expect(buildParts({ mode: 'ranges', pageCount: 12, ranges: '' })).toBeNull();
    expect(buildParts({ mode: 'ranges', pageCount: 12, ranges: '3-20' })).toBeNull();
    expect(buildParts({ mode: 'every', pageCount: 12, every: 0 })).toBeNull();
    expect(buildParts({ mode: 'every', pageCount: 12, every: 2.5 })).toBeNull();
    expect(buildParts({ mode: 'chapters', pageCount: 12, chapters: [] })).toBeNull();
    expect(buildParts({ mode: 'single', pageCount: 0 })).toBeNull();
  });

  it('propose deux moitiés par défaut', () => {
    expect(defaultRangesText(12)).toBe('1-6, 7-12');
    expect(defaultRangesText(3)).toBe('1-2, 3');
    expect(defaultRangesText(2)).toBe('1, 2');
    expect(defaultRangesText(1)).toBe('1');
    for (const n of [1, 2, 3, 12, 301]) expect(buildParts({ mode: 'ranges', pageCount: n, ranges: defaultRangesText(n) })).not.toBeNull();
  });

  it('décrit les parties : étendue, taille, pages laissées de côté', () => {
    expect(formatRange({ from: 4, to: 6 })).toBe('4-6');
    expect(formatRange({ from: 4, to: 4 })).toBe('4');
    expect(partSize({ from: 4, to: 6 })).toBe(3);
    expect(uncoveredPages([{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 8, to: 12 }], 12)).toEqual([4, 6, 7]);
    expect(uncoveredPages([{ from: 1, to: 12 }], 12)).toEqual([]);
    expect(isWholeDocument([{ from: 1, to: 12 }], 12)).toBe(true);
    expect(isWholeDocument([{ from: 1, to: 11 }], 12)).toBe(false);
    expect(isWholeDocument([{ from: 1, to: 6 }, { from: 7, to: 12 }], 12)).toBe(false);
  });

  it('nomme les fichiers avec un numéro de même largeur', () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({ from: i + 1, to: i + 1 }));
    const names = partNames('rapport.pdf', parts, 'partie');
    expect(names[0]).toBe('rapport_partie-01.pdf');
    expect(names[11]).toBe('rapport_partie-12.pdf');
    expect(partNames('rapport.pdf', parts.slice(0, 3), 'partie')).toEqual(['rapport_partie-1.pdf', 'rapport_partie-2.pdf', 'rapport_partie-3.pdf']);
  });

  it('peut nommer d’après les chapitres, sans caractère interdit ni doublon', () => {
    const parts = [
      { from: 1, to: 2 },
      { from: 3, to: 4, title: 'Qui ? Quoi : où/quand' },
      { from: 5, to: 6, title: 'Annexe' },
      { from: 7, to: 8, title: '...' },
    ];
    expect(partNames('thèse.pdf', parts, 'partie', true)).toEqual(['thèse_partie-1.pdf', 'thèse_2-Qui Quoi où quand.pdf', 'thèse_3-Annexe.pdf', 'thèse_partie-4.pdf']);
    // Sans l'option, les titres ne servent pas.
    expect(partNames('thèse.pdf', parts, 'partie')[2]).toBe('thèse_partie-3.pdf');
    const long = partNames('a.pdf', [{ from: 1, to: 1, title: 'x'.repeat(300) }, { from: 2, to: 2, title: 'y' }], 'partie', true);
    expect(long[0].length).toBeLessThan(80);
    const names = partNames('a.pdf', [{ from: 1, to: 1, title: 'Même' }, { from: 2, to: 2, title: 'Même' }], 'partie', true);
    expect(new Set(names).size).toBe(2);
  });
});

/** PDF de dix pages avec un sommaire : [titre, page] ; `root` ajoute une entrée racine unique. */
async function pdfWithOutline(entries: Array<[string, number]>, root?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 10; i++) doc.addPage([300, 400]);
  const ctx = doc.context;
  const outlineRef = ctx.nextRef();
  const rootRef = root ? ctx.nextRef() : undefined;
  const parent = rootRef ?? outlineRef;
  const refs: PDFRef[] = entries.map(() => ctx.nextRef());
  entries.forEach(([title, page], i) => {
    ctx.assign(
      refs[i],
      ctx.obj({
        Title: PDFHexString.fromText(title),
        Parent: parent,
        Dest: [doc.getPage(page - 1).ref, 'Fit'],
        ...(i > 0 ? { Prev: refs[i - 1] } : {}),
        ...(i < refs.length - 1 ? { Next: refs[i + 1] } : {}),
      }),
    );
  });
  if (rootRef) {
    ctx.assign(rootRef, ctx.obj({ Title: PDFHexString.fromText(root!), Parent: outlineRef, First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
    ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: rootRef, Last: rootRef, Count: 1 }));
  } else {
    ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  }
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  return doc.save();
}

async function chaptersOf(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  try {
    return await readChapters(pdf);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

describe('diviser — chapitres du sommaire', () => {
  it('lit les chapitres avec pdf.js puis découpe le document', async () => {
    const bytes = await pdfWithOutline([['Préface', 2], ['Chapitre 1', 4], ['Chapitre 2', 8]]);
    const chapters = await chaptersOf(bytes);
    expect(chapters).toEqual([{ title: 'Préface', page: 2 }, { title: 'Chapitre 1', page: 4 }, { title: 'Chapitre 2', page: 8 }]);
    const parts = buildParts({ mode: 'chapters', pageCount: 10, chapters })!;
    expect(parts.map(formatRange)).toEqual(['1', '2-3', '4-7', '8-10']);
    const files = await splitPdf({ bytes, ranges: parts });
    expect(await Promise.all(files.map(pageCount))).toEqual([1, 2, 4, 3]);
  });

  it('prend les chapitres sous une entrée racine unique', async () => {
    const chapters = await chaptersOf(await pdfWithOutline([['Un', 1], ['Deux', 6]], 'Le livre'));
    expect(chapters).toEqual([{ title: 'Un', page: 1 }, { title: 'Deux', page: 6 }]);
  });

  it('ne trouve rien dans un PDF sans sommaire', async () => {
    const chapters = await chaptersOf(await fixture('sample-12p.pdf'));
    expect(chapters).toEqual([]);
    expect(hasUsableChapters(chapters, 12)).toBe(false);
  });
});

// Le plan de pages d'« Organiser les pages » : ses opérations pures sont testées ici, avec le plan de découpe.
describe('organiser — plan de pages', () => {
  const pagesOf = (plan: Sheet[]) => plan.map((s) => (s.kind === 'page' ? s.page : 0));
  const pick = (plan: Sheet[], ...pages: number[]) => new Set(plan.filter((s) => s.kind === 'page' && pages.includes(s.page)).map((s) => s.id));

  it('part du document d’origine, intact', () => {
    const plan = sourceSheets(0, 4);
    expect(pagesOf(plan)).toEqual([1, 2, 3, 4]);
    expect(new Set(plan.map((s) => s.id)).size).toBe(4);
    expect(isUntouched(plan, 4)).toBe(true);
    expect(isUntouched(plan.slice(0, 3), 4)).toBe(false);
    expect(isUntouched(rotateSheets(plan, pick(plan, 2), 90), 4)).toBe(false);
    expect(isUntouched(sourceSheets(1, 4), 4)).toBe(false);
  });

  it('supprime et duplique', () => {
    const plan = sourceSheets(0, 4);
    expect(pagesOf(removeSheets(plan, pick(plan, 2, 4)))).toEqual([1, 3]);
    const doubled = duplicateSheets(plan, pick(plan, 1, 3));
    expect(pagesOf(doubled)).toEqual([1, 1, 2, 3, 3, 4]);
    expect(new Set(doubled.map((s) => s.id)).size).toBe(6);
  });

  it('pivote par quarts de tour, pages blanches comprises', () => {
    const plan = [...sourceSheets(0, 2), blankSheet({ width: 300, height: 400 })];
    const ids = new Set(plan.map((s) => s.id));
    const left = rotateSheets(plan, ids, -90);
    expect(left.map((s) => (s.kind === 'page' ? s.rotate : [s.width, s.height]))).toEqual([270, 270, [400, 300]]);
    const back = rotateSheets(left, ids, 90);
    expect(back.map((s) => (s.kind === 'page' ? s.rotate : [s.width, s.height]))).toEqual([0, 0, [300, 400]]);
    expect(rotatedSize({ width: 595, height: 842 }, 270)).toEqual({ width: 842, height: 595 });
    expect(rotatedSize({ width: 595, height: 842 }, 180)).toEqual({ width: 595, height: 842 });
  });

  it('déplace d’un cran sans défaire l’ordre de la sélection', () => {
    const plan = sourceSheets(0, 5);
    expect(pagesOf(shiftSheets(plan, pick(plan, 2, 3), -1))).toEqual([2, 3, 1, 4, 5]);
    expect(pagesOf(shiftSheets(plan, pick(plan, 2, 4), 1))).toEqual([1, 3, 2, 5, 4]);
    expect(pagesOf(shiftSheets(plan, pick(plan, 4, 5), 1))).toEqual([1, 2, 3, 4, 5]);
    expect(pagesOf(sendSheets(plan, pick(plan, 3, 5), 'start'))).toEqual([3, 5, 1, 2, 4]);
    expect(pagesOf(sendSheets(plan, pick(plan, 1, 2), 'end'))).toEqual([3, 4, 5, 1, 2]);
  });

  it('dépose une page, ou toute la sélection dont elle fait partie', () => {
    const plan = sourceSheets(0, 5);
    const id = (page: number) => plan[page - 1].id;
    const none = new Set<string>();
    expect(pagesOf(dropSheets(plan, none, id(1), id(3)))).toEqual([2, 3, 1, 4, 5]);
    expect(pagesOf(dropSheets(plan, none, id(4), id(2)))).toEqual([1, 4, 2, 3, 5]);
    expect(pagesOf(dropSheets(plan, pick(plan, 1, 3), id(1), id(4)))).toEqual([2, 4, 1, 3, 5]);
    expect(pagesOf(dropSheets(plan, pick(plan, 2, 5), id(5), id(1)))).toEqual([2, 5, 1, 3, 4]);
    // La page glissée n'est pas sélectionnée : la sélection ne bouge pas.
    expect(pagesOf(dropSheets(plan, pick(plan, 2, 3), id(5), id(1)))).toEqual([5, 1, 2, 3, 4]);
  });

  it('insère après une page, ou à la fin', () => {
    const plan = sourceSheets(0, 3);
    const blank = blankSheet({ width: 595, height: 842 });
    expect(insertSheets(plan, plan[0].id, [blank]).map((s) => s.kind)).toEqual(['page', 'blank', 'page', 'page']);
    expect(insertSheets(plan, null, [blank]).map((s) => s.kind)).toEqual(['page', 'page', 'page', 'blank']);
    expect(lastOf(plan, pick(plan, 1, 2))).toBe(plan[1].id);
    expect(lastOf(plan, new Set())).toBeNull();
  });

  it('ne change pas de liste quand une opération ne fait rien', () => {
    const plan = sourceSheets(0, 3);
    const none = new Set<string>();
    expect(removeSheets(plan, none)).toBe(plan);
    expect(duplicateSheets(plan, none)).toBe(plan);
    expect(rotateSheets(plan, none, 90)).toBe(plan);
    expect(shiftSheets(plan, pick(plan, 1), -1)).toBe(plan);
    expect(sendSheets(plan, pick(plan, 1), 'start')).toBe(plan);
    expect(dropSheets(plan, none, plan[0].id, plan[0].id)).toBe(plan);
    expect(insertSheets(plan, null, [])).toBe(plan);
  });

  it('annule et rétablit, avec un historique borné', () => {
    let history = startHistory('a');
    history = commit(history, 'b');
    history = commit(history, 'c');
    expect(commit(history, 'c')).toBe(history);
    history = undo(history);
    expect(history.present).toBe('b');
    history = undo(undo(history));
    expect(history.present).toBe('a');
    history = redo(history);
    expect(history.present).toBe('b');
    // Une nouvelle action efface ce qui pouvait être rétabli.
    history = commit(history, 'd');
    expect(redo(history)).toBe(history);
    expect(history.past).toEqual(['a', 'b']);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) history = commit(history, `e${i}`);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });

  it('produit le PDF correspondant au plan, en ne transmettant que les fichiers utilisés', async () => {
    // Source 1 insérée puis retirée, source 2 utilisée : elle devient la source 1 du traitement.
    let plan = sourceSheets(0, 3);
    plan = insertSheets(plan, plan[0].id, sourceSheets(1, 3));
    plan = removeSheets(plan, new Set(plan.filter((s) => s.kind === 'page' && s.source === 1).map((s) => s.id)));
    plan = insertSheets(plan, null, sourceSheets(2, 12).slice(1, 2));
    plan = rotateSheets(plan, new Set([plan[1].id]), 90);
    plan = insertSheets(plan, plan[0].id, [blankSheet({ width: 300, height: 400 })]);
    plan = dropSheets(plan, new Set(), plan[3].id, plan[0].id);

    const { used, items } = toOrganizePlan(plan);
    expect(used).toEqual([0, 2]);
    expect(items).toEqual([
      { kind: 'page', source: 0, page: 3 },
      { kind: 'page', source: 0, page: 1 },
      { kind: 'blank', width: 300, height: 400 },
      { kind: 'page', source: 0, page: 2, rotate: 90 },
      { kind: 'page', source: 1, page: 2 },
    ]);
    const files = [await fixture('sample-3p.pdf'), await fixture('rotated.pdf'), await fixture('sample-12p.pdf')];
    const out = await organizePdf({ sources: used.map((i) => files[i]), plan: items });
    expect(await pageSizes(out)).toEqual([[595, 842], [595, 842], [300, 400], [595, 842], [842, 595]]);
    expect(await rotations(out)).toEqual([0, 0, 0, 90, 0]);
  });
});
