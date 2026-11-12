// Jeu de caractères des polices PDF standard. Module sans dépendance, utilisable
// aussi bien par l'interface (aperçus) que par les traitements.

// Les polices standard de pdf-lib n'encodent que le jeu WinAnsi (latin occidental).
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** Remplace les caractères que les polices standard ne savent pas écrire. */
export function toWinAnsi(text: string, replacement = '?'): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (ch === '\n' || ch === '\t') out += ch === '\t' ? '    ' : '\n';
    else if (code === 0x202f || code === 0x2009 || code === 0x00a0) out += ' ';
    else out += replacement;
  }
  return out;
}
