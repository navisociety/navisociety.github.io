// supabase/functions/navi-chat/bible.ts
//
// NAVI Bible knowledge — complete KJV (public domain), 31,102 verses in 66
// books, stored in the navi_bible_verses table (loaded 2026-07-02).
// Two entry points, both used by index.ts before the transformer runs:
//   1. Verse references — "John 3:16", "1 John 1:9", "Psalm 23", ranges.
//   2. Topic asks — "give me a verse about hope", "what does the bible say
//      about fear" → navi_bible_search RPC (full-text, two-pass).
// Like the DuckDuckGo fallback, this is server-side only: the client-side
// navi-model.ts has no database access.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export interface BibleVerse { book: string; chapter: number; verse: number; text: string }
export interface BibleRef { bookNum: number; book: string; chapter: number; verseStart?: number; verseEnd?: number }

// 66 books; aliases are lowercase, matched longest-first. Numbered books get
// "1 x" / "1x" / "i x" / "first x" spellings.
const BOOKS: Array<{ n: number; name: string; aliases: string[] }> = [
  { n: 1, name: 'Genesis', aliases: ['genesis', 'gen'] },
  { n: 2, name: 'Exodus', aliases: ['exodus', 'exod'] },
  { n: 3, name: 'Leviticus', aliases: ['leviticus', 'lev'] },
  { n: 4, name: 'Numbers', aliases: ['numbers', 'num'] },
  { n: 5, name: 'Deuteronomy', aliases: ['deuteronomy', 'deut'] },
  { n: 6, name: 'Joshua', aliases: ['joshua', 'josh'] },
  { n: 7, name: 'Judges', aliases: ['judges', 'judg'] },
  { n: 8, name: 'Ruth', aliases: ['ruth'] },
  { n: 9, name: '1 Samuel', aliases: ['1 samuel', '1samuel', 'i samuel', 'first samuel', '1 sam', '1sam'] },
  { n: 10, name: '2 Samuel', aliases: ['2 samuel', '2samuel', 'ii samuel', 'second samuel', '2 sam', '2sam'] },
  { n: 11, name: '1 Kings', aliases: ['1 kings', '1kings', 'i kings', 'first kings', '1 kgs'] },
  { n: 12, name: '2 Kings', aliases: ['2 kings', '2kings', 'ii kings', 'second kings', '2 kgs'] },
  { n: 13, name: '1 Chronicles', aliases: ['1 chronicles', '1chronicles', 'i chronicles', 'first chronicles', '1 chron', '1 chr'] },
  { n: 14, name: '2 Chronicles', aliases: ['2 chronicles', '2chronicles', 'ii chronicles', 'second chronicles', '2 chron', '2 chr'] },
  { n: 15, name: 'Ezra', aliases: ['ezra'] },
  { n: 16, name: 'Nehemiah', aliases: ['nehemiah', 'neh'] },
  { n: 17, name: 'Esther', aliases: ['esther', 'esth'] },
  { n: 18, name: 'Job', aliases: ['job'] },
  { n: 19, name: 'Psalms', aliases: ['psalms', 'psalm', 'psa'] },
  { n: 20, name: 'Proverbs', aliases: ['proverbs', 'proverb', 'prov'] },
  { n: 21, name: 'Ecclesiastes', aliases: ['ecclesiastes', 'eccl', 'ecc'] },
  { n: 22, name: 'Song of Solomon', aliases: ['song of solomon', 'song of songs', 'songs'] },
  { n: 23, name: 'Isaiah', aliases: ['isaiah', 'isa'] },
  { n: 24, name: 'Jeremiah', aliases: ['jeremiah', 'jer'] },
  { n: 25, name: 'Lamentations', aliases: ['lamentations', 'lam'] },
  { n: 26, name: 'Ezekiel', aliases: ['ezekiel', 'ezek'] },
  { n: 27, name: 'Daniel', aliases: ['daniel', 'dan'] },
  { n: 28, name: 'Hosea', aliases: ['hosea', 'hos'] },
  { n: 29, name: 'Joel', aliases: ['joel'] },
  { n: 30, name: 'Amos', aliases: ['amos'] },
  { n: 31, name: 'Obadiah', aliases: ['obadiah', 'obad'] },
  { n: 32, name: 'Jonah', aliases: ['jonah'] },
  { n: 33, name: 'Micah', aliases: ['micah', 'mic'] },
  { n: 34, name: 'Nahum', aliases: ['nahum', 'nah'] },
  { n: 35, name: 'Habakkuk', aliases: ['habakkuk', 'hab'] },
  { n: 36, name: 'Zephaniah', aliases: ['zephaniah', 'zeph'] },
  { n: 37, name: 'Haggai', aliases: ['haggai', 'hag'] },
  { n: 38, name: 'Zechariah', aliases: ['zechariah', 'zech'] },
  { n: 39, name: 'Malachi', aliases: ['malachi', 'mal'] },
  { n: 40, name: 'Matthew', aliases: ['matthew', 'matt', 'mat'] },
  { n: 41, name: 'Mark', aliases: ['mark'] },
  { n: 42, name: 'Luke', aliases: ['luke'] },
  { n: 43, name: 'John', aliases: ['john', 'jn'] },
  { n: 44, name: 'Acts', aliases: ['acts'] },
  { n: 45, name: 'Romans', aliases: ['romans', 'rom'] },
  { n: 46, name: '1 Corinthians', aliases: ['1 corinthians', '1corinthians', 'i corinthians', 'first corinthians', '1 cor', '1cor'] },
  { n: 47, name: '2 Corinthians', aliases: ['2 corinthians', '2corinthians', 'ii corinthians', 'second corinthians', '2 cor', '2cor'] },
  { n: 48, name: 'Galatians', aliases: ['galatians', 'gal'] },
  { n: 49, name: 'Ephesians', aliases: ['ephesians', 'eph'] },
  { n: 50, name: 'Philippians', aliases: ['philippians', 'phil'] },
  { n: 51, name: 'Colossians', aliases: ['colossians', 'col'] },
  { n: 52, name: '1 Thessalonians', aliases: ['1 thessalonians', '1thessalonians', 'i thessalonians', 'first thessalonians', '1 thess', '1thess'] },
  { n: 53, name: '2 Thessalonians', aliases: ['2 thessalonians', '2thessalonians', 'ii thessalonians', 'second thessalonians', '2 thess', '2thess'] },
  { n: 54, name: '1 Timothy', aliases: ['1 timothy', '1timothy', 'i timothy', 'first timothy', '1 tim', '1tim'] },
  { n: 55, name: '2 Timothy', aliases: ['2 timothy', '2timothy', 'ii timothy', 'second timothy', '2 tim', '2tim'] },
  { n: 56, name: 'Titus', aliases: ['titus'] },
  { n: 57, name: 'Philemon', aliases: ['philemon', 'phlm'] },
  { n: 58, name: 'Hebrews', aliases: ['hebrews', 'heb'] },
  { n: 59, name: 'James', aliases: ['james', 'jas'] },
  { n: 60, name: '1 Peter', aliases: ['1 peter', '1peter', 'i peter', 'first peter', '1 pet', '1pet'] },
  { n: 61, name: '2 Peter', aliases: ['2 peter', '2peter', 'ii peter', 'second peter', '2 pet', '2pet'] },
  { n: 62, name: '1 John', aliases: ['1 john', '1john', 'i john', 'first john', '1 jn'] },
  { n: 63, name: '2 John', aliases: ['2 john', '2john', 'ii john', 'second john', '2 jn'] },
  { n: 64, name: '3 John', aliases: ['3 john', '3john', 'iii john', 'third john', '3 jn'] },
  { n: 65, name: 'Jude', aliases: ['jude'] },
  { n: 66, name: 'Revelation', aliases: ['revelation', 'revelations', 'rev'] },
];

const ALIAS_TO_BOOK = new Map<string, { n: number; name: string }>();
for (const b of BOOKS) for (const a of b.aliases) ALIAS_TO_BOOK.set(a, { n: b.n, name: b.name });

// Longest alias first so "1 john" wins over "john", "song of solomon" over "songs".
const ALIAS_PATTERN = [...ALIAS_TO_BOOK.keys()]
  .sort((a, b) => b.length - a.length)
  .map(a => a.replace(/ /g, '\\s+'))
  .join('|');

// "<book> [chapter] <chapter>[<sep><verse>[-<verse>]]" where <sep> is ":",
// ".", or spoken forms — "verse 28", "verses 1-3", "v 28", "vs 28" — so
// "psalm 22 verse 28" resolves to 22:28 instead of the whole chapter.
// Ranges accept "-", "–", "to", "through", and "and".
const REF_RE = new RegExp(
  `\\b(${ALIAS_PATTERN})\\.?\\s+(?:chapter\\s+)?(\\d{1,3})` +
  `(?:\\s*(?:[:.]|,?\\s+(?:verses?|vs?s?)\\.?)\\s*(\\d{1,3})` +
  `(?:(?:\\s*[-–]\\s*|\\s+(?:to|through|and)\\s+)(\\d{1,3}))?)?\\b`,
  'i',
);

const BIBLE_WORDS_RE = /\b(bible|scripture|scriptures|verse|verses|psalm|psalms|proverb|proverbs|gospel|kjv|testament|word of god|jesus said|the lord says?)\b/i;

/**
 * Find a verse reference in the message. Chapter-only matches ("john 3",
 * "psalm 23") are only accepted when the message is essentially just the
 * reference or clearly Bible-flavoured — "quit my job 3 months ago" must
 * not return Job 3.
 */
export function parseBibleReference(message: string): BibleRef | null {
  const m = REF_RE.exec(message);
  if (!m) return null;
  const alias = m[1].toLowerCase().replace(/\s+/g, ' ');
  const book = ALIAS_TO_BOOK.get(alias);
  if (!book) return null;
  const chapter = parseInt(m[2], 10);
  if (!chapter || chapter > 150) return null;

  if (!m[3]) {
    const bare = message.trim().length <= m[0].length + 12;
    if (!bare && !BIBLE_WORDS_RE.test(message)) return null;
    return { bookNum: book.n, book: book.name, chapter };
  }
  const verseStart = parseInt(m[3], 10);
  if (!verseStart) return null;
  // A backwards "range" ("verse 28 and 3 others") is noise, not a range —
  // keep the single verse rather than dropping the whole reference.
  let verseEnd = m[4] ? parseInt(m[4], 10) : verseStart;
  if (verseEnd < verseStart) verseEnd = verseStart;
  return { bookNum: book.n, book: book.name, chapter, verseStart, verseEnd };
}

/**
 * Pull the topic out of an explicit scripture ask. Conservative on purpose:
 * only fires on "verse/scripture/psalm about|on|for X" and "what does the
 * bible say about X" shapes, so plain mentions of the Bible still reach the
 * knowledge nodes.
 */
export function extractBibleTopic(message: string): string | null {
  const t = message.toLowerCase().replace(/[?!.]+\s*$/, '');
  const patterns = [
    /what\s+does\s+(?:the\s+)?(?:bible|scripture|word(?:\s+of\s+god)?|kjv)\s+say\s+(?:about|on)\s+(.+)/,
    /(?:bible\s+)?(?:verse|verses|scripture|scriptures|psalm|proverb)s?\s+(?:about|on|for|to\s+help\s+(?:me\s+)?with)\s+(.+)/,
    /what\s+did\s+jesus\s+say\s+about\s+(.+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const topic = m[1].replace(/\b(please|navi|my|the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (topic.length >= 3) return topic;
    }
  }
  return null;
}

const MAX_VERSES = 12;

const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * How many verses a topic ask wants: "3 verses about hope" → 3,
 * "a verse about hope" → 1, bare plural "verses about hope" → 3.
 */
export function requestedVerseCount(message: string): number {
  const m = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:bible\s+|kjv\s+|more\s+)?(?:verses|scriptures)\b/i.exec(message);
  if (m) {
    const n = WORD_NUMS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
    return Math.min(Math.max(n, 1), 10);
  }
  return /\b(?:verses|scriptures)\b/i.test(message) ? 3 : 1;
}

export async function fetchBibleVerses(ref: BibleRef): Promise<BibleVerse[]> {
  const filters = [`book_num=eq.${ref.bookNum}`, `chapter=eq.${ref.chapter}`];
  if (ref.verseStart) {
    filters.push(`verse=gte.${ref.verseStart}`, `verse=lte.${ref.verseEnd ?? ref.verseStart}`);
  }
  // One extra row so the formatter can tell a full chapter was cut off.
  const url = `${SUPABASE_URL}/rest/v1/navi_bible_verses?${filters.join('&')}` +
    `&select=book,chapter,verse,text&order=verse.asc&limit=${MAX_VERSES + 1}`;
  try {
    const res = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function searchBibleVerses(topic: string, maxResults = 3): Promise<BibleVerse[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/navi_bible_search`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: topic, max_results: maxResults }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export function formatVerses(ref: BibleRef, verses: BibleVerse[]): string {
  if (verses.length === 1) {
    const v = verses[0];
    return `${v.book} ${v.chapter}:${v.verse} (KJV) — "${v.text}"`;
  }
  const truncated = verses.length > MAX_VERSES;
  const shown = truncated ? verses.slice(0, MAX_VERSES) : verses;
  const header = ref.verseStart
    ? `${ref.book} ${ref.chapter}:${ref.verseStart}-${shown[shown.length - 1].verse} (KJV)`
    : `${ref.book} ${ref.chapter} (KJV)`;
  const body = shown.map(v => `${v.verse}. ${v.text}`).join('\n');
  const tail = truncated
    ? `\n…there's more. Ask for ${ref.book} ${ref.chapter}:${shown[shown.length - 1].verse + 1} onward and I'll keep going.`
    : '';
  return `${header}\n${body}${tail}`;
}

export function formatTopicVerses(topic: string, verses: BibleVerse[]): string {
  const lines = verses.map(v => `${v.book} ${v.chapter}:${v.verse} — "${v.text}"`).join('\n\n');
  return `Here's what the Word says about ${topic} (KJV):\n\n${lines}`;
}

/** Full Bible pipeline. Returns null when the message isn't a Bible ask. */
export async function answerFromBible(message: string): Promise<string | null> {
  const ref = parseBibleReference(message);
  if (ref) {
    const verses = await fetchBibleVerses(ref);
    if (verses.length > 0) return formatVerses(ref, verses);
    if (ref.verseStart) return `${ref.book} ${ref.chapter}:${ref.verseStart} — I don't have that one; that chapter may not go that far. Try another reference.`;
    return null;
  }
  const topic = extractBibleTopic(message);
  if (topic) {
    const verses = await searchBibleVerses(topic, requestedVerseCount(message));
    if (verses.length > 0) return formatTopicVerses(topic, verses);
  }
  return null;
}
