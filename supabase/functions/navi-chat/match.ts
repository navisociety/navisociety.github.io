// supabase/functions/navi-chat/match.ts
//
// NAVI fuzzy word matching (v15): light suffix stemming + bounded edit
// distance so typos ("depresed") and word forms ("running" vs "run") still
// hit the right knowledge node. Crisis-tier nodes never use fuzzy matching —
// they require exact phrases (the v13 rule).

/** Light suffix stripper: running→run, loved→lov(ed), habits→habit, calmly→calm. */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 5 && s.endsWith('ly')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  // collapse doubled final consonant left by -ing/-ed: runn→run, stopp→stop
  if (s.length > 3 && s[s.length - 1] === s[s.length - 2] && !/[aeiou]/.test(s[s.length - 1])) {
    s = s.slice(0, -1);
  }
  return s;
}

/** True when a and b are within one edit (substitution, transposition, insert, delete). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return true;
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // transposition
  }
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1); // one insert/delete
}

/**
 * Does a message word count as a match for a trigger word?
 * Exact always matches. With fuzzy enabled: equal stems, or one typo on
 * words of 5+ letters. Short words stay exact — too many false neighbours.
 */
export function wordsMatch(msgWord: string, trigWord: string, fuzzy: boolean): boolean {
  if (msgWord === trigWord) return true;
  if (!fuzzy) return false;
  if (stem(msgWord) === stem(trigWord)) return true;
  // Typos rarely land on the first letter — requiring it to match kills the
  // worst false neighbours (tower/power, might/night) while keeping real typos.
  if (msgWord.length >= 5 && trigWord.length >= 5 && msgWord[0] === trigWord[0]) {
    return withinOneEdit(msgWord, trigWord);
  }
  return false;
}
