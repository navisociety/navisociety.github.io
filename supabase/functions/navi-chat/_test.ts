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
  tryWorldTime, tryDayOfWeek, tryBornYear, tryWordTools,
} from './skills.ts';
import { stem, withinOneEdit, wordsMatch } from './match.ts';
import {
  extractProfile, answerProfileQuestion, memoryAcknowledgement, toSecondPerson,
  mergeProfiles, detectMood, detectForget, applyForget, addReturningGreeting,
  captureAck, newProfileBits, tryGoalDone,
} from './memory.ts';
import { parseLifeEvent, tryLifeEvent, addEventFollowUps } from './life.ts';
import { extractTopicEntity, resolveReference } from './context.ts';
import { tryAcknowledgment } from './acts.ts';
import { tryRepair } from './repair.ts';
import { tryRecall } from './recall.ts';
import { wantsMore, nextChunk } from './deepen.ts';
import {
  normalizeKey, detectTeach, detectFeedback, previousUserQuestion,
  recallKnowledge, learnKnowledge, logGap,
} from './learn.ts';
import { detectComparison, splitCompound, tryReason } from './reason.ts';
import { adaptTone, userIsTerse } from './tone.ts';
import { addCuriosity } from './curiosity.ts';
import { trySummarize, tryRewrite, rewriteMode } from './understand.ts';
import { parseCompose, tryCompose } from './compose.ts';
import { parsePlanGoal, tryPlan } from './plan.ts';
import { topicFrom, updateTopics, tryEpisodic } from './episodic.ts';
import { lessonTopic, buildLesson, tryQuiz } from './lesson.ts';
import { tryEquation } from './skills.ts';
import { parseDefineAsk, formatDictionary, type DictEntry } from './define.ts';
import { parseWhen, tryReminder, addDueReminders, isReminderAsk } from './remind.ts';
import { votdIndex, isVotdAsk, devotionTopic, formatVotd, formatDevotional, VOTD_ROTATION } from './devotion.ts';
import { memorizeRef, activeMemoryRef, gradeAttempt, blankOut, startCoaching } from './memorize.ts';
import { normalizeMessage } from './normalize.ts';
import { expandFollowUp } from './followup.ts';
import { splitIntents } from './execute.ts';
import type { Profile } from './memory.ts';

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

// ── v16 memory 2.0 ───────────────────────────────────────────────────────────

Deno.test('memory 2.0: favourites are extracted and recalled', () => {
  const p = extractProfile([{ role: 'user', content: 'my favourite colour is blue' }], 'how are you');
  eq(p.favorites?.color, 'Blue', 'favourite colour stored (normalized key)');
  const ans = answerProfileQuestion("what's my favourite colour?", p);
  if (!ans || !ans.includes('Blue')) throw new Error(`got: ${ans}`);
  const us = answerProfileQuestion('what is my favorite color', p);
  if (!us || !us.includes('Blue')) throw new Error(`got: ${us}`);
  const unknown = answerProfileQuestion('what is my favourite movie', p);
  if (!unknown || !unknown.includes("haven't told me")) throw new Error(`got: ${unknown}`);
});

Deno.test('memory 2.0: birthday extracted, recalled with countdown', () => {
  const p = extractProfile([{ role: 'user', content: 'my birthday is on 12 march' }], 'hey');
  eq(p.birthday, { month: 3, day: 12 }, 'birthday stored');
  const ans = answerProfileQuestion('when is my birthday?', p);
  if (!ans || !ans.includes('12 March')) throw new Error(`got: ${ans}`);
  const none = answerProfileQuestion('when is my birthday?', {});
  if (!none || !none.includes("haven't told me")) throw new Error(`got: ${none}`);
});

Deno.test('memory 2.0: remember-that facts stored, echoed in second person', () => {
  const p = extractProfile([{ role: 'user', content: 'remember that i have a meeting on friday' }], 'hi');
  eq(p.facts?.length, 1, 'fact stored');
  eq(toSecondPerson('i have a meeting on friday'), 'you have a meeting on friday', 'pronoun flip');
  const summary = answerProfileQuestion('what do you know about me?', p);
  if (!summary || !summary.includes('you have a meeting on friday')) throw new Error(`got: ${summary}`);
});

Deno.test('memory 2.0: statements get a direct confirmation', () => {
  const p1 = extractProfile([], 'remember that my dog is called Rex');
  const ack1 = memoryAcknowledgement('remember that my dog is called Rex', p1);
  if (!ack1 || !ack1.toLowerCase().includes('your dog is called rex')) throw new Error(`got: ${ack1}`);

  const p2 = extractProfile([], 'my favourite food is pizza');
  const ack2 = memoryAcknowledgement('my favourite food is pizza', p2);
  if (!ack2 || !ack2.includes('Pizza')) throw new Error(`got: ${ack2}`);

  eq(memoryAcknowledgement('i love pizza and my dog', extractProfile([], 'i love pizza and my dog')), null, 'plain chat is not a memory statement');
});

Deno.test('memory 2.0: empty profile summary invites the user', () => {
  const out = answerProfileQuestion('what do you know about me', {});
  if (!out || !out.includes('remember that')) throw new Error(`got: ${out}`);
});

// ── v18 permanent memory ─────────────────────────────────────────────────────

Deno.test('v18: extracts goals, work, and people', () => {
  const p = extractProfile([], "my goal is to launch my app. i work as a nurse. my brother is called Sipho");
  eq(p.goals, ['to launch my app'], 'goal');
  eq(p.work, 'nurse', 'work');
  eq(p.people, { brother: 'Sipho' }, 'person');
});

Deno.test('v18: relation aliases canonicalise (mum → mother)', () => {
  const p = extractProfile([], "my mum's name is Grace");
  eq(p.people, { mother: 'Grace' }, 'mum maps to mother');
});

Deno.test('v18: answers goal / work / person questions', () => {
  const p = extractProfile([], "my goal is to finish my album. i work as a teacher. my sister is called Lerato");
  if (!answerProfileQuestion("what's my goal?", p)!.includes('finish my album')) throw new Error('goal recall');
  if (!answerProfileQuestion('what do i do for work?', p)!.toLowerCase().includes('teacher')) throw new Error('work recall');
  if (!answerProfileQuestion("what's my sister's name?", p)!.includes('Lerato')) throw new Error('person recall');
});

Deno.test('v18: full recall includes work, people, and goals', () => {
  const p = extractProfile([], "my name is Dian. i work as a builder. my dog is called Rex. my goal is to grow NAVI");
  const out = answerProfileQuestion('what do you know about me', p)!;
  for (const s of ['Dian', 'builder', 'Rex', 'grow navi']) {
    if (!out.includes(s)) throw new Error(`missing "${s}" in: ${out}`);
  }
});

Deno.test('v18: mergeProfiles unions facts/goals and overlays scalars', () => {
  const base = { name: 'Dian', facts: ['likes coffee'], goals: ['ship v18'], favorites: { color: 'Cyan' } };
  const overlay = { age: 30, facts: ['likes coffee', 'has a dog'], goals: ['learn piano'], favorites: { food: 'Pizza' } };
  const m = mergeProfiles(base, overlay);
  eq(m.name, 'Dian', 'base name kept');
  eq(m.age, 30, 'overlay age added');
  eq(m.facts, ['likes coffee', 'has a dog'], 'facts unioned, no dupes');
  eq(m.goals, ['ship v18', 'learn piano'], 'goals unioned');
  eq(m.favorites, { color: 'Cyan', food: 'Pizza' }, 'favourites merged');
});

Deno.test('v18: detectMood reads first-person feeling, ignores neutral', () => {
  eq(detectMood('i feel so hopeless today'), 'low', 'low');
  eq(detectMood("i'm really stressed about work"), 'stressed', 'stressed');
  eq(detectMood("i'm feeling great today"), 'good', 'good');
  eq(detectMood('what is the capital of France'), null, 'neutral has no mood');
});

Deno.test('v18: detectForget targets fields, favourites, people, and all', () => {
  eq(detectForget('forget my birthday'), { kind: 'field', field: 'birthday' }, 'field');
  eq(detectForget('forget my favourite colour'), { kind: 'favorite', thing: 'color' }, 'favourite');
  eq(detectForget('forget everything about me'), { kind: 'all' }, 'all');
  eq(detectForget("forget my brother"), { kind: 'person', relation: 'brother' }, 'person');
  eq(detectForget('i can never forget her'), null, 'not a command mid-sentence');
});

Deno.test('v18: applyForget clears the right slice', () => {
  const p = { name: 'Dian', birthday: { month: 3, day: 12 }, favorites: { color: 'Cyan' }, facts: ['has a dog'] };
  eq(applyForget(p, { kind: 'field', field: 'birthday' }).profile.birthday, undefined, 'birthday cleared');
  eq(applyForget(p, { kind: 'favorite', thing: 'color' }).profile.favorites, {}, 'favourite cleared');
  eq(applyForget(p, { kind: 'all' }).profile, {}, 'all cleared');
  eq(applyForget(p, { kind: 'fact', text: 'has a dog' }).profile.facts, [], 'fact cleared');
});

Deno.test('v18: addReturningGreeting only fires after a real gap', () => {
  const now = Date.parse('2026-07-07T12:00:00Z');
  const old = { name: 'Dian', lastSeen: '2026-07-06T12:00:00Z' }; // ~24h ago
  const recent = { name: 'Dian', lastSeen: '2026-07-07T11:00:00Z' }; // 1h ago
  if (!addReturningGreeting('Here is your answer.', old, now).startsWith('Welcome back, Dian.')) throw new Error('should greet after gap');
  eq(addReturningGreeting('Here is your answer.', recent, now), 'Here is your answer.', 'no greeting within the window');
  eq(addReturningGreeting('Here is your answer.', {}, now), 'Here is your answer.', 'no stored memory, no greeting');
});

Deno.test('v18: returning greeting checks in on a low mood, never on crisis', () => {
  const now = Date.parse('2026-07-07T12:00:00Z');
  const low = { name: 'Dian', lastSeen: '2026-07-06T00:00:00Z', lastMood: 'low' };
  if (!addReturningGreeting('You can do this.', low, now).toLowerCase().includes('how are you holding up')) throw new Error('low check-in');
  const crisis = addReturningGreeting('Please call SADAG on 0800 567 567.', low, now);
  if (crisis.toLowerCase().includes('welcome back') || crisis.toLowerCase().includes('holding up')) throw new Error('must not wrap crisis reply');
});

// ── v16 conversational context (pronoun follow-ups) ─────────────────────────

Deno.test('context: extracts entities from factual questions only', () => {
  eq(extractTopicEntity('who is nelson mandela?'), 'nelson mandela', 'who is');
  eq(extractTopicEntity('tell me about the eiffel tower'), 'eiffel tower', 'tell me about');
  eq(extractTopicEntity('who are you'), null, 'NAVI self-question skipped');
  eq(extractTopicEntity('i love music'), null, 'statement skipped');
});

Deno.test('context: resolves pronoun follow-ups to the last entity', () => {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: 'who is nelson mandela?' },
    { role: 'assistant', content: 'Nelson Mandela was a South African statesman…' },
  ];
  eq(resolveReference('how old is he?', history), 'how old is nelson mandela?', 'subject pronoun');
  eq(resolveReference('where was his house?', history), "where was nelson mandela's house?", 'possessive');
  eq(resolveReference('he hurt me', history), null, 'first-person emotional message untouched');
  eq(resolveReference('how old is he?', []), null, 'no entity in history');
  eq(resolveReference('how old are you?', history), null, 'no third-person pronoun');
});

// ── v16 skills ───────────────────────────────────────────────────────────────

Deno.test('world time: mapped cities answered, unknown places skipped', () => {
  const out = tryWorldTime('what time is it in london?');
  if (!out || !/^It's \d{2}:\d{2} in London right now/.test(out)) throw new Error(`got: ${out}`);
  const country = tryWorldTime('time in japan');
  if (!country || !country.includes('Tokyo')) throw new Error(`got: ${country}`);
  eq(tryWorldTime('what time is it in my life'), null, 'unknown place');
  eq(tryWorldTime('what time is it'), null, 'no place — stays with tryDateTime');
});

Deno.test('day of week: explicit years, past tense, bad dates rejected', () => {
  eq(tryDayOfWeek('what day of the week is 25 december 2026?'), '25 December 2026 falls on a Friday.', 'future date');
  eq(tryDayOfWeek('what day was 1 january 2000'), '1 January 2000 was a Saturday.', 'past date');
  eq(tryDayOfWeek('what day is it today'), null, 'no date — stays with tryDateTime');
  eq(tryDayOfWeek('i met her on 12 june'), null, 'not a day-of-week ask');
});

Deno.test('born year: age computed both sides of the birthday', () => {
  const cur = new Date().getFullYear();
  const out = tryBornYear('i was born in 1998, how old am i?');
  if (!out || !out.includes(String(cur - 1998))) throw new Error(`got: ${out}`);
  eq(tryBornYear('i was born in 1998'), null, 'statement without an age ask');
  eq(tryBornYear('how old am i'), null, 'no birth year');
});

Deno.test('word tools: spell, letters, reverse', () => {
  eq(tryWordTools('how do you spell banana?'), '"banana" is spelled B-A-N-A-N-A.', 'spell');
  eq(tryWordTools('how many letters in banana'), '"banana" has 6 letters.', 'letters');
  eq(tryWordTools('reverse the word stressed'), '"stressed" reversed is "desserts".', 'reverse');
  eq(tryWordTools('i cast a spell on you'), null, 'idiom stays with nodes');
});

// ── v16 acknowledgment intelligence ─────────────────────────────────────────

Deno.test('acts: bare reactions get forward-moving replies', () => {
  for (const msg of ['ok', 'yes', 'no', 'lol', 'wow', 'hmm', 'okay cool', 'nice']) {
    // 'okay cool' is two words but still a bare reaction? — no: only exact matches fire.
    if (msg === 'okay cool') { eq(tryAcknowledgment(msg, 0), null, 'two-word non-listed combo skipped'); continue; }
    const out = tryAcknowledgment(msg, 0);
    if (!out) throw new Error(`no ack for: ${msg}`);
  }
});

Deno.test('acts: rotation varies by turn, content messages skipped', () => {
  const a = tryAcknowledgment('ok', 0), b = tryAcknowledgment('ok', 1);
  if (!a || !b || a === b) throw new Error(`rotation failed: ${a} / ${b}`);
  eq(tryAcknowledgment('ok so i was thinking about my dad', 0), null, 'real content passes through');
  eq(tryAcknowledgment('yes i want to die', 0), null, 'crisis phrasing never swallowed');
  eq(tryAcknowledgment('thanks', 0), null, 'thanks stays with its node');
  eq(tryAcknowledgment('hello', 0), null, 'greeting stays with its node');
});

// ── v17 conversational repair ───────────────────────────────────────────────

Deno.test('repair: criticism aimed at NAVI gets a composed reset', () => {
  for (const msg of [
    "that's wrong", "you're wrong", "no that's not right", "wrong answer",
    "you're not helping", "that's not helpful", "useless", "you don't get it",
    "that's not what i asked", "you misunderstood", "you already said that",
    "stop repeating yourself", "you keep saying the same thing", "you're stupid",
  ]) {
    if (!tryRepair(msg, 0)) throw new Error(`no repair for: ${msg}`);
  }
});

Deno.test('repair: real content and factual "wrong" pass through', () => {
  eq(tryRepair('why is slavery wrong', 0), null, 'factual wrong not a complaint');
  eq(tryRepair('what did i do wrong in my essay', 0), null, 'real question passes through');
  eq(tryRepair('that makes sense thank you', 0), null, 'praise is not repair');
  eq(tryRepair('tell me about the wrong turn we took on the trip', 0), null, 'long content passes');
  const a = tryRepair("that's wrong", 0), b = tryRepair("that's wrong", 1);
  if (!a || !b || a === b) throw new Error(`rotation failed: ${a} / ${b}`);
});

// ── v17 conversation recall ─────────────────────────────────────────────────

Deno.test('recall: reconstructs the thread from history', () => {
  const history = [
    { role: 'user' as const, content: 'how do i stay disciplined making music' },
    { role: 'assistant' as const, content: '...' },
    { role: 'user' as const, content: 'i want to grow my instagram following' },
    { role: 'assistant' as const, content: '...' },
  ];
  const out = tryRecall('what were we talking about', history);
  if (!out || !out.includes('music')) throw new Error(`got: ${out}`);
  if (!/instagram|content|audience/i.test(out)) throw new Error(`missing recent topic: ${out}`);
});

Deno.test('recall: only fires on recall requests, handles empty history', () => {
  eq(tryRecall('how do i make a beat', []), null, 'not a recall request');
  const early = tryRecall('what were we talking about', []);
  if (!early || !/getting started|nothing substantial/i.test(early)) throw new Error(`empty got: ${early}`);
  // recap request itself should not be quoted back as a topic
  const h = [{ role: 'user' as const, content: 'recap please' }];
  const out = tryRecall('what have we been discussing', h);
  if (!out) throw new Error('expected a recall reply');
});

// ── v17 progressive depth ────────────────────────────────────────────────────

Deno.test('deepen: wantsMore detects follow-ups, skips real questions', () => {
  for (const m of ['tell me more', 'go on', 'more', 'keep going', 'go deeper']) {
    if (!wantsMore(m)) throw new Error(`missed: ${m}`);
  }
  eq(wantsMore('tell me more about how engines work'), false, 'specific question is not a bare more');
  eq(wantsMore('who is nelson mandela'), false, 'real question skipped');
});

Deno.test('deepen: nextChunk returns unseen sentences only', () => {
  const full = 'Nelson Mandela was a South African leader. He was born in 1918. He became president in 1994. He won the Nobel Peace Prize.';
  const shown = 'Nelson Mandela was a South African leader. He was born in 1918.';
  const chunk = nextChunk(full, shown, 900);
  if (!chunk.includes('president in 1994')) throw new Error(`got: ${chunk}`);
  if (chunk.includes('born in 1918')) throw new Error(`repeated shown text: ${chunk}`);
});

Deno.test('deepen: nextChunk returns empty when no overlap or nothing new', () => {
  const full = 'Alpha one. Beta two. Gamma three.';
  eq(nextChunk(full, 'completely unrelated prior answer text here', 900), '', 'no overlap → no fabrication');
  eq(nextChunk(full, full, 900), '', 'all shown → empty');
});

// ── v19 learning system ─────────────────────────────────────────────────────

Deno.test('normalizeKey strips address, politeness, punctuation', () => {
  eq(normalizeKey('Hey NAVI, who is the founder of NAVI?'), 'who is the founder of navi', 'norm1');
  eq(normalizeKey('  Please   explain gravity!! '), 'explain gravity', 'norm2');
});

Deno.test('detectTeach captures a plain declarative fact', () => {
  const t = detectTeach('learn that the founder of NAVI is Prophet Dian');
  eq(t?.key, 'the founder of navi is prophet dian', 'teach-key');
  eq(t?.answer, 'The founder of NAVI is Prophet Dian.', 'teach-answer-cased');
});

Deno.test('detectTeach supports explicit question :: answer', () => {
  const t = detectTeach('learn this: who runs Rekkies :: Prophet Dian runs Rekkies');
  eq(t?.key, 'who runs rekkies', 'qa-key');
  eq(t?.answer, 'Prophet Dian runs Rekkies.', 'qa-answer');
});

Deno.test('detectTeach ignores ordinary talk', () => {
  eq(detectTeach('I want to learn guitar'), null, 'no-false-teach');
  eq(detectTeach('remember that time we spoke'), null, 'too-short-or-not-anchored');
});

Deno.test('detectFeedback reads correction and praise, not content', () => {
  eq(detectFeedback("that's wrong"), 'down', 'fb-down');
  eq(detectFeedback('no, incorrect'), 'down', 'fb-down2');
  eq(detectFeedback('that is wrong'), 'down', 'fb-down-spelled');
  eq(detectFeedback('it is incorrect'), 'down', 'fb-down-it');
  eq(detectFeedback("that's right"), 'up', 'fb-up');
  eq(detectFeedback('that is correct'), 'up', 'fb-up-spelled');
  eq(detectFeedback('perfect, that helped'), 'up', 'fb-up2');
  eq(detectFeedback('why is war wrong'), null, 'fb-content-not-feedback');
  eq(detectFeedback('tell me why that is incorrect in physics'), null, 'fb-long-not-feedback');
});

Deno.test('previousUserQuestion finds the question behind the last answer', () => {
  const h = [
    { role: 'user' as const, content: 'who is Newton' },
    { role: 'assistant' as const, content: 'Isaac Newton was a physicist.' },
    { role: 'user' as const, content: "that's wrong" },
  ];
  eq(previousUserQuestion(h), 'who is Newton', 'prevq');
});

// ── v20: Reasoning Engine ────────────────────────────────────────────────────

Deno.test('detectComparison pulls both sides', () => {
  eq(detectComparison("what's the difference between a virus and a bacteria"),
    ['virus', 'bacteria'], 'difference-between');
  eq(detectComparison('compare python and javascript'), ['python', 'javascript'], 'compare-and');
  eq(detectComparison('coffee vs tea'), ['coffee', 'tea'], 'vs');
  eq(detectComparison('who is Newton'), null, 'not-a-comparison');
});

Deno.test('splitCompound separates multi-part questions', () => {
  eq(splitCompound('who is Tesla and what did he invent'),
    ['who is Tesla?', 'what did he invent?'], 'wh-and-wh');
  eq(splitCompound('who is Tesla? what did he invent?'),
    ['who is Tesla?', 'what did he invent?'], 'two-question-marks');
  eq(splitCompound('how are you'), [], 'single-question');
});

Deno.test('tryReason synthesises a comparison, skips first-person/emotional', async () => {
  const answer = (q: string) =>
    /virus/i.test(q) ? 'A virus is a tiny infectious agent.'
    : /bacteria/i.test(q) ? 'Bacteria are single-celled organisms.'
    : "I don't have a sharp answer for that yet";
  const deps = { answer, lookup: (_q: string) => Promise.resolve(''), isFallback: (r: string) => r.includes("I don't have a sharp answer") };

  const out = await tryReason("what's the difference between a virus and a bacteria", [], deps);
  if (!out.includes('infectious') || !out.includes('single-celled')) throw new Error(`comparison: ${out}`);

  const skip = await tryReason('why do I feel lost and how do I move on', [], deps);
  eq(skip, '', 'first-person emotional is not decomposed');

  const brand = await tryReason('what is NAVI and who is Prophet Dian', [], deps);
  eq(brand, '', 'brand questions stay on their own path');
});

// ── v20: Adaptive Tone Engine ────────────────────────────────────────────────

const longReply = 'A habit is a behaviour repeated until it runs automatically. It forms through a cue, a routine, and a reward looping over time. The brain wires it in to save energy. Breaking one means disrupting the cue or swapping the routine. It takes consistency, not willpower, to reshape it fully.';

Deno.test('adaptTone leaves sensitive replies untouched', () => {
  const out = adaptTone(longReply, 'ok', [], { sensitive: true, isFallback: false });
  eq(out, longReply, 'sensitive-passthrough');
});

Deno.test('adaptTone softens for distress and mirrors hype', () => {
  const soft = adaptTone('Discipline is built by repetition.', 'i feel so alone and broken', [], { sensitive: false, isFallback: false });
  if (!/^(i hear you|i'm with you|that's a lot)/i.test(soft)) throw new Error(`soften: ${soft}`);

  const hype = adaptTone('Discipline is built by repetition.', 'LETS GOOO this is amazing!!!', [], { sensitive: false, isFallback: false });
  if (!/^(let's go|yes|love that energy|right there)/i.test(hype)) throw new Error(`hype: ${hype}`);
});

Deno.test('adaptTone compresses long answers for terse users', () => {
  const hist = [
    { role: 'user' as const, content: 'yo' },
    { role: 'assistant' as const, content: 'hey' },
    { role: 'user' as const, content: 'cool' },
    { role: 'assistant' as const, content: 'yeah' },
  ];
  const out = adaptTone(longReply, 'habits', hist, { sensitive: false, isFallback: false });
  if (out.length >= longReply.length) throw new Error(`not compressed: ${out}`);
  if (!/[.!?]$/.test(out.trim())) throw new Error(`not clean end: ${out}`);
});

Deno.test('userIsTerse reads sustained short rhythm, not one short word', () => {
  eq(userIsTerse('what is the meaning of consciousness and free will', []), false, 'long-message');
  eq(userIsTerse('cool', [{ role: 'user', content: 'nice' }, { role: 'user', content: 'ok' }]), true, 'terse-rhythm');
});

// ── v20: Curiosity Engine ────────────────────────────────────────────────────

Deno.test('addCuriosity appends a topic-aware follow-up on substantive replies', () => {
  const out = addCuriosity(longReply, 'what is a habit', [], { sensitive: false, isFallback: false, terse: false });
  if (!out.includes('?')) throw new Error(`no follow-up: ${out}`);
  if (out === longReply) throw new Error('nothing appended');
});

Deno.test('addCuriosity stays silent when it would be noise', () => {
  eq(addCuriosity(longReply, 'thanks', [], { sensitive: false, isFallback: false, terse: false }), longReply, 'farewell/thanks');
  eq(addCuriosity(longReply, 'what is a habit', [], { sensitive: true, isFallback: false, terse: false }), longReply, 'sensitive');
  eq(addCuriosity(longReply, 'what is a habit', [], { sensitive: false, isFallback: false, terse: true }), longReply, 'terse');
  eq(addCuriosity('Short.', 'what is a habit', [], { sensitive: false, isFallback: false, terse: false }), 'Short.', 'too-short');
  const asks = longReply + ' What do you think?';
  eq(addCuriosity(asks, 'what is a habit', [], { sensitive: false, isFallback: false, terse: false }), asks, 'already-asks');
});

// ── v21: fuzzy-match false friends ───────────────────────────────────────────

Deno.test('false friends never fuzzy-match; real typos still do', () => {
  eq(wordsMatch('invent', 'invest', true), false, 'invent≠invest');
  eq(wordsMatch('quiet', 'quite', true), false, 'quiet≠quite');
  eq(wordsMatch('invesst', 'invest', true), true, 'real typo still matches');
  eq(wordsMatch('invest', 'invest', true), true, 'exact still matches');
});

// ── v21: Summarize & Rewrite ─────────────────────────────────────────────────

const PASTED = 'The ocean covers most of the planet and drives the weather everywhere. ' +
  'Ocean currents move heat from the equator toward the poles, which keeps coastal climates mild. ' +
  'Phytoplankton in the ocean produce a large share of the oxygen we breathe. ' +
  'Human activity is warming the ocean and changing its chemistry. ' +
  'Warmer water holds less oxygen and bleaches coral reefs. ' +
  'Protecting the ocean means protecting the systems that make the planet livable.';

Deno.test('trySummarize condenses pasted text', () => {
  const out = trySummarize(`summarize: ${PASTED}`);
  if (!out.startsWith("Here's the heart of it:")) throw new Error(`no summary: ${out}`);
  if (out.length >= PASTED.length) throw new Error('summary not shorter than source');
});

Deno.test('trySummarize ignores topic asks and non-commands', () => {
  eq(trySummarize('summarize the bible'), '', 'topic ask, no pasted text');
  eq(trySummarize('what does summarize mean'), '', 'not a command');
});

Deno.test('rewriteMode detects the four reshape commands', () => {
  eq(rewriteMode('in one sentence'), 'one-sentence', 'one sentence');
  eq(rewriteMode('say that simpler'), 'simpler', 'simpler');
  eq(rewriteMode('eli5'), 'simpler', 'eli5');
  eq(rewriteMode('make it shorter'), 'shorter', 'shorter');
  eq(rewriteMode('bullet points please'), 'bullets', 'bullets');
  eq(rewriteMode('what is shorter than a meter'), null, 'not a command');
  eq(rewriteMode('i want a simpler life'), null, 'not anchored');
});

Deno.test('tryRewrite reshapes the previous answer', () => {
  const hist = [
    { role: 'user' as const, content: 'tell me about the ocean' },
    { role: 'assistant' as const, content: PASTED },
  ];
  const one = tryRewrite('in one sentence', hist);
  if (!one.startsWith('One sentence:')) throw new Error(`one-sentence failed: ${one}`);
  const bullets = tryRewrite('bullet points', hist);
  if (!bullets.startsWith('• ')) throw new Error(`bullets failed: ${bullets}`);
  const simple = tryRewrite('explain that like i\'m 5', hist);
  if (!simple.startsWith('Simply put:')) throw new Error(`simpler failed: ${simple}`);
  eq(tryRewrite('in one sentence', []), '', 'no previous answer');
});

// ── v21: Creative Composer ───────────────────────────────────────────────────

Deno.test('parseCompose reads kind, topic, and recipient', () => {
  const p = parseCompose('write me a prayer about strength');
  eq(p?.kind, 'prayer', 'prayer kind');
  eq(p?.topic, 'strength', 'prayer topic');
  const a = parseCompose('write an apology to my brother');
  eq(a?.kind, 'apology', 'apology kind');
  eq(a?.recipient, 'my brother', 'apology recipient');
  eq(parseCompose('i want to write a book someday'), null, 'not a command');
  eq(parseCompose('write me a letter to the president'), null, 'unknown kind');
});

Deno.test('tryCompose produces the piece with the topic woven in', () => {
  const prayer = tryCompose('write me a prayer about my exams');
  if (!prayer.includes('my exams') || !prayer.includes('Amen')) throw new Error(`prayer: ${prayer}`);
  const caption = tryCompose('write a caption for my new song');
  if (!caption.toLowerCase().includes('my new song')) throw new Error(`caption: ${caption}`);
  const moti = tryCompose('write me a motivational message about the gym');
  if (!moti.includes('the gym')) throw new Error(`motivation: ${moti}`);
  eq(tryCompose('how do i write better lyrics'), '', 'question, not a command');
});

// ── v21: Goal Planner ────────────────────────────────────────────────────────

Deno.test('parsePlanGoal extracts explicit goals only', () => {
  eq(parsePlanGoal('give me steps to start a business'), 'start a business', 'steps to');
  eq(parsePlanGoal('help me plan my first EP'), 'my first ep', 'help me plan, my kept');
  eq(parsePlanGoal('how do i start a youtube channel'), 'start a youtube channel', 'how do i start prepends start');
  eq(parsePlanGoal('how do i start investing'), 'start investing', 'gerund goal');
  eq(parsePlanGoal("what's your plan for today"), null, 'not a plan ask');
  eq(parsePlanGoal('i have a plan'), null, 'statement');
});

Deno.test('tryPlan returns a numbered domain plan', () => {
  const plan = tryPlan('give me steps to start a business');
  if (!plan.includes("Here's your plan to start a business")) throw new Error(`header: ${plan}`);
  if (!plan.includes('1. ') || !plan.includes('5. ')) throw new Error('not numbered');
  if (!/customers|sale|sellable/.test(plan)) throw new Error('not the business domain bank');
  const generic = tryPlan('help me plan to read the whole bible in a year');
  if (!generic.includes('1. ')) throw new Error('generic plan missing steps');
});

// ── v21: Episodic memory ─────────────────────────────────────────────────────

Deno.test('topicFrom captures clean topics and rejects personal ones', () => {
  eq(topicFrom('who is nikola tesla'), 'nikola tesla', 'entity ask');
  eq(topicFrom('teach me about photosynthesis'), 'photosynthesis', 'lesson ask');
  eq(topicFrom('how do i start a business'), 'business', 'plan ask');
  eq(topicFrom('i feel so lost lately'), null, 'emotional message');
  eq(topicFrom('thanks'), null, 'no topic');
});

Deno.test('updateTopics rolls newest-first, deduped, capped', () => {
  eq(updateTopics(undefined, 'tell me about jazz'), ['jazz'], 'first topic');
  eq(updateTopics(['jazz'], 'who is nelson mandela'), ['nelson mandela', 'jazz'], 'newest first');
  eq(updateTopics(['jazz'], 'tell me about jazz'), ['jazz'], 'dedupe');
  eq(updateTopics(['a', 'b', 'c', 'd', 'e'], 'tell me about jazz')?.length, 5, 'cap at 5');
  eq(updateTopics(['jazz'], 'ok'), ['jazz'], 'no topic keeps list');
});

Deno.test('tryEpisodic answers "last time" asks from the stored trail', () => {
  const out = tryEpisodic('what did we talk about last time?', { lastTopics: ['jazz', 'tesla'] });
  if (!out.includes('jazz') || !out.includes('tesla')) throw new Error(`missing topics: ${out}`);
  const empty = tryEpisodic('what did we talk about last time?', {});
  if (!empty.includes("haven't built up")) throw new Error(`empty case: ${empty}`);
  eq(tryEpisodic('what were we talking about?', { lastTopics: ['jazz'] }), '', 'current-session ask stays with recall.ts');
  eq(tryEpisodic('what is jazz', { lastTopics: ['jazz'] }), '', 'not an episodic ask');
});

// ── v21: Teach & Quiz ────────────────────────────────────────────────────────

Deno.test('lessonTopic reads "teach me about X" and guards the reserved lanes', () => {
  eq(lessonTopic('teach me about photosynthesis'), 'photosynthesis', 'plain');
  eq(lessonTopic('navi, teach me about the solar system'), 'the solar system', 'navi prefix, article kept for display');
  eq(lessonTopic('teach me about yourself'), null, 'personal');
  eq(lessonTopic('teach me about prophet dian'), null, 'reserved');
  eq(lessonTopic('learn that the sky is blue'), null, 'teaching NAVI, not a lesson');
});

Deno.test('buildLesson structures points from across the text', () => {
  const text = PASTED + ' ' + PASTED.replace(/ocean/g, 'sea');
  const out = buildLesson('the ocean', text);
  if (!out.includes('lesson on the ocean')) throw new Error(`header: ${out}`);
  if (!out.includes('1)') || !out.includes('2)')) throw new Error('not structured');
  if (!out.includes('tell me more')) throw new Error('no deepen invitation');
  eq(buildLesson('x', 'too short'), '', 'thin source rejected');
});

Deno.test('tryQuiz starts a quiz and grades answers with fuzzy matching', () => {
  const start = tryQuiz('quiz me on the bible', []);
  if (!start.includes('Q: ') || !/ark|Goliath|Genesis|Israelites/.test(start)) throw new Error(`start: ${start}`);

  const hist = [
    { role: 'user' as const, content: 'quiz me on the bible' },
    { role: 'assistant' as const, content: 'Quiz time. Answer straight — I\'ll keep score in spirit.\n\nQ: Who built the ark that survived the great flood?' },
  ];
  const right = tryQuiz('noah', hist);
  if (!right.startsWith('Correct — Noah.')) throw new Error(`grade right: ${right}`);
  if (!right.includes('Q: ')) throw new Error('no next question');
  const wrong = tryQuiz('moses', hist);
  if (!wrong.startsWith('Not quite — the answer is Noah.')) throw new Error(`grade wrong: ${wrong}`);
  const skip = tryQuiz('idk', hist);
  if (!skip.startsWith("No stress — it's Noah.")) throw new Error(`skip: ${skip}`);
  const stop = tryQuiz('stop', hist);
  if (!stop.includes('quiz mode closed')) throw new Error(`stop: ${stop}`);
  eq(tryQuiz('what is the capital of france?', hist), '', 'subject change falls through');
  eq(tryQuiz('noah', []), '', 'no pending quiz');
});

// ── v22: linear equations + richer stats ─────────────────────────────────────

Deno.test('tryEquation solves linear equations in one variable', () => {
  eq(tryEquation('solve 3x + 5 = 20'), 'x = 5', 'basic');
  eq(tryEquation('solve 5x + 2 = 3x + 10'), 'x = 4', 'variable on both sides');
  eq(tryEquation('what is x if 2x - 4 = 10?'), 'x = 7', 'what-is-x form');
  eq(tryEquation('solve for y: 2y = 9'), 'y = 4.5', 'solve-for + decimal result');
  eq(tryEquation('solve 10 - x = 4'), 'x = 6', 'negative coefficient');
  const none = tryEquation('solve 2x + 1 = 2x + 5');
  if (!none || !none.includes('no solution')) throw new Error(`no-solution: ${none}`);
  const all = tryEquation('solve x + 1 = x + 1');
  if (!all || !all.includes('every x')) throw new Error(`identity: ${all}`);
  eq(tryEquation('solve my problem = life'), null, 'words rejected');
  eq(tryEquation('solve 2x + 3y = 6'), null, 'two variables rejected');
  eq(tryEquation('how do i solve conflict at work'), null, 'no equation at all');
});

Deno.test('tryListStats handles median and range', () => {
  eq(tryListStats('median of 3, 9, 5'), 'The median of 3, 9 and 5 is 5.', 'odd median');
  eq(tryListStats('median of 1, 2, 3, 4'), 'The median of 1, 2, 3 and 4 is 2.5.', 'even median');
  eq(tryListStats('range of 4, 19, 7'), 'The range of 4, 19 and 7 is 15 (from 4 to 19).', 'range');
});

// ── v22: vocabulary engine ────────────────────────────────────────────────────

Deno.test('parseDefineAsk reads every ask shape and guards reserved words', () => {
  eq(parseDefineAsk('define eloquent')?.word, 'eloquent', 'define');
  eq(parseDefineAsk('what does serendipity mean?')?.word, 'serendipity', 'what-does-mean');
  eq(parseDefineAsk('meaning of "grace"')?.kind, 'define', 'quoted meaning-of');
  eq(parseDefineAsk('synonyms for happy')?.kind, 'synonyms', 'synonyms');
  eq(parseDefineAsk('another word for angry')?.kind, 'synonyms', 'another word');
  eq(parseDefineAsk('opposite of brave')?.kind, 'antonyms', 'opposite');
  eq(parseDefineAsk('use resilient in a sentence')?.kind, 'sentence', 'sentence');
  eq(parseDefineAsk('navi, define perseverance')?.word, 'perseverance', 'navi prefix');
  eq(parseDefineAsk('what does navi mean'), null, 'reserved word');
  eq(parseDefineAsk('what does the bible say about hope mean'), null, 'phrase rejected');
  eq(parseDefineAsk('define the terms of the contract'), null, 'multi-word rejected');
});

const DICT_FIXTURE: DictEntry = {
  word: 'eloquent',
  meanings: [
    {
      partOfSpeech: 'adjective',
      definitions: [
        { definition: 'Fluent, persuasive and articulate in speech.', example: 'She gave an eloquent speech.', synonyms: ['articulate'] },
      ],
      synonyms: ['fluent', 'expressive'],
      antonyms: ['inarticulate'],
    },
  ],
};

Deno.test('formatDictionary renders define, synonyms, antonyms and sentence shapes', () => {
  const def = formatDictionary({ word: 'eloquent', kind: 'define' }, DICT_FIXTURE);
  if (!def.includes('(adjective) Fluent, persuasive')) throw new Error(`define: ${def}`);
  if (!def.includes('Example: "She gave an eloquent speech."')) throw new Error(`example: ${def}`);
  if (!def.includes('Close words: fluent, expressive, articulate')) throw new Error(`close: ${def}`);
  const syn = formatDictionary({ word: 'eloquent', kind: 'synonyms' }, DICT_FIXTURE);
  eq(syn, 'Words close to "eloquent": fluent, expressive, articulate.', 'synonyms');
  const ant = formatDictionary({ word: 'eloquent', kind: 'antonyms' }, DICT_FIXTURE);
  eq(ant, 'Opposites of "eloquent": inarticulate.', 'antonyms');
  const sen = formatDictionary({ word: 'eloquent', kind: 'sentence' }, DICT_FIXTURE);
  eq(sen, 'Here\'s "eloquent" in a sentence: "She gave an eloquent speech."', 'sentence');
});

// ── v22: reminders ────────────────────────────────────────────────────────────

const T0 = { y: 2026, m: 7, d: 8 }; // a Wednesday

Deno.test('parseWhen reads date phrases in SA time and strips them from the text', () => {
  eq(parseWhen('call mom tomorrow', T0).due, '2026-07-09', 'tomorrow');
  eq(parseWhen('call mom tomorrow', T0).text, 'call mom', 'phrase stripped');
  eq(parseWhen('submit the mix in 3 days', T0).due, '2026-07-11', 'in N days');
  eq(parseWhen('pray for the team on friday', T0).due, '2026-07-10', 'weekday ahead');
  eq(parseWhen('rest next week', T0).due, '2026-07-15', 'next week');
  eq(parseWhen('buy gifts on 25 december', T0).due, '2026-12-25', 'day month');
  eq(parseWhen('renew the domain on january 2', T0).due, '2027-01-02', 'passed date rolls to next year');
  eq(parseWhen('drink water', T0).due, '', 'no date');
});

Deno.test('tryReminder adds, lists, ticks off and clears', () => {
  const added = tryReminder('remind me to call mom tomorrow', {}, T0);
  if (!added?.profile?.reminders?.length) throw new Error('add failed');
  eq(added.profile.reminders[0].text, 'call mom', 'text');
  eq(added.profile.reminders[0].due, '2026-07-09', 'due');
  if (!added.reply.includes('tomorrow')) throw new Error(`reply: ${added.reply}`);

  const stored: Profile = added.profile;
  const listed = tryReminder('what are my reminders?', stored, T0);
  if (!listed?.reply.includes('1. call mom')) throw new Error(`list: ${listed?.reply}`);

  const done = tryReminder('done with reminder 1', stored, T0);
  eq(done?.profile?.reminders?.length, 0, 'ticked off');

  const cleared = tryReminder('clear my reminders', stored, T0);
  eq(cleared?.profile?.reminders?.length, 0, 'cleared');

  eq(tryReminder('what should i do today', {}, T0), null, 'not a reminder ask');
  if (!isReminderAsk('remind me to stretch')) throw new Error('isReminderAsk');
});

Deno.test('addDueReminders surfaces due and undated ones, holds future ones', () => {
  const stored: Profile = { reminders: [
    { text: 'call mom', created: '2026-07-07', due: '2026-07-08' },
    { text: 'drink water', created: '2026-07-07' },
    { text: 'renew domain', created: '2026-07-07', due: '2026-12-25' },
  ] };
  const out = addDueReminders('Hey.', stored, T0);
  if (!out.includes('call mom (today)')) throw new Error(`due today: ${out}`);
  if (!out.includes('drink water')) throw new Error(`undated: ${out}`);
  if (out.includes('renew domain')) throw new Error(`future leaked: ${out}`);
  eq(addDueReminders('Hey.', { reminders: [{ text: 'renew domain', created: 'x', due: '2026-12-25' }] }, T0), 'Hey.', 'nothing due → untouched');
});

// ── v22: devotionals ──────────────────────────────────────────────────────────

Deno.test('verse of the day: ask detection and deterministic rotation', () => {
  if (!isVotdAsk('verse of the day')) throw new Error('bare ask');
  if (!isVotdAsk('Navi, what is the verse for the day?')) throw new Error('question ask');
  if (!isVotdAsk('give me the daily verse')) throw new Error('daily verse');
  if (isVotdAsk('my verse of the day is john 3:16 what do you think')) throw new Error('sentence must not match');
  const i = votdIndex(T0), j = votdIndex(T0);
  eq(i, j, 'same day same slot');
  if (i < 0 || i >= VOTD_ROTATION.length) throw new Error(`index range: ${i}`);
  if (votdIndex({ y: 2026, m: 7, d: 9 }) === i && votdIndex({ y: 2026, m: 7, d: 10 }) === i) {
    throw new Error('rotation never advances');
  }
  const out = formatVotd({ book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world…' }, 'You are loved first.');
  if (!out.startsWith('Your verse for today:')) throw new Error(`votd format: ${out}`);
  if (!out.includes('John 3:16 (KJV)')) throw new Error(`votd ref: ${out}`);
});

Deno.test('devotionTopic parses the ask; formatDevotional structures scripture + reflection + prayer', () => {
  eq(devotionTopic('devotional about hope'), 'hope', 'topic');
  eq(devotionTopic('write me a devotional on forgiveness'), 'forgiveness', 'write-me form');
  eq(devotionTopic('devotional'), '', 'general devotional');
  eq(devotionTopic('i read a devotional about hope yesterday'), null, 'mention in passing');
  eq(devotionTopic('tell me about hope'), null, 'not a devotional ask');
  const out = formatDevotional('hope', [{ book: 'Romans', chapter: 15, verse: 13, text: 'Now the God of hope fill you…' }]);
  if (!out.includes('Romans 15:13 (KJV)')) throw new Error(`scripture: ${out}`);
  if (!out.includes('hope')) throw new Error(`reflection topic: ${out}`);
  if (!out.includes('Pray this:')) throw new Error(`prayer close: ${out}`);
  eq(formatDevotional('hope', []), '', 'no verses → no devotional');
});

// ── v22: scripture memory coach ───────────────────────────────────────────────

const VERSE = { book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' };

Deno.test('memorizeRef reads the ask; activeMemoryRef recovers the verse from history', () => {
  const ref = memorizeRef('help me memorize John 3:16');
  eq(ref?.book, 'John', 'book');
  eq(ref?.verseStart, 16, 'verse');
  eq(memorizeRef('memorise psalm 23:1')?.book, 'Psalms', 'uk spelling + psalm');
  eq(memorizeRef('memorize John 3:16-18')?.verseEnd, 16, 'range collapses to one verse');
  eq(memorizeRef('i want to memorize my lines for the play'), null, 'not scripture');
  const hist = [
    { role: 'user' as const, content: 'memorize john 3:16' },
    { role: 'assistant' as const, content: startCoaching(VERSE) },
  ];
  const active = activeMemoryRef(hist);
  eq(active?.book, 'John', 'recovered book');
  eq(active?.verseStart, 16, 'recovered verse');
  eq(activeMemoryRef([{ role: 'assistant', content: 'Hey. What is on your mind?' }]), null, 'no marker → no mode');
});

Deno.test('gradeAttempt scores recall fuzzily and names missed words; blankOut keeps anchors', () => {
  const perfect = gradeAttempt(VERSE.text, VERSE.text);
  if (perfect.score < 0.99) throw new Error(`perfect: ${perfect.score}`);
  const partial = gradeAttempt(VERSE.text, 'For God so loved the world that he gave his only Son');
  if (partial.score <= 0.4 || partial.score >= 0.95) throw new Error(`partial: ${partial.score}`);
  if (!partial.missed.includes('begotten')) throw new Error(`missed: ${partial.missed.join(',')}`);
  const typo = gradeAttempt('the Lord is my shepherd', 'the lord is my sheperd');
  if (typo.score < 0.99) throw new Error(`typo tolerated: ${typo.score}`);
  const blanked = blankOut(VERSE.text);
  if (!blanked.startsWith('For')) throw new Error('first word kept');
  if (!blanked.includes('_')) throw new Error('has blanks');
  if (blanked.split(/\s+/).length !== VERSE.text.split(/\s+/).length) throw new Error('word count preserved');
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

Deno.test({ name: 'live: NAVI learns a fact and recalls it re-phrased', ignore: !LIVE, fn: async () => {
  const q = 'what is the ' + Date.now() + ' test protocol';
  await learnKnowledge(q, 'The test protocol is a NAVI self-check.', 'web');
  const rephrased = 'tell me about the ' + q.replace('what is the ', '');
  const out = await recallKnowledge(rephrased);
  if (!out?.answer.includes('self-check')) throw new Error(`recall failed: ${JSON.stringify(out)}`);
}});

Deno.test({ name: 'live: an unanswered question is logged as a gap', ignore: !LIVE, fn: async () => {
  const q = 'what is the ' + Date.now() + ' unknowable thing';
  await logGap(q);
  const out = await recallKnowledge(q); // gaps are not answers
  eq(out, null, 'gap-not-recalled');
}});

// ── v23: memory & understanding ──────────────────────────────────────────────

Deno.test('v23: likes and dislikes extraction is negation-aware', () => {
  const p = extractProfile([], "i love jazz and i don't like mushrooms");
  eq(p.likes, ['jazz'], 'likes');
  eq(p.dislikes, ['mushrooms'], 'dislikes');
});

Deno.test('v23: pronoun objects and heavy states are never tastes', () => {
  eq(extractProfile([], 'i love you navi').likes, undefined, 'i love you');
  eq(extractProfile([], 'i hate my life').dislikes, undefined, 'i hate my life');
});

Deno.test('v23: a new love evicts an old dislike (and across merges)', () => {
  const p = extractProfile([{ role: 'user', content: 'i hate coffee' }], 'i love coffee now');
  eq(p.likes, ['coffee'], 'moved to likes');
  eq(p.dislikes, [], 'left dislikes');
  const merged = mergeProfiles({ dislikes: ['coffee'] }, { likes: ['coffee'] });
  eq(merged.likes, ['coffee'], 'merge likes');
  eq(merged.dislikes, [], 'merge evicts dislike');
});

Deno.test('v23: questions never assert a taste', () => {
  eq(extractProfile([], 'do i like mushrooms?').likes, undefined, 'question polluting likes');
  const p = extractProfile([{ role: 'user', content: "i don't like mushrooms" }], 'do i like mushrooms?');
  eq(p.dislikes, ['mushrooms'], 'stored dislike survives the question');
  eq(p.likes, undefined, 'no phantom like');
});

Deno.test('v23: negated statements are not captured', () => {
  eq(extractProfile([], 'my name is not dian').name, undefined, 'negated name');
  eq(extractProfile([], 'my name is actually dian').name, 'Dian', 'adverb name');
  eq(extractProfile([], 'my favourite colour is not blue').favorites, undefined, 'negated favourite');
});

Deno.test('v23: crisis language never becomes a goal or an acknowledgement', () => {
  eq(extractProfile([], 'i want to die').goals, undefined, 'die not a goal');
  eq(extractProfile([], 'i want to give up').goals, undefined, 'give up not a goal');
  eq(memoryAcknowledgement('i want to die', { goals: ['launch my app'] }), null, 'no ack on crisis');
  eq(memoryAcknowledgement('i want to give up', { goals: ['launch my app'] }), null, 'no stale-goal ack');
});

Deno.test('v23: mid-sentence age with comma is captured, distances are not', () => {
  eq(extractProfile([], "i'm 24, and life is busy").age, 24, 'comma age');
  eq(extractProfile([], "i'm 30 minutes away").age, undefined, 'not a distance');
});

Deno.test('v23: captureAck confirms multi-fact turns, stays quiet otherwise', () => {
  const ack = captureAck("my name is dian, i'm 24, and i'm from pretoria", {});
  if (!ack || !ack.includes('Dian') || !ack.includes('24') || !ack.includes('Pretoria')) {
    throw new Error(`multi-fact ack incomplete: ${ack}`);
  }
  eq(captureAck('i love jazz', {}), null, 'single fact stays with its own ack');
  eq(captureAck("what's my name?", { name: 'Dian' }), null, 'questions never ack');
});

Deno.test('v23: newProfileBits reports only what is new', () => {
  const bits = newProfileBits({ name: 'Dian' }, { name: 'Dian', age: 24, likes: ['jazz'] });
  eq(bits, ["you're 24", 'you love jazz'], 'only the new bits');
});

Deno.test('v23: goal completion moves the goal to wins', () => {
  const p = { goals: ['launch my app'] };
  const win = tryGoalDone('i finally launched my app!', p);
  if (!win) throw new Error('no win detected');
  eq(win.profile.goals, [], 'goal cleared');
  eq(win.profile.wins, ['launch my app'], 'win recorded');
  const itWin = tryGoalDone('i did it!', p);
  if (!itWin) throw new Error('"i did it" should complete the latest goal');
  eq(tryGoalDone('i finished my homework', p), null, 'unrelated completion ignored');
  eq(tryGoalDone('did i finish my app?', p), null, 'questions ignored');
});

Deno.test('v23: tastes and wins are recallable', () => {
  const p = { likes: ['jazz', 'coffee'], dislikes: ['mondays'], wins: ['launch my app'] };
  const likes = answerProfileQuestion('what do i like?', p);
  if (!likes?.includes('jazz and coffee')) throw new Error(`likes recall: ${likes}`);
  const dl = answerProfileQuestion('do i like mondays?', p);
  if (!dl?.includes("can't stand mondays")) throw new Error(`dislike check: ${dl}`);
  const wins = answerProfileQuestion('what have i achieved?', p);
  if (!wins?.includes('launch my app')) throw new Error(`wins recall: ${wins}`);
  const who = answerProfileQuestion('who am i?', { name: 'Dian', work: 'producer' });
  if (!who?.includes('Dian')) throw new Error(`who am i: ${who}`);
});

Deno.test('v23: tastes can be forgotten', () => {
  const forget = detectForget('forget that i like coffee');
  eq(forget, { kind: 'fact', text: 'i like coffee' }, 'forget shape');
  const { profile, reply } = applyForget({ likes: ['coffee', 'jazz'] }, forget!);
  eq(profile.likes, ['jazz'], 'coffee dropped');
  if (!reply.includes('coffee')) throw new Error(`forget reply: ${reply}`);
});

Deno.test('v23: life events parse date and subject', () => {
  const today = { y: 2026, m: 7, d: 8 }; // a Wednesday
  eq(parseLifeEvent('i have an exam on friday', today), { text: 'exam', date: '2026-07-10' }, 'exam friday');
  eq(parseLifeEvent('my interview is tomorrow', today), { text: 'interview', date: '2026-07-09' }, 'interview tomorrow');
  eq(parseLifeEvent('do i have an exam on friday?', today), null, 'questions ignored');
  eq(parseLifeEvent('my birthday is 12 march', today), null, 'birthday belongs to memory');
  eq(parseLifeEvent('i am tired tonight', today), null, 'moods are not events');
});

Deno.test('v23: life events are captured, listed, and dated on ask', () => {
  const today = { y: 2026, m: 7, d: 8 };
  const turn = tryLifeEvent('i have an exam on friday', {}, today);
  if (!turn?.profile?.events) throw new Error('event not captured');
  eq(turn.profile.events, [{ text: 'exam', date: '2026-07-10' }], 'event stored');
  const stored = turn.profile;
  const up = tryLifeEvent("what's coming up?", stored, today);
  if (!up?.reply.includes('exam')) throw new Error(`upcoming: ${up?.reply}`);
  const when = tryLifeEvent('when is my exam?', stored, today);
  if (!when?.reply.includes('in 2 days')) throw new Error(`when ask: ${when?.reply}`);
  eq(tryLifeEvent('when is my birthday?', stored, today), null, 'birthday falls through');
});

Deno.test('v23: passed events get a follow-up and leave the list; day-of gets a heads-up', () => {
  const today = { y: 2026, m: 7, d: 8 };
  const past = addEventFollowUps('Hello.', { events: [{ text: 'exam', date: '2026-07-06' }] }, today);
  if (!past.response.includes('how did your exam go?')) throw new Error(`follow-up: ${past.response}`);
  eq(past.events, [], 'past event released');
  const dayOf = addEventFollowUps('Hello.', { events: [{ text: 'exam', date: '2026-07-08' }] }, today);
  if (!dayOf.response.includes('TODAY')) throw new Error(`day-of: ${dayOf.response}`);
  eq(dayOf.events, undefined, 'day-of event stays');
});

// ── v24: execution upgrades ───────────────────────────────────────────────────

Deno.test('v24: normalizeMessage fixes engine-gating typos', () => {
  eq(normalizeMessage('remind me to call mom tommorow'), 'remind me to call mom tomorrow', 'tommorow');
  eq(normalizeMessage('whens my exam'), "when's my exam", 'whens');
  eq(normalizeMessage('i cant stand traffic'), "i can't stand traffic", 'cant');
  eq(normalizeMessage('wat is teh capital of france'), 'what is the capital of france', 'wat/teh');
  eq(normalizeMessage('Dont forget my birthdya'), "Don't forget my birthday", 'capitalisation kept');
  eq(normalizeMessage('remeber that im 24'), "remember that i'm 24", 'remeber/im');
  eq(normalizeMessage('u r great'), 'you r great', 'u expanded, bare r untouched');
});

Deno.test('v24: normalizeMessage never touches real words or clean text', () => {
  eq(normalizeMessage('i feel ill and its fine'), 'i feel ill and its fine', 'ill/its untouched');
  eq(normalizeMessage('what is the weather'), 'what is the weather', 'clean text unchanged');
  eq(normalizeMessage('my name is Tim'), 'my name is Tim', 'names untouched');
});

Deno.test('v24: expandFollowUp swaps numbers into the previous frame', () => {
  const h = (q: string) => [{ role: 'user' as const, content: q }];
  eq(expandFollowUp('and of 500?', h('what is 17% of 240?')), 'what is 17% of 500?', 'prep number swap');
  eq(expandFollowUp('and 30?', h('what is 25 + 17')), 'what is 25 + 30?', 'bare number swaps last');
  eq(expandFollowUp('and 500?', h('how are you?')), null, 'no number in frame');
});

Deno.test('v24: expandFollowUp swaps entities into the previous frame', () => {
  const h = (q: string) => [{ role: 'user' as const, content: q }];
  eq(expandFollowUp('what about germany?', h('what is the capital of france?')), 'what is the capital of germany?', 'trailing prep object');
  eq(expandFollowUp('and in london?', h('what time is it?')), 'what time is it in london?', 'prep phrase appended');
  eq(expandFollowUp('and desmond tutu?', h('who is nelson mandela?')), 'who is desmond tutu?', 'copula object swap');
});

Deno.test('v24: expandFollowUp stays out of everything else', () => {
  const h = (q: string) => [{ role: 'user' as const, content: q }];
  eq(expandFollowUp('and you?', h('how are you?')), null, 'small talk untouched');
  eq(expandFollowUp('germany?', h('what is the capital of france?')), null, 'lead word required');
  eq(expandFollowUp('and my life?', h('what is the capital of france?')), null, 'emotional never rewritten');
  eq(expandFollowUp('And God said let there be light', [{ role: 'user' as const, content: 'practice' }]), null, 'recitals untouched');
  eq(expandFollowUp('and what is gravity?', h('what is the capital of france?')), 'what is gravity?', 'standalone remainder freed');
  eq(expandFollowUp('and of 500?', []), null, 'no history, no frame');
});

Deno.test('v24: splitIntents divides command+command and command+question', () => {
  eq(
    splitIntents('remind me to call mom tomorrow and give me a verse about hope'),
    ['remind me to call mom tomorrow', 'give me a verse about hope'],
    'command + command',
  );
  eq(
    splitIntents('what is 2+2 and define hope'),
    ['what is 2+2', 'define hope'],
    'question + command',
  );
  eq(
    splitIntents('What is 2+2? Give me a verse about hope.'),
    ['What is 2+2', 'Give me a verse about hope'],
    'sentence split',
  );
  eq(
    splitIntents('solve 3x + 5 = 20 and give me a verse about peace and remind me to pray tonight'),
    ['solve 3x + 5 = 20', 'give me a verse about peace', 'remind me to pray tonight'],
    'three parts',
  );
});

Deno.test('v24: splitIntents never divides what belongs together', () => {
  eq(splitIntents('remind me to call mom and dad tomorrow'), [], 'compound object');
  eq(splitIntents('give me a verse about hope and love'), [], 'topic pair');
  eq(splitIntents("i'm sad and i want to talk"), [], 'emotional stays whole');
  eq(splitIntents('who is tesla and what did he invent'), [], 'pure factual pair is the reasoning engine lane');
  eq(splitIntents('what is gravity'), [], 'single ask');
  eq(splitIntents('i want to die and i need help'), [], 'crisis never split');
});
