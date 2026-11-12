// Mots de passe : estimation de solidité (sans dictionnaire externe) et tirage
// aléatoire. Rien n'est enregistré ni transmis.

export type StrengthLabel = 'veryWeak' | 'weak' | 'fair' | 'good' | 'strong';
/** Ce qui affaiblit le plus le mot de passe, pour guider la correction. */
export type StrengthAdvice = 'common' | 'short' | 'pattern' | 'variety';

export interface PasswordStrength {
  /** 0 (très faible) à 4 (solide). */
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
  advice?: StrengthAdvice;
}

const LABELS: StrengthLabel[] = ['veryWeak', 'weak', 'fair', 'good', 'strong'];

// Les plus courants en France et dans le monde anglophone, sans leurs variantes chiffrées.
const COMMON = new Set(
  (
    'password passw0rd motdepasse mdp azerty azertyuiop qwerty qwertyuiop qwertz admin administrateur root user login ' +
    'welcome bienvenue bonjour salut hello coucou soleil doudou loulou chouchou chocolat nicolas camille marseille ' +
    'iloveyou jetaime amour love secret letmein dragon monkey master shadow sunshine princess princesse football ' +
    'superman batman pokemon naruto azertyqsdf abc abcd abcdef test demo pdf pidielf elfe changeme default guest invite ' +
    'paris france juillet janvier lundi summer winter monday'
  ).split(' '),
);

const ROWS = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'azertyuiop', 'qsdfghjklm', 'wxcvbn', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/** Vrai si a puis b se suivent sur une rangée de clavier ou dans l'alphabet, dans un sens ou dans l'autre. */
function adjacent(a: string, b: string): boolean {
  return ROWS.some((row) => {
    const i = row.indexOf(a);
    return i !== -1 && (row[i + 1] === b || (i > 0 && row[i - 1] === b));
  });
}

/** Mot nu : minuscules, sans accents, écriture « l33t » défaite, chiffres et ponctuation des bords retirés. */
function bareWord(password: string): string {
  return password
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^a-z]+|[^a-z0-9@$]+$/g, '')
    .replace(/[0-9@$!]+$/, '')
    .replace(/0/g, 'o')
    .replace(/[1!]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's');
}

/**
 * Estime la solidité d'un mot de passe : longueur utile (répétitions, suites
 * et années comptent peu), variété des caractères, mots de passe trop courants.
 * C'est une estimation prudente, pas une garantie.
 */
export function estimateStrength(password: string): PasswordStrength {
  const chars = [...password];
  const result = (score: number, advice?: StrengthAdvice): PasswordStrength => {
    const s = Math.max(0, Math.min(4, score)) as PasswordStrength['score'];
    return { score: s, label: LABELS[s], ...(advice && s < 4 ? { advice } : {}) };
  };
  if (chars.length === 0) return result(0, 'short');

  const lower = password.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(bareWord(password)) || /^(\d)\1*$/.test(password)) return result(0, 'common');

  // Longueur utile : un caractère répété ou pris dans une suite (abc, 321, azerty) n'apporte presque rien.
  const low = chars.map((c) => c.toLowerCase());
  const linked = low.map((c, i) => i > 0 && (c === low[i - 1] || adjacent(low[i - 1], c)));
  let useful = 0;
  let patterned = 0;
  low.forEach((c, i) => {
    const weak = linked[i] && (c === low[i - 1] || linked[i - 1] || linked[i + 1] === true);
    useful += weak ? 0.25 : 1;
    if (weak) patterned++;
  });
  // Une année (1950 à 2039) se devine en quelques essais.
  const years = password.match(/19[5-9]\d|20[0-3]\d/g)?.length ?? 0;
  useful = Math.max(1, useful - 2.5 * years);
  patterned += 3 * years;

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[ -/:-@[-`{-~]/.test(password)) pool += 33;
  if (/[^\x00-\x7f]/.test(password)) pool += 30;
  const bits = useful * Math.log2(Math.max(pool, 10));

  let score = bits < 28 ? 0 : bits < 42 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  // Un mot de passe court reste fragile, quelle que soit sa composition.
  const cap = chars.length < 6 ? 0 : chars.length < 8 ? 1 : chars.length < 10 ? 2 : chars.length < 12 ? 3 : 4;
  score = Math.min(score, cap);

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  const advice: StrengthAdvice = patterned >= chars.length / 2 ? 'pattern' : chars.length < 12 || classes > 1 ? 'short' : 'variety';
  return result(score, advice);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Mot de passe aléatoire (6 bits par caractère, tirés du générateur cryptographique du système). */
export function generatePassword(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b & 63]).join('');
}
