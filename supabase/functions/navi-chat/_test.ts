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
import {
  tryMath, tryUnits, tryDateTime, isFollowUp,
  tryPercentOps, tryListStats, tryDaysUntil, tryRandom,
} from './skills.ts';
import { stem, withinOneEdit, wordsMatch } from './match.ts';
import { extractProfile, answerProfileQuestion } from './memory.ts';

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

// ── v15 fuzzy matching ───────────────────────────────────────────────────────

Deno.test('stem: strips common suffixes', () => {
  eq(stem('running'), 'run', 'running');
  eq(stem('habits'), 'habit', 'habits');
  eq(stem('calmly'), 'calm', 'calmly');
  eq(stem('music'), 'music', 'music unchanged');
});

Deno.test('withinOneEdit: typos within one edit match, others do not', () => {
  eq(withinOneEdit('depresed', 'depressed'), true, 'missing letter');
  eq(withinOneEdit('musci', 'music'), true, 'transposition');
  eq(withinOneEdit('anxeity', 'anxiety'), true, 'swapped letters');
  eq(withinOneEdit('money', 'monkey'), true, 'one insert');
  eq(withinOneEdit('faith', 'wrath'), false, 'two edits apart');
});

Deno.test('wordsMatch: fuzzy hits typos and word forms, exact-only mode does not', () => {
  eq(wordsMatch('runing', 'running', true), true, 'typo + form');
  eq(wordsMatch('discipilne', 'discipline', true), true, 'typo');
  eq(wordsMatch('suicide', 'suicide', false), true, 'exact still matches without fuzz');
  eq(wordsMatch('suicid', 'suicide', false), false, 'crisis mode requires exact');
  eq(wordsMatch('what', 'want', true), false, 'short words stay exact');
  eq(wordsMatch('tower', 'power', true), false, 'different first letter is a different word');
});

// ── v15 personal memory ──────────────────────────────────────────────────────

Deno.test('memory: extracts name, age, and place from the conversation', () => {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: 'my name is Thabo and I love music' },
    { role: 'assistant', content: 'Good to meet you.' },
    { role: 'user', content: "i'm 19 years old" },
    { role: 'user', content: 'i live in cape town, been here all my life' },
  ];
  const p = extractProfile(history, 'how are you');
  eq(p.name, 'Thabo', 'name');
  eq(p.age, 19, 'age');
  eq(p.place, 'Cape Town', 'place');
});

Deno.test('memory: ignores non-name and non-age phrasings', () => {
  const p = extractProfile([], 'call me later, i am 30 minutes away');
  eq(p.name, undefined, '"call me later" is not a name');
  eq(p.age, undefined, '"30 minutes away" is not an age');
});

Deno.test('memory: answers profile questions, asks when unknown', () => {
  const known = answerProfileQuestion("what's my name?", { name: 'Thabo' });
  if (!known || !known.includes('Thabo')) throw new Error(`got: ${known}`);
  const unknown = answerProfileQuestion('do you know my name?', {});
  if (!unknown || !unknown.includes("haven't told me")) throw new Error(`got: ${unknown}`);
  eq(answerProfileQuestion('what is your name', { name: 'Thabo' }), null, 'NAVI identity stays with nodes');
  eq(answerProfileQuestion('how are you', {}), null, 'plain chat');
});

// ── v15 skills ───────────────────────────────────────────────────────────────

Deno.test('percent: discounts, increases, tips', () => {
  eq(tryPercentOps('what is 20% off 500'), '20% off 500 leaves 400 — you save 100.', 'discount');
  eq(tryPercentOps('add 15% to 200'), '200 plus 15% is 230.', 'increase');
  eq(tryPercentOps('10% tip on 340'), 'A 10% tip on 340 is 34, so 374 total.', 'tip');
  eq(tryPercentOps('i gave 100 percent today'), null, 'not a percent op');
});

Deno.test('list stats: average, sum, max, min', () => {
  eq(tryListStats('average of 4, 8 and 15'), 'The average of 4, 8 and 15 is 9.', 'average');
  eq(tryListStats('what is the sum of 10, 20, 30'), 'The sum of 10, 20 and 30 is 60.', 'sum');
  eq(tryListStats('max of 3, 99, 45'), 'The biggest of 3, 99 and 45 is 99.', 'max');
  eq(tryListStats('average of one thing'), null, 'needs at least two numbers');
});

Deno.test('days until: named days and explicit dates', () => {
  const xmas = tryDaysUntil('how many days until christmas?');
  if (!xmas || !/Christmas is (\d|today|tomorrow)/.test(xmas)) throw new Error(`got: ${xmas}`);
  const date = tryDaysUntil('days till 25 december');
  if (!date || !date.includes('25 December')) throw new Error(`got: ${date}`);
  eq(tryDaysUntil('i have three days until the deadline hits me'), null, 'no recognizable date');
  eq(tryDaysUntil('how are you today'), null, 'plain chat');
});

Deno.test('random: coin, dice, number ranges', () => {
  const coin = tryRandom('flip a coin');
  if (coin !== 'Heads.' && coin !== 'Tails.') throw new Error(`got: ${coin}`);
  const die = tryRandom('roll a dice');
  if (!die || !/You rolled a [1-6]\./.test(die)) throw new Error(`got: ${die}`);
  const pick = tryRandom('pick a number between 1 and 10');
  if (!pick || !/^(10|[1-9])\./.test(pick)) throw new Error(`got: ${pick}`);
  eq(tryRandom('life is a roll of the dice sometimes'), null, 'idiom stays with nodes');
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
