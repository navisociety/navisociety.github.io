// deno test --allow-env --allow-net supabase/functions/navi-chat/_test.ts
// Parser/format tests run offline; the integration tests hit the live
// navi_bible_verses table and only run when SUPABASE_URL + service key are set.

import {
  parseBibleReference,
  extractBibleTopic,
  formatVerses,
  answerFromBible,
} from './bible.ts';

const eq = (a: unknown, b: unknown, label: string) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${label}: got ${sa}, expected ${sb}`);
};

Deno.test('parses plain verse reference', () => {
  eq(parseBibleReference('john 3:16'), { bookNum: 43, book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 }, 'john 3:16');
});

Deno.test('parses numbered books, longest alias wins', () => {
  eq(parseBibleReference('what does 1 john 1:9 say'), { bookNum: 62, book: '1 John', chapter: 1, verseStart: 9, verseEnd: 9 }, '1 john 1:9');
  eq(parseBibleReference('First Corinthians 13:4-7')!.book, '1 Corinthians', 'first corinthians');
  eq(parseBibleReference('First Corinthians 13:4-7')!.verseEnd, 7, 'range end');
});

Deno.test('parses song of solomon over songs', () => {
  eq(parseBibleReference('song of solomon 2:1')!.book, 'Song of Solomon', 'song of solomon');
});

Deno.test('chapter-only allowed when message is just the reference', () => {
  eq(parseBibleReference('Psalm 23'), { bookNum: 19, book: 'Psalms', chapter: 23 }, 'psalm 23');
  eq(parseBibleReference('read genesis 1 please'), { bookNum: 1, book: 'Genesis', chapter: 1 }, 'genesis 1');
});

Deno.test('chapter-only rejected inside unrelated sentences', () => {
  eq(parseBibleReference('i quit my job 3 months ago and feel lost'), null, 'job 3 false positive');
  eq(parseBibleReference('my friend mark 2 weeks ago said something about work stress'), null, 'mark 2 false positive');
});

Deno.test('no reference in plain chat', () => {
  eq(parseBibleReference('how are you today'), null, 'plain chat');
  eq(parseBibleReference('i love music and numbers'), null, 'book word without chapter');
});

Deno.test('extracts topics only from explicit scripture asks', () => {
  eq(extractBibleTopic('give me a bible verse about hope'), 'hope', 'verse about hope');
  eq(extractBibleTopic('What does the Bible say about fear?'), 'fear', 'bible say about fear');
  eq(extractBibleTopic('scripture on forgiveness please'), 'forgiveness', 'scripture on forgiveness');
  eq(extractBibleTopic('do you know the bible'), null, 'meta question stays with nodes');
  eq(extractBibleTopic('tell me about hope'), null, 'non-scripture ask');
});

Deno.test('formats a single verse inline and a chapter as numbered lines', () => {
  const ref = { bookNum: 43, book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 };
  const single = formatVerses(ref, [{ book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world…' }]);
  eq(single.startsWith('John 3:16 (KJV) — "For God'), true, 'single verse format');

  const chap = { bookNum: 19, book: 'Psalms', chapter: 117 };
  const out = formatVerses(chap, [
    { book: 'Psalms', chapter: 117, verse: 1, text: 'O praise the LORD, all ye nations…' },
    { book: 'Psalms', chapter: 117, verse: 2, text: 'For his merciful kindness is great…' },
  ]);
  eq(out.startsWith('Psalms 117 (KJV)\n1. '), true, 'chapter header + numbering');
});

// ── Live integration (skipped without credentials) ──────────────────────────

const LIVE = !!(Deno.env.get('SUPABASE_URL') && Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

Deno.test({ name: 'live: John 3:16 returns the real verse', ignore: !LIVE, fn: async () => {
  const out = await answerFromBible('john 3:16');
  if (!out || !out.includes('For God so loved the world')) throw new Error(`got: ${out}`);
}});

Deno.test({ name: 'live: Psalm 23 returns the chapter', ignore: !LIVE, fn: async () => {
  const out = await answerFromBible('Psalm 23');
  if (!out || !out.includes('is my shepherd; I shall not want')) throw new Error(`got: ${out}`);
}});

Deno.test({ name: 'live: topic search returns scripture', ignore: !LIVE, fn: async () => {
  const out = await answerFromBible('give me a bible verse about hope');
  if (!out || !/\d+:\d+/.test(out)) throw new Error(`got: ${out}`);
}});

Deno.test({ name: 'live: normal chat returns null (falls through to model)', ignore: !LIVE, fn: async () => {
  const out = await answerFromBible('how do i stay disciplined with music');
  eq(out, null, 'non-bible message');
}});
