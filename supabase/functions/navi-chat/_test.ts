// deno test --allow-env --allow-net supabase/functions/navi-chat/_test.ts
// Parser/format tests run offline; the integration tests hit the live
// navi_bible_verses table and only run when SUPABASE_URL + service key are set.

import {
  parseBibleReference,
  extractBibleTopic,
  formatVerses,
  answerFromBible,
  requestedVerseCount,
} from './bible.ts';
import { tryMath, tryUnits, tryDateTime, isFollowUp } from './skills.ts';

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

Deno.test('parses spoken "verse N" forms as a single verse, not the chapter', () => {
  eq(parseBibleReference('psalm 22 verse 28'), { bookNum: 19, book: 'Psalms', chapter: 22, verseStart: 28, verseEnd: 28 }, 'psalm 22 verse 28');
  eq(parseBibleReference('give me psalm 22, verse 28 please'), { bookNum: 19, book: 'Psalms', chapter: 22, verseStart: 28, verseEnd: 28 }, 'comma before verse');
  eq(parseBibleReference('john chapter 3 verse 16'), { bookNum: 43, book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 }, 'chapter word');
  eq(parseBibleReference('psalm 23 v 1'), { bookNum: 19, book: 'Psalms', chapter: 23, verseStart: 1, verseEnd: 1 }, 'v abbreviation');
});

Deno.test('parses spoken verse ranges', () => {
  eq(parseBibleReference('psalm 22 verses 1-3'), { bookNum: 19, book: 'Psalms', chapter: 22, verseStart: 1, verseEnd: 3 }, 'verses 1-3');
  eq(parseBibleReference('psalm 22 verse 1 to 3'), { bookNum: 19, book: 'Psalms', chapter: 22, verseStart: 1, verseEnd: 3 }, 'verse 1 to 3');
  eq(parseBibleReference('john 3 verse 16 and 17'), { bookNum: 43, book: 'John', chapter: 3, verseStart: 16, verseEnd: 17 }, 'verse 16 and 17');
  eq(parseBibleReference('psalm 22 verse 28 and 3 others'), { bookNum: 19, book: 'Psalms', chapter: 22, verseStart: 28, verseEnd: 28 }, 'backwards range keeps single verse');
});

Deno.test('counts requested verses for topic asks', () => {
  eq(requestedVerseCount('give me a bible verse about hope'), 1, 'singular ask');
  eq(requestedVerseCount('give me 3 verses about hope'), 3, 'digit count');
  eq(requestedVerseCount('give me three verses about fear'), 3, 'word count');
  eq(requestedVerseCount('verses about forgiveness'), 3, 'bare plural defaults to 3');
  eq(requestedVerseCount('give me 50 verses about love'), 10, 'capped at 10');
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

// ── v13 deterministic skills ─────────────────────────────────────────────────

Deno.test('math: evaluates arithmetic asks', () => {
  eq(tryMath('what is 25 * 17'), '25 × 17 = 425', 'multiplication');
  eq(tryMath('what is 144 divided by 12?'), '144 ÷ 12 = 12', 'divided by words');
  eq(tryMath('calculate 2 to the power of 10'), '2 ^ 10 = 1,024', 'powers');
  eq(tryMath('square root of 81'), '√ 81 = 9', 'sqrt');
  eq(tryMath('what is 15% of 200'), '15% of 200 is 30.', 'percent of');
  eq(tryMath('3 plus 4 times 2'), '3 + 4 × 2 = 11', 'precedence');
  eq(tryMath('(3 + 4) * 2'), '(3 + 4) × 2 = 14', 'parens');
});

Deno.test('math: rejects non-math messages', () => {
  eq(tryMath('john 3:16'), null, 'bible ref has a colon');
  eq(tryMath('i have 2 dogs and 3 cats'), null, 'sentence with numbers');
  eq(tryMath('call 0800 456 789'), null, 'phone number, no operator');
  eq(tryMath('what is love'), null, 'no digits');
  eq(tryMath('i quit my job 3 months ago'), null, 'letters remain');
});

Deno.test('math: divide by zero gets a friendly answer', () => {
  const out = tryMath('what is 5 / 0');
  if (!out || !out.includes('dividing by zero')) throw new Error(`got: ${out}`);
});

Deno.test('units: converts between compatible units', () => {
  eq(tryUnits('convert 10 km to miles'), '10 km ≈ 6.2137 miles.', 'km to miles');
  eq(tryUnits('100 celsius to fahrenheit'), '100 °C = 212 °F.', 'c to f');
  eq(tryUnits('how much is 5 kg in pounds'), '5 kg ≈ 11.0231 pounds.', 'kg to lbs');
});

Deno.test('units: rejects mismatched or missing units', () => {
  eq(tryUnits('convert 10 km to kg'), null, 'length to mass');
  eq(tryUnits('i ran 5 km in 30 minutes'), null, 'not a conversion ask');
  eq(tryUnits('how are you today'), null, 'plain chat');
});

Deno.test('datetime: answers date/time asks and ignores plain chat', () => {
  const day = tryDateTime('what day is it today?');
  if (!day || !day.startsWith('Today is ')) throw new Error(`got: ${day}`);
  const yr = tryDateTime('what year is it');
  if (!yr || !/\d{4}/.test(yr)) throw new Error(`got: ${yr}`);
  eq(tryDateTime('tell me about the day my father died'), null, 'not a date ask');
  eq(tryDateTime('what a time to be alive'), null, 'idiom, not a time ask');
});

Deno.test('follow-ups: short continuations detected, real questions not', () => {
  eq(isFollowUp('why?'), true, 'why');
  eq(isFollowUp('tell me more'), true, 'tell me more');
  eq(isFollowUp('like what?'), true, 'like what');
  eq(isFollowUp('why do people dream'), false, 'full question');
  eq(isFollowUp('ok'), false, 'plain ack is not a follow-up');
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
