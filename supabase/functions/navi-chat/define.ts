// supabase/functions/navi-chat/define.ts
//
// NAVI v22 — Vocabulary Engine.
//
// Real dictionary answers instead of encyclopaedia snippets: "define eloquent",
// "what does serendipity mean", "synonyms for happy", "antonym of brave",
// "use resilient in a sentence". Powered by the free dictionary API
// (api.dictionaryapi.dev — keyless, like the DDG/Wikipedia layers), with a 6h
// in-memory cache so repeat words are instant. Single words only — phrases
// fall through to the normal knowledge/web pipeline, which handles them better.

export type DefineKind = 'define' | 'synonyms' | 'antonyms' | 'sentence';
export interface DefineAsk { word: string; kind: DefineKind }

const WORD = "([a-z][a-z'-]{1,30})";
const PRE = String.raw`^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?`;

const ASK_PATTERNS: Array<[RegExp, DefineKind]> = [
  [new RegExp(PRE + String.raw`define\s+(?:the\s+word\s+)?"?${WORD}"?$`, 'i'), 'define'],
  [new RegExp(PRE + String.raw`(?:what\s+is\s+the\s+)?definition\s+of\s+(?:the\s+word\s+)?"?${WORD}"?$`, 'i'), 'define'],
  [new RegExp(PRE + String.raw`what\s+does\s+(?:the\s+word\s+)?"?${WORD}"?\s+mean$`, 'i'), 'define'],
  [new RegExp(PRE + String.raw`(?:what\s+is\s+the\s+)?meaning\s+of\s+(?:the\s+word\s+)?"?${WORD}"?$`, 'i'), 'define'],
  [new RegExp(PRE + String.raw`(?:give\s+me\s+)?synonyms?\s+(?:for|of)\s+"?${WORD}"?$`, 'i'), 'synonyms'],
  [new RegExp(PRE + String.raw`(?:what\s+is\s+)?another\s+word\s+for\s+"?${WORD}"?$`, 'i'), 'synonyms'],
  [new RegExp(PRE + String.raw`(?:give\s+me\s+)?antonyms?\s+(?:for|of)\s+"?${WORD}"?$`, 'i'), 'antonyms'],
  [new RegExp(PRE + String.raw`(?:what\s+is\s+the\s+)?opposite\s+of\s+"?${WORD}"?$`, 'i'), 'antonyms'],
  [new RegExp(PRE + String.raw`use\s+(?:the\s+word\s+)?"?${WORD}"?\s+in\s+a\s+sentence$`, 'i'), 'sentence'],
];

// Words the retrieval brain / memory layers own — a dictionary answer for
// "what does navi mean" would shadow the identity nodes.
const RESERVED = new Set(['navi', 'navisociety', 'dian', 'prophet', 'it', 'that', 'this', 'he', 'she', 'they', 'you', 'me', 'life', 'love']);

/** Parse a vocabulary ask out of the message, or null when it isn't one. */
export function parseDefineAsk(message: string): DefineAsk | null {
  const m = message.trim().replace(/[?!.]+\s*$/, '');
  for (const [rx, kind] of ASK_PATTERNS) {
    const hit = m.match(rx);
    if (hit) {
      const word = hit[1].toLowerCase();
      if (RESERVED.has(word)) return null;
      return { word, kind };
    }
  }
  return null;
}

// ── Dictionary API shapes (only the fields NAVI reads) ───────────────────────

interface DictDefinition { definition: string; example?: string; synonyms?: string[]; antonyms?: string[] }
interface DictMeaning { partOfSpeech: string; definitions: DictDefinition[]; synonyms?: string[]; antonyms?: string[] }
export interface DictEntry { word: string; meanings: DictMeaning[] }

function uniqueWords(lists: Array<string[] | undefined>, exclude: string, max: number): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const w of list ?? []) {
      const t = w.toLowerCase().trim();
      if (t && t !== exclude && !out.includes(t)) out.push(t);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function gatherLists(entry: DictEntry, key: 'synonyms' | 'antonyms'): Array<string[] | undefined> {
  const lists: Array<string[] | undefined> = [];
  for (const m of entry.meanings) {
    lists.push(m[key]);
    for (const d of m.definitions) lists.push(d[key]);
  }
  return lists;
}

/** Render a dictionary entry for the asked shape. Returns '' when the entry can't serve it. */
export function formatDictionary(ask: DefineAsk, entry: DictEntry): string {
  const meanings = entry.meanings?.filter(m => m.definitions?.length) ?? [];
  if (!meanings.length) return '';

  if (ask.kind === 'synonyms' || ask.kind === 'antonyms') {
    const words = uniqueWords(gatherLists(entry, ask.kind), ask.word, 6);
    if (!words.length) return '';
    const label = ask.kind === 'synonyms' ? 'Words close to' : 'Opposites of';
    return `${label} "${ask.word}": ${words.join(', ')}.`;
  }

  if (ask.kind === 'sentence') {
    for (const m of meanings) {
      const withExample = m.definitions.find(d => d.example);
      if (withExample?.example) {
        return `Here's "${ask.word}" in a sentence: "${withExample.example}"`;
      }
    }
    // No example in the entry — fall back to a definition-shaped answer.
    const d = meanings[0].definitions[0];
    return `I don't have a ready-made sentence, but "${ask.word}" (${meanings[0].partOfSpeech}) means: ${d.definition}`;
  }

  // define — lead meaning, plus a second part of speech when there is one.
  const lines: string[] = [];
  for (const m of meanings.slice(0, 2)) {
    const d = m.definitions[0];
    const example = d.example ? ` Example: "${d.example}"` : '';
    lines.push(`(${m.partOfSpeech}) ${d.definition}${example}`);
  }
  const syns = uniqueWords(gatherLists(entry, 'synonyms'), ask.word, 4);
  const tail = syns.length ? `\n\nClose words: ${syns.join(', ')}.` : '';
  return `${ask.word} — ${lines.join('\n')}${tail}`;
}

// ── Live lookup (cached) ──────────────────────────────────────────────────────

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; entry: DictEntry | null }>();

async function lookupWord(word: string): Promise<DictEntry | null> {
  const hit = cache.get(word);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.entry;
  let entry: DictEntry | null = null;
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.meanings) entry = data[0] as DictEntry;
    }
  } catch {
    // Network miss — cache the null so a flapping API isn't hammered.
  }
  cache.set(word, { at: Date.now(), entry });
  return entry;
}

/**
 * Vocabulary pipeline: detect the ask, hit the dictionary, format the reply.
 * Returns '' when the message isn't a vocabulary ask or the word is unknown —
 * the normal knowledge/web pipeline then takes over.
 */
export async function tryDefine(message: string): Promise<string> {
  const ask = parseDefineAsk(message);
  if (!ask) return '';
  const entry = await lookupWord(ask.word);
  if (!entry) return '';
  return formatDictionary(ask, entry);
}
