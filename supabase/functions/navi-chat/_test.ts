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
  captureAck, newProfileBits, tryGoalDone, pushMood, moodTrend,
} from './memory.ts';
import { parseLifeEvent, tryLifeEvent, addEventFollowUps } from './life.ts';
import { tryDates, isDatesAsk, addDateHeadsUps } from './dates.ts';
import { extractTopicEntity, resolveReference } from './context.ts';
import { tryAcknowledgment } from './acts.ts';
import { tryRepair } from './repair.ts';
import { tryRecall } from './recall.ts';
import { wantsMore, nextChunk } from './deepen.ts';
import {
  normalizeKey, detectTeach, detectFeedback, previousUserQuestion,
  recallKnowledge, learnKnowledge, logGap, isGapsAsk, tryGapsReport,
  tryGapsManage,
} from './learn.ts';
import { detectComparison, splitCompound, tryReason } from './reason.ts';
import { adaptTone, userIsTerse } from './tone.ts';
import { addCuriosity } from './curiosity.ts';
import { trySummarize, tryRewrite, rewriteMode, cleanEmailText } from './understand.ts';
import { parseCompose, tryCompose, parseWriteSlash, isWriteSlashAsk, WRITE_USAGE } from './compose.ts';
import { parsePlanGoal, stepsForGoal, tryPlan } from './plan.ts';
import { topicFrom, updateTopics, tryEpisodic } from './episodic.ts';
import { lessonTopic, buildLesson, tryQuiz } from './lesson.ts';
import { tryEquation } from './skills.ts';
import { parseDefineAsk, formatDictionary, type DictEntry } from './define.ts';
import { parseWhen, tryReminder, addDueReminders, isReminderAsk, tryEscalate, reminderEscalation, parseEvery, nextOccurrence } from './remind.ts';
import { votdIndex, isVotdAsk, devotionTopic, formatVotd, formatDevotional, VOTD_ROTATION } from './devotion.ts';
import { memorizeRef, activeMemoryRef, gradeAttempt, blankOut, startCoaching } from './memorize.ts';
import { normalizeMessage } from './normalize.ts';
import { expandFollowUp } from './followup.ts';
import { splitIntents } from './execute.ts';
import {
  parseWorkflowCreate, parseWorkflowRun, parseWorkflowDelete,
  parseTriggerSet, parseMissionStart, parseDailySet, tryAgent, runDailyWorkflows,
  missionNudge, evalCondition, parseConditionStep, parseMissionQueue,
  parseWorkflowShow, parseWorkflowStepEdit, parseWorkflowStepMove, parseWorkflowRename,
  parseWorkflowPreview,
  parseOtherwiseStep, parseWorkflowPause, parseWorkflowResume, isPaused,
  parseLastRun, parseWorkflowRunAgain, parseMissionDeadline, isAgentAsk,
} from './agent.ts';
import { tryHabit, sparkline, streakLine } from './habit.ts';
import { isBriefingAsk, buildBriefing, tryBriefing, worldLine } from './brief.ts';
import { tryTasks, isTasksAsk, buildIcs, deviceReceipts } from './tasks.ts';
import { isReviewAsk, buildReview, tryReview, reviewOffer } from './review.ts';
import { parseVisionAdd, parseVisionRemove, isVisionListAsk, tryVision } from './vision.ts';
import { parseCleanupAsk, isChatCountAsk, tryChats } from './chats.ts';
import {
  parseMailDraft, isDraftListAsk, parseDraftDelete, parseDraftSend, tryMail,
  parseDraftSendLater, isInboxAsk, parseMailReply, isScheduledListAsk,
  parseScheduledCancel, parseSendWhen, runDueSends,
  parseMailSlash, isMailSlashAsk, isInboxDigestAsk, isSendStep,
  parseMailDigestOne,
} from './mail.ts';
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
  // v40: letter became a real kind.
  const l = parseCompose('write me a letter to the president');
  eq(l?.kind, 'letter', 'letter kind (v40)');
  eq(l?.recipient, 'the president', 'letter recipient');
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

// ── v40: the muse round — /write + the new creative kinds ────────────────────

Deno.test('parseWriteSlash reads kind, topic, and recipient from a /write prompt', () => {
  const p = parseWriteSlash('/write a poem about hope');
  eq(typeof p === 'object' && p ? p.kind : null, 'poem', 'named kind honoured');
  eq(typeof p === 'object' && p ? p.topic : '', 'hope', 'topic extracted');
  const s = parseWriteSlash('/write about the ocean at night');
  eq(typeof s === 'object' && s ? s.kind : null, 'story', 'no kind defaults to story');
  eq(typeof s === 'object' && s ? s.topic : '', 'the ocean at night', 'about-topic kept');
  const free = parseWriteSlash('/write a dragon who was afraid of fire');
  eq(typeof free === 'object' && free ? free.kind : null, 'story', 'bare prompt is a story');
  eq(typeof free === 'object' && free ? free.topic : '', 'dragon who was afraid of fire', 'whole prompt is the topic');
  const letter = parseWriteSlash('/write to my future self');
  eq(typeof letter === 'object' && letter ? letter.kind : null, 'letter', 'to-someone with no kind is a letter');
  eq(typeof letter === 'object' && letter ? letter.recipient : '', 'my future self', 'letter recipient');
  eq(parseWriteSlash('write me a poem about hope'), null, 'no slash, not ours');
});

Deno.test('/write is taught when malformed and steps aside on crisis', () => {
  eq(parseWriteSlash('/write'), 'malformed', 'bare command is malformed');
  eq(parseWriteSlash('/write/'), 'malformed', 'empty slash form is malformed');
  eq(tryCompose('/write'), WRITE_USAGE, 'malformed is taught, never dropped');
  eq(parseWriteSlash('/write a story about how i want to die'), 'crisis', 'crisis prompt detected');
  eq(tryCompose('/write a story about how i want to die'), '', 'crisis steps aside for the crisis nodes');
  eq(tryCompose('what is /write?'), WRITE_USAGE, 'asking about the command teaches it');
  eq(tryCompose('/write help'), WRITE_USAGE, 'help ask is usage, never a story about help');
  eq(tryCompose('how do i use /write'), WRITE_USAGE, 'how-to ask teaches it');
});

Deno.test('tryCompose renders /write pieces and the new kinds', () => {
  const story = tryCompose('/write a story about a lion who lost his roar');
  if (!story.startsWith(`Here's your story:`)) throw new Error(`story opener: ${story}`);
  if (!story.toLowerCase().includes('a lion who lost his roar')) throw new Error(`story topic: ${story}`);
  eq(tryCompose('/write a story about a lion who lost his roar'), story, 'deterministic: same ask, same piece');
  const song = tryCompose('/write a song about new beginnings');
  if (!song.includes('(Chorus)') || !song.toLowerCase().includes('new beginnings')) throw new Error(`song: ${song}`);
  const poem = tryCompose('/write a poem about fire and faith');
  if (!poem.startsWith(`Here's your poem:`) || !poem.toLowerCase().includes('fire and faith')) throw new Error(`poem with and: ${poem}`);
  const speech = tryCompose('write me a speech about perseverance');
  if (!speech.toLowerCase().includes('perseverance')) throw new Error(`speech: ${speech}`);
  const quote = tryCompose('write me a quote about success');
  if (!quote.toLowerCase().includes('success')) throw new Error(`quote: ${quote}`);
  eq(parseCompose('give me a quote from the bible'), null, 'bible quotes stay on the Bible path');
});

Deno.test('isWriteSlashAsk guards prompts; ordinary conversation untouched', () => {
  eq(isWriteSlashAsk('/write a story about fire and faith then hope'), true, 'slash ask detected');
  eq(isWriteSlashAsk('  /write a poem'), true, 'leading space tolerated');
  eq(isWriteSlashAsk('i write in my journal every day'), false, 'plain sentence is not ours');
  eq(tryCompose('i write in my journal every day'), '', 'journal talk stays conversation');
  eq(tryCompose('how do i write a cv'), '', 'question stays conversation');
});

// ── v48: the anthology round — multi-piece asks, new kinds, assembled songs ──

Deno.test('v48: multi-piece asks come back numbered and distinct', () => {
  const p = parseCompose('write me 3 captions about the gym');
  eq(p?.kind, 'caption', 'count then kind still parses');
  eq(p?.count, 3, 'count read');
  eq(p?.topic, 'the gym', 'topic survives the count');
  const out = tryCompose('write me 3 captions about the gym');
  if (!out.includes('1) ') || !out.includes('2) ') || !out.includes('3) ')) throw new Error(`numbered: ${out}`);
  const items = out.split('\n\n').filter(l => /^\d\) /.test(l));
  eq(new Set(items).size, 3, 'all three are distinct');
  eq(tryCompose('write me 3 captions about the gym'), out, 'deterministic');
  const words = parseCompose('give me four quotes about discipline');
  eq(words?.count, 4, 'word counts parse too');
});

Deno.test('v48: counts clamp honestly and long kinds stay one at a time', () => {
  const many = tryCompose('/write 9 quotes about focus');
  const items = many.split('\n\n').filter(l => /^\d\) /.test(l));
  eq(items.length, 6, 'clamped to the bank');
  if (!many.includes('whole shelf')) throw new Error(`clamp note missing: ${many}`);
  const story = tryCompose('write me 3 stories about the sea');
  if (!story.includes('one at a time')) throw new Error(`long-kind note: ${story}`);
  if (story.includes('2) ')) throw new Error(`long kind must not batch: ${story}`);
  eq(tryCompose('i wrote 3 songs last year'), '', 'past-tense mention stays conversation');
});

Deno.test('v48: new kinds — congrats, comfort, rap ("rap song" is a rap)', () => {
  const c = parseCompose('write me a congratulations message for thandi');
  eq(c?.kind, 'congrats', 'congrats kind');
  eq(c?.recipient, 'thandi', 'congrats recipient');
  const congrats = tryCompose('write me a congratulations message for thandi');
  if (!congrats.toLowerCase().includes('congratulations') || !congrats.includes('Thandi')) throw new Error(`congrats: ${congrats}`);
  const s = parseCompose('write a sympathy message for my aunt');
  eq(s?.kind, 'comfort', 'sympathy is comfort');
  const comfort = tryCompose('write a sympathy message for my aunt');
  if (!comfort.toLowerCase().includes('my aunt')) throw new Error(`comfort recipient: ${comfort}`);
  eq(parseCompose('write me a rap about the grind')?.kind, 'rap', 'rap kind');
  eq(parseCompose('write me a rap song about the grind')?.kind, 'rap', 'rap song is a rap, not a song');
  const rap = tryCompose('/write a rap about the grind');
  if (!rap.includes('the grind')) throw new Error(`rap topic: ${rap}`);
});

Deno.test('v48: songs are assembled — verse/chorus/verse 2/bridge, chorus reprised', () => {
  const song = tryCompose('/write a song about new beginnings');
  for (const part of ['(Verse 1)', '(Chorus)', '(Verse 2)', '(Bridge)', '(Chorus — one more time)']) {
    if (!song.includes(part)) throw new Error(`missing ${part}: ${song}`);
  }
  if (!song.toLowerCase().includes('new beginnings')) throw new Error(`topic: ${song}`);
  eq(tryCompose('/write a song about new beginnings'), song, 'deterministic: same ask, same song');
  const other = tryCompose('/write a song about leaving home');
  if (other === song) throw new Error('different topics should rotate the banks');
});

Deno.test('v48: letters sign with the stored name; crisis guards the conversational path', () => {
  const named = tryCompose('/write a letter to my future self', { name: 'Dian' });
  if (!/\nDian$/.test(named)) throw new Error(`letter should sign Dian: ${named.slice(-80)}`);
  const anon = tryCompose('/write a letter to my future self');
  if (!/\nme$/.test(anon)) throw new Error(`anonymous letter signs me: ${anon.slice(-80)}`);
  eq(parseCompose('write me a story about how i want to die'), null, 'crisis phrasing is never a topic');
  eq(tryCompose('write me a story about how i want to die'), '', 'conversational crisis steps aside too');
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
  if (!out.response.includes('call mom (today)')) throw new Error(`due today: ${out.response}`);
  if (!out.response.includes('drink water')) throw new Error(`undated: ${out.response}`);
  if (out.response.includes('renew domain')) throw new Error(`future leaked: ${out.response}`);
  eq(out.reminders, undefined, 'no recurring rows → no rolled list');
  eq(addDueReminders('Hey.', { reminders: [{ text: 'renew domain', created: 'x', due: '2026-12-25' }] }, T0).response, 'Hey.', 'nothing due → untouched');
});

// ── v44: recurring reminders + snooze (the cadence round) ────────────────────

Deno.test('parseEvery reads cadences, strips them, and refuses impossible month days', () => {
  eq(parseEvery('pray every day'), { text: 'pray', every: 'day' }, 'every day');
  eq(parseEvery('each day drink water'), { text: 'drink water', every: 'day' }, 'each day, leading');
  eq(parseEvery('every monday call mom'), { text: 'call mom', every: 'monday' }, 'weekday leading');
  eq(parseEvery('submit the report every friday'), { text: 'submit the report', every: 'friday' }, 'weekday trailing');
  eq(parseEvery('pay rent on the 1st of every month'), { text: 'pay rent', every: 1 }, 'Nth of every month');
  eq(parseEvery('pay rent every month on the 15th'), { text: 'pay rent', every: 15 }, 'every month on the Nth');
  eq(parseEvery('pay rent every month'), { text: 'pay rent', every: 1 }, 'bare month defaults to the 1st');
  eq(parseEvery('pay rent on the 30th of every month'), { text: 'pay rent', badDay: 30 }, '29-31 refused');
  eq(parseEvery('join the daily standup'), { text: 'join the daily standup' }, 'bare "daily" is a topic, not a cadence');
  eq(parseEvery('call mom on friday'), { text: 'call mom on friday' }, '"on friday" without every/each stays one-off');
});

Deno.test('nextOccurrence: daily, weekly, monthly, with and without today', () => {
  eq(nextOccurrence('day', T0), '2026-07-08', 'daily includes today');
  eq(nextOccurrence('day', T0, true), '2026-07-09', 'daily after today');
  eq(nextOccurrence('wednesday', T0), '2026-07-08', 'same weekday includes today');
  eq(nextOccurrence('wednesday', T0, true), '2026-07-15', 'same weekday after today jumps a week');
  eq(nextOccurrence('monday', T0), '2026-07-13', 'next monday');
  eq(nextOccurrence(15, T0), '2026-07-15', 'month day still ahead');
  eq(nextOccurrence(1, T0), '2026-08-01', 'month day passed rolls a month');
  eq(nextOccurrence(8, T0), '2026-07-08', 'month day today, inclusive');
  eq(nextOccurrence(8, T0, true), '2026-08-08', 'month day today, exclusive');
  eq(nextOccurrence(15, { y: 2026, m: 12, d: 20 }), '2027-01-15', 'december rolls the year');
});

Deno.test('recurring reminders: add, list with cadence, done rolls, delete stops', () => {
  const added = tryReminder('remind me every monday to call mom', {}, T0);
  if (!added?.profile?.reminders?.length) throw new Error('recurring add failed');
  eq(added.profile.reminders[0], { text: 'call mom', created: '2026-07-08', due: '2026-07-13', every: 'monday' }, 'row shape');
  if (!added.reply.includes('every monday')) throw new Error(`reply names cadence: ${added.reply}`);

  const stored: Profile = added.profile;
  const listed = tryReminder('what are my reminders?', stored, T0);
  if (!listed?.reply.includes('every monday — next 2026-07-13')) throw new Error(`list shows cadence: ${listed?.reply}`);

  const done = tryReminder('done with reminder 1', stored, T0);
  eq(done?.profile?.reminders?.length, 1, 'done keeps a recurring reminder');
  eq(done?.profile?.reminders?.[0].due, '2026-07-20', 'done rolls past the pending occurrence');
  if (!done?.reply.includes('delete reminder 1')) throw new Error(`done points at delete: ${done?.reply}`);

  const deleted = tryReminder('delete reminder 1', stored, T0);
  eq(deleted?.profile?.reminders?.length, 0, 'delete stops it');
  if (!deleted?.reply.includes('Stopped')) throw new Error(`delete reply: ${deleted?.reply}`);

  const monthly = tryReminder('remind me to pay rent on the 1st of every month', {}, T0);
  eq(monthly?.profile?.reminders?.[0], { text: 'pay rent', created: '2026-07-08', due: '2026-08-01', every: 1 }, 'monthly row');
  const refused = tryReminder('remind me to pay rent on the 31st of every month', {}, T0);
  if (!refused?.reply.includes('1 to 28') || refused.profile) throw new Error(`31st must be refused with no save: ${refused?.reply}`);
});

Deno.test('a surfaced recurring reminder rolls forward; one-offs stay put', () => {
  const stored: Profile = { reminders: [
    { text: 'pray', created: '2026-07-01', due: '2026-07-08', every: 'day' },
    { text: 'call mom', created: '2026-07-07', due: '2026-07-08' },
  ] };
  const out = addDueReminders('Hey.', stored, T0);
  if (!out.response.includes('pray (every day — today)')) throw new Error(`recurring surfaced: ${out.response}`);
  if (!out.reminders) throw new Error('rolled list missing');
  eq(out.reminders[0].due, '2026-07-09', 'recurring rolled to tomorrow');
  eq(out.reminders[1], { text: 'call mom', created: '2026-07-07', due: '2026-07-08' }, 'one-off untouched');
});

Deno.test('snooze pushes a reminder out and teaches unknown phrasing', () => {
  const stored: Profile = { reminders: [{ text: 'call mom', created: '2026-07-07' }] };
  const bare = tryReminder('snooze reminder 1', stored, T0);
  eq(bare?.profile?.reminders?.[0].due, '2026-07-09', 'bare snooze means tomorrow');
  const friday = tryReminder('snooze reminder 1 until friday', stored, T0);
  eq(friday?.profile?.reminders?.[0].due, '2026-07-10', 'until friday');
  const days = tryReminder('push reminder 1 for 3 days', stored, T0);
  eq(days?.profile?.reminders?.[0].due, '2026-07-11', 'for N days');
  const week = tryReminder('postpone reminder 1 for a week', stored, T0);
  eq(week?.profile?.reminders?.[0].due, '2026-07-15', 'for a week');
  const unknown = tryReminder('snooze reminder 1 until the cows come home', stored, T0);
  if (!unknown?.reply.includes('until tomorrow') || unknown.profile) throw new Error(`unknown phrase teaches: ${unknown?.reply}`);
  const past = tryReminder('snooze reminder 1 until today', stored, T0);
  if (!past?.reply.includes('after today') || past.profile) throw new Error(`today refused: ${past?.reply}`);
  const missing = tryReminder('snooze reminder 4', stored, T0);
  if (!missing?.reply.includes('only have 1 reminder') || missing.profile) throw new Error(`out of range: ${missing?.reply}`);
  if (!isReminderAsk('snooze reminder 2 until friday')) throw new Error('isReminderAsk covers snooze');
});

Deno.test('crisis phrasing is never stored as a reminder, and recurring rows never escalate', () => {
  eq(tryReminder('remind me to kill myself tomorrow', {}, T0), null, 'crisis add steps aside');
  eq(tryReminder('remind me every day that i want to die', {}, T0), null, 'crisis recurring steps aside');
  const p: Profile = { reminders: [{ text: 'pray', created: '2026-07-01', due: '2026-07-08', every: 'day' }] };
  eq(reminderEscalation(p, '2026-07-08'), null, 'a cadence IS the promotion — no escalation offer');
});

// ── v45: yearly reminders + the special-dates book (the almanac round) ────────

Deno.test('v45: parseEvery reads yearly cadences in every order and refuses impossible dates', () => {
  eq(parseEvery('wish mom happy birthday on 3 august every year'), { text: 'wish mom happy birthday', every: { month: 8, day: 3 } }, 'date-first trailing');
  eq(parseEvery('every year on 3 august wish mom happy birthday'), { text: 'wish mom happy birthday', every: { month: 8, day: 3 } }, 'every-year leading');
  eq(parseEvery('every year on the 3rd of august wish mom happy birthday'), { text: 'wish mom happy birthday', every: { month: 8, day: 3 } }, 'ordinal + of');
  eq(parseEvery('renew the domain on august 3 every year'), { text: 'renew the domain', every: { month: 8, day: 3 } }, 'month-first order');
  eq(parseEvery('celebrate every year on 29 february'), { text: 'celebrate', badDate: { month: 2, day: 29 } }, '29 february refused');
  eq(parseEvery('celebrate on 31 april every year'), { text: 'celebrate', badDate: { month: 4, day: 31 } }, '31 april refused');
  eq(parseEvery('pray every year'), { text: 'pray', needsDate: true }, 'bare yearly needs its day');
  eq(parseEvery('pay rent every month on the 15th'), { text: 'pay rent', every: 15 }, 'monthly still parses after the yearly patterns');
});

Deno.test('v45: nextOccurrence rolls yearly dates across the year boundary', () => {
  eq(nextOccurrence({ month: 8, day: 3 }, T0), '2026-08-03', 'still ahead this year');
  eq(nextOccurrence({ month: 3, day: 12 }, T0), '2027-03-12', 'passed this year rolls to next');
  eq(nextOccurrence({ month: 7, day: 8 }, T0), '2026-07-08', 'the day itself, inclusive');
  eq(nextOccurrence({ month: 7, day: 8 }, T0, true), '2027-07-08', 'the day itself, exclusive, rolls a whole year');
});

Deno.test('v45: yearly reminders — add, list names the rhythm, done rolls a year, delete stops', () => {
  const added = tryReminder('remind me every year on 3 august to wish mom happy birthday', {}, T0);
  if (!added?.profile?.reminders?.length) throw new Error('yearly add failed');
  eq(added.profile.reminders[0], { text: 'wish mom happy birthday', created: '2026-07-08', due: '2026-08-03', every: { month: 8, day: 3 } }, 'row shape');
  if (!added.reply.includes('every year on 3 august')) throw new Error(`reply names cadence: ${added.reply}`);

  const stored: Profile = added.profile;
  const listed = tryReminder('what are my reminders?', stored, T0);
  if (!listed?.reply.includes('every year on 3 august — next 2026-08-03')) throw new Error(`list shows cadence: ${listed?.reply}`);

  const done = tryReminder('done with reminder 1', stored, T0);
  eq(done?.profile?.reminders?.[0].due, '2027-08-03', 'done rolls past the pending occurrence into next year');

  const deleted = tryReminder('delete reminder 1', stored, T0);
  eq(deleted?.profile?.reminders?.length, 0, 'delete stops it');

  const leap = tryReminder('remind me every year on 29 february to celebrate', {}, T0);
  if (!leap?.reply.includes('leap years') || leap.profile) throw new Error(`29 feb refused with no save: ${leap?.reply}`);
  const bare = tryReminder('remind me every year to pray', {}, T0);
  if (!bare?.reply.includes('needs its day') || bare.profile) throw new Error(`bare yearly teaches: ${bare?.reply}`);
});

Deno.test('v45: the special-dates book — add, recall with countdown, list, forget, clear', () => {
  const added = tryDates("my mom's birthday is on 3 august", {}, T0);
  if (!added?.profile?.dates?.length) throw new Error('add failed');
  eq(added.profile.dates[0], { what: "mom's birthday", month: 8, day: 3 }, 'row shape');
  if (!added.reply.includes('3 august') || !added.reply.includes('in 26 days')) throw new Error(`add reply: ${added.reply}`);

  let stored: Profile = added.profile;
  const anniv = tryDates('our wedding anniversary is 20 june', stored, T0);
  eq(anniv?.profile?.dates?.[1], { what: 'wedding anniversary', month: 6, day: 20 }, 'anniversary with qualifier');
  stored = anniv!.profile!;

  const when = tryDates("when is my mom's birthday?", stored, T0);
  if (!when?.reply.includes('3 august') || !when.reply.includes('in 26 days') || when.profile) throw new Error(`recall: ${when?.reply}`);
  const whenAnniv = tryDates('when is our anniversary?', stored, T0);
  if (!whenAnniv?.reply.includes('20 june')) throw new Error(`bare anniversary recall: ${whenAnniv?.reply}`);
  const unknown = tryDates("when is sarah's birthday?", stored, T0);
  if (!unknown?.reply.includes("don't have that date") || unknown.profile) throw new Error(`unknown teaches: ${unknown?.reply}`);

  const listed = tryDates('what special dates do i have?', stored, T0);
  if (!listed?.reply.includes("mom's birthday") || !listed.reply.includes('wedding anniversary')) throw new Error(`list: ${listed?.reply}`);

  const updated = tryDates("my mom's birthday is on 4 august", stored, T0);
  eq(updated?.profile?.dates?.length, 2, 'update replaces, never duplicates');
  if (!updated?.reply.startsWith('Updated')) throw new Error(`update reply: ${updated?.reply}`);

  const forgot = tryDates("forget my mom's birthday", stored, T0);
  eq(forgot?.profile?.dates?.length, 1, 'forget drops one');
  const cleared = tryDates('clear my special dates', stored, T0);
  eq(cleared?.profile?.dates?.length, 0, 'clear wipes the book');
});

Deno.test("v45: the user's OWN birthday and plain conversation never enter the book", () => {
  eq(tryDates('my birthday is on 12 march', {}, T0), null, 'own birthday stays memory.ts');
  eq(tryDates('when is my birthday?', {}, T0), null, 'own recall stays memory.ts');
  eq(tryDates('forget my birthday', {}, T0), null, 'own forget stays the memory field');
  eq(tryDates("my mom's birthday is always chaotic", {}, T0), null, 'no date, stays conversation');
  eq(tryDates('my exam is on friday', {}, T0), null, 'life events stay life.ts');
  eq(tryDates("my dead friend's birthday is on 3 august and i want to die", {}, T0), null, 'crisis steps aside');
  const bad = tryDates("my mom's birthday is on 31 april", {}, T0);
  if (!bad?.reply.includes("doesn't have a 31st") || bad.profile) throw new Error(`impossible date refused: ${bad?.reply}`);
  const leap = tryDates("my mom's birthday is on 29 february", {}, T0);
  if (!leap?.reply.includes('leap years') || leap.profile) throw new Error(`29 feb honest: ${leap?.reply}`);
  if (!isDatesAsk("my mom's birthday is on 3 august")) throw new Error('isDatesAsk covers adds');
  if (!isDatesAsk('what special dates do i have')) throw new Error('isDatesAsk covers list');
  if (isDatesAsk('my birthday is on 12 march')) throw new Error('own birthday is not a dates ask');
  if (isDatesAsk('what a special day this is')) throw new Error('conversation is not a dates ask');
});

Deno.test('v45: date heads-ups — today and tomorrow speak once per day, crisis never wrapped', () => {
  const book: Profile = { dates: [
    { what: "mom's birthday", month: 7, day: 8 },
    { what: 'wedding anniversary', month: 7, day: 9 },
    { what: "sam's birthday", month: 12, day: 25 },
  ] };
  const out = addDateHeadsUps('Hey.', book, T0);
  if (!out.response.includes("mom's birthday TODAY")) throw new Error(`today note: ${out.response}`);
  if (!out.response.includes('TOMORROW')) throw new Error(`tomorrow note: ${out.response}`);
  if (out.response.includes("sam's birthday")) throw new Error('a far date stays quiet');
  if (!out.dates) throw new Error('noted stamps missing');
  eq(out.dates[0].noted, '2026-07-08', 'today stamped');
  eq(out.dates[1].noted, '2026-07-08', 'tomorrow stamped');
  eq(out.dates[2].noted, undefined, 'far date unstamped');

  const again = addDateHeadsUps('Hey.', { dates: out.dates }, T0);
  eq(again, { response: 'Hey.' }, 'one note per day — the stamp holds');

  const crisis = addDateHeadsUps('Please call SADAG on 0800 567 567.', book, T0);
  eq(crisis.response, 'Please call SADAG on 0800 567 567.', 'crisis reply never wrapped');
});

Deno.test('v45: evalCondition sees events and special days — sync, free, closed', async () => {
  const spy = stubSources(0, 0, 0);
  const t = '2026-07-08';
  const p: Profile = { events: [{ text: 'exam', date: '2026-07-08' }, { text: 'gig', date: '2026-07-12' }] };
  eq(await evalCondition('i have an event today', p, t, EMAIL, spy.sources), true, 'event today');
  eq(await evalCondition('i have no events today', p, t, EMAIL, spy.sources), false, 'negation on the day');
  eq(await evalCondition('i have an event this week', { events: [{ text: 'gig', date: '2026-07-12' }] }, t, EMAIL, spy.sources), true, 'within 7 days');
  eq(await evalCondition('i have an event this week', { events: [{ text: 'gig', date: '2026-07-20' }] }, t, EMAIL, spy.sources), false, 'past the horizon');
  eq(await evalCondition('i have no events this week', {}, t, EMAIL, spy.sources), true, 'empty calendar');
  const book: Profile = { dates: [{ what: "mom's birthday", month: 7, day: 8 }] };
  eq(await evalCondition("it's a special day", book, t, EMAIL, spy.sources), true, 'the day itself');
  eq(await evalCondition("it's a special day", book, '2026-07-09', EMAIL, spy.sources), false, 'any other day');
  eq(await evalCondition("it isn't a special day", {}, t, EMAIL, spy.sources), true, 'negation, empty book');
  eq(await evalCondition('i have an event someday', p, t, EMAIL, spy.sources), null, 'the vocabulary stays closed');
  eq(spy.calls, [], 'event and special-day conditions never touch a source');
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

// ── v25: agentic workflows ────────────────────────────────────────────────────

const EMAIL = 'test@example.com';
// A stub runner standing in for answerIntent: echoes the step so tests can see
// execution order, and marks one specific step as unexecutable.
const stubRunner = (fail = '') => {
  const ran: string[] = [];
  const run = (part: string, _p: Profile) =>
    Promise.resolve(part === fail ? { reply: '' } : { reply: `[did: ${part}]` });
  return { ran, run: (part: string, p: Profile) => { ran.push(part); return run(part, p); } };
};

Deno.test('v25: parseWorkflowCreate reads named creations with then/comma steps', () => {
  eq(
    parseWorkflowCreate('create a workflow called morning: a verse about strength, then list my reminders, then encourage me'),
    { name: 'morning', steps: ['a verse about strength', 'list my reminders', 'encourage me'] },
    'called + then',
  );
  eq(
    parseWorkflowCreate('Hey Navi, make a night routine: a verse about peace, pray for me'),
    { name: 'night', steps: ['a verse about peace', 'pray for me'] },
    'name-first + commas + navi address',
  );
  eq(
    parseWorkflowCreate('create a workflow: a verse about hope then encourage me'),
    { name: '', steps: ['a verse about hope', 'encourage me'] },
    'unnamed creation surfaces empty name for the teach-the-syntax reply',
  );
  eq(parseWorkflowCreate('create a new workflow: what is 2+2'), { name: '', steps: ['what is 2+2'] }, '"new" never read as the name');
  eq(parseWorkflowCreate('give me a verse about hope'), null, 'ordinary ask is not a creation');
  eq(parseWorkflowCreate('i want to create a business'), null, 'goal talk is not a creation');
});

Deno.test('v25: steps keep natural "and" phrases whole and cap at 5', () => {
  eq(
    parseWorkflowCreate('create a workflow called calm: a verse about hope and love, then encourage me')!.steps,
    ['a verse about hope and love', 'encourage me'],
    'bare and never splits',
  );
  eq(
    parseWorkflowCreate('create a workflow called big: s one, s two, s three, s four, s five, s six')!.steps.length,
    5,
    'capped at 5 steps',
  );
});

Deno.test('v25: parseWorkflowRun / parseWorkflowDelete / parseTriggerSet', () => {
  eq(parseWorkflowRun('run my morning workflow'), { name: 'morning' }, 'run name-first');
  eq(parseWorkflowRun('please run workflow called morning'), { name: 'morning' }, 'run keyword-first');
  eq(parseWorkflowRun('start my night routine'), { name: 'night' }, 'routine synonym');
  eq(parseWorkflowRun('run my business'), null, 'needs the workflow word');
  eq(parseWorkflowDelete('delete my morning workflow'), 'morning', 'delete');
  eq(parseWorkflowDelete('forget the workflow called night'), 'night', 'forget form');
  eq(parseTriggerSet('when i say good morning, run my morning workflow'), { trigger: 'good morning', name: 'morning' }, 'trigger set');
  eq(parseTriggerSet('when i say hello there run my night routine'), { trigger: 'hello there', name: 'night' }, 'no comma');
});

Deno.test('v25: parseMissionStart reads goals and refuses crisis language', () => {
  eq(parseMissionStart('start a mission to launch my EP'), 'launch my ep', 'mission to');
  eq(parseMissionStart('new mission: get fit'), 'get fit', 'colon form');
  eq(parseMissionStart('start a mission to end my life'), null, 'crisis is never a mission');
  eq(parseMissionStart('what is a mission trip'), null, 'ordinary question');
});

Deno.test('v25: tryAgent creates, lists, runs, and deletes a workflow', async () => {
  const { ran, run } = stubRunner();
  let profile: Profile = {};

  const created = await tryAgent('create a workflow called morning: a verse about strength, then encourage me', EMAIL, profile, run);
  if (!created?.profile?.workflows) throw new Error('creation did not save a workflow');
  eq(created.profile.workflows[0].name, 'morning', 'saved under its name');
  eq(created.profile.workflows[0].steps.length, 2, 'both steps saved');
  profile = created.profile;

  const listed = await tryAgent('list my workflows', EMAIL, profile, run);
  if (!listed?.reply.includes('morning')) throw new Error('list must show the workflow');

  const runOut = await tryAgent('run my morning workflow', EMAIL, profile, run);
  eq(ran, ['a verse about strength', 'encourage me'], 'steps executed in order');
  if (!runOut?.reply.includes('[did: a verse about strength]')) throw new Error('step 1 answer missing');
  if (!runOut?.reply.includes('all 2 steps executed')) throw new Error('completion summary missing');

  const deleted = await tryAgent('delete my morning workflow', EMAIL, profile, run);
  eq(deleted?.profile?.workflows, [], 'workflow removed');
});

Deno.test('v25: tryAgent reports steps it could not execute', async () => {
  const { run } = stubRunner('encourage me');
  const profile: Profile = { workflows: [{ name: 'm', steps: ['a verse about strength', 'encourage me'], created: 'now' }] };
  const out = await tryAgent('run my m workflow', EMAIL, profile, run);
  if (!out?.reply.includes("I couldn't execute this one")) throw new Error('failed step must be reported');
  if (!out?.reply.includes('1 of 2 steps executed')) throw new Error('honest summary missing');
});

Deno.test('v25: trigger phrase auto-runs its workflow, exact match only', async () => {
  const { ran, run } = stubRunner();
  let profile: Profile = { workflows: [{ name: 'morning', steps: ['a verse about strength'], created: 'now' }] };

  const set = await tryAgent('when i say good morning, run my morning workflow', EMAIL, profile, run);
  if (!set?.profile?.workflows?.[0].trigger) throw new Error('trigger not stored');
  profile = set.profile;

  const fired = await tryAgent('Good morning!', EMAIL, profile, run);
  if (!fired) throw new Error('trigger phrase must fire the workflow');
  eq(ran, ['a verse about strength'], 'workflow ran on trigger');

  const notFired = await tryAgent('good morning to everyone at church', EMAIL, profile, run);
  eq(notFired, null, 'longer message is not the trigger');
});

Deno.test('v25: mission lifecycle — start, next, done, complete into wins', async () => {
  const { run } = stubRunner();
  let profile: Profile = {};

  const started = await tryAgent('start a mission to start a business', EMAIL, profile, run);
  if (!started?.profile?.mission) throw new Error('mission not stored');
  eq(started.profile.mission.steps.length, 6, 'business step bank used');
  eq(started.profile.mission.done, 0, 'starts at step 1');
  profile = started.profile;

  const next = await tryAgent("what's next", EMAIL, profile, run);
  if (!next?.reply.includes('1 of 6')) throw new Error("what's next must show the current step");

  const advanced = await tryAgent('done', EMAIL, profile, run);
  eq(advanced?.profile?.mission?.done, 1, '"done" advances the mission');
  profile = advanced!.profile!;

  const second = await tryAgent('start a mission to get fit', EMAIL, profile, run);
  if (!second?.reply.includes('already have an active mission')) throw new Error('one mission at a time');

  // Finish the remaining steps; completion moves the goal to wins.
  for (let i = 0; i < 4; i++) profile = (await tryAgent('done', EMAIL, profile, run))!.profile!;
  const finished = await tryAgent('done', EMAIL, profile, run);
  if (!finished?.reply.includes('MISSION COMPLETE')) throw new Error('completion must celebrate');
  eq(finished?.profile?.mission, undefined, 'mission cleared');
  eq(finished?.profile?.wins, ['start a business'], 'goal moved to wins');
});

Deno.test('v25: bare "done" and mission talk stay untouched without a mission', async () => {
  const { run } = stubRunner();
  eq(await tryAgent('done', EMAIL, {}, run), null, 'bare done falls through');
  eq(await tryAgent("what's next", EMAIL, {}, run), null, 'bare next falls through');
  const status = await tryAgent('mission status', EMAIL, {}, run);
  if (!status?.reply.includes('No active mission')) throw new Error('status without mission explains');
});

Deno.test('v25: anonymous users are pointed at sign-in, chat left alone', async () => {
  const { run } = stubRunner();
  const asked = await tryAgent('create a workflow called morning: a verse then encourage me', '', {}, run);
  if (!asked?.reply.includes('signed in')) throw new Error('agent ask must point at sign-in');
  eq(await tryAgent('good morning', '', {}, run), null, 'plain chat untouched');
  eq(await tryAgent('i want to start a business', '', {}, run), null, 'goal talk untouched');
});

Deno.test('v25: stepsForGoal picks the domain bank or the generic scaffold', () => {
  eq(stepsForGoal('start a business').length, 6, 'business lane');
  eq(stepsForGoal('learn to juggle flaming pins')[0].includes('done'), true, 'generic scaffold defines done');
});

// ── v26: daily rhythm — habits, daily workflows, mood trends ─────────────────

Deno.test('v26: habit create / log / streak arithmetic', () => {
  let profile: Profile = {};
  const created = tryHabit('track my habit: pray every day', profile, '2026-07-09');
  if (!created?.profile?.habits) throw new Error('habit not stored');
  eq(created.profile.habits[0].name, 'pray', '"every day" stripped from the name');
  profile = created.profile;

  const day1 = tryHabit('i did my prayer habit', profile, '2026-07-09');
  eq(day1?.profile?.habits?.[0].streak, 1, 'fuzzy name match (prayer→pray), day 1');
  profile = day1!.profile!;

  const again = tryHabit('i did my prayer habit', profile, '2026-07-09');
  eq(again?.profile, undefined, 'same day never double-counts');
  if (!again?.reply.includes('Already counted')) throw new Error('double log must say so');

  const day2 = tryHabit('habit done: pray', profile, '2026-07-10');
  eq(day2?.profile?.habits?.[0].streak, 2, 'next day extends the streak');
  profile = day2!.profile!;

  const broken = tryHabit('i did my prayer habit', profile, '2026-07-15');
  const h = broken?.profile?.habits?.[0];
  eq(h?.streak, 1, 'a gap restarts the streak');
  eq(h?.best, 2, 'best streak kept');
  eq(h?.total, 3, 'lifetime total kept');
  if (!broken?.reply.includes('Back on the horse')) throw new Error('broken streak gets grace, not guilt');
});

Deno.test('v26: habit status, delete, and guardrails', () => {
  const profile: Profile = { habits: [
    { name: 'pray', created: '2026-07-01', lastDone: '2026-07-09', streak: 5, best: 7, total: 20 },
    { name: 'read my bible', created: '2026-07-01', streak: 0, best: 0, total: 0 },
  ] };
  const status = tryHabit('how are my habits', profile, '2026-07-09');
  if (!status?.reply.includes('5-day streak (best 7, 20 total) — done today')) throw new Error('status line wrong: ' + status?.reply);

  const bare = tryHabit('i did my habit', profile, '2026-07-09');
  if (!bare?.reply.includes('Which one?')) throw new Error('bare log with 2 habits must ask which');

  const dropped = tryHabit('drop my bible habit', profile, '2026-07-09');
  eq(dropped?.profile?.habits?.length, 1, 'fuzzy delete');
  if (!dropped?.reply.includes('best streak 0')) throw new Error('drop must honour the record');

  eq(tryHabit('track my habit: hurt myself', profile), null, 'crisis is never a habit');
  eq(tryHabit('i did my homework', profile), null, 'plain sentences untouched');
  eq(tryHabit('what is a habit', profile), null, 'dictionary asks untouched');
});

Deno.test('v26: parseDailySet reads schedule on/off; daily shows in list', async () => {
  eq(parseDailySet('run my morning workflow every day'), { name: 'morning', daily: true }, 'daily on');
  eq(parseDailySet('make my morning routine daily'), { name: 'morning', daily: true }, 'make daily');
  eq(parseDailySet('stop running my morning workflow every day'), { name: 'morning', daily: false }, 'daily off');
  eq(parseDailySet('run my morning workflow'), null, 'plain run is not a schedule');

  const { run } = stubRunner();
  let profile: Profile = { workflows: [{ name: 'morning', steps: ['a verse about strength'], created: 'now' }] };
  const on = await tryAgent('run my morning workflow every day', EMAIL, profile, run);
  eq(on?.profile?.workflows?.[0].daily, true, 'daily stored');
  profile = on!.profile!;
  const listed = await tryAgent('list my workflows', EMAIL, profile, run);
  if (!listed?.reply.includes('runs daily')) throw new Error('list must show the schedule');
  const off = await tryAgent('stop running my morning workflow daily', EMAIL, profile, run);
  eq(off?.profile?.workflows?.[0].daily, undefined, 'daily cleared');
});

Deno.test('v26: runDailyWorkflows runs due dailies once per day', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'morning', steps: ['a verse about strength'], created: 'now', daily: true, lastRun: '2026-07-08' },
    { name: 'evening', steps: ['a verse about peace'], created: 'now' },
  ] };
  const out = await runDailyWorkflows(profile, run, '2026-07-09');
  if (!out) throw new Error('due daily must run');
  eq(ran, ['a verse about strength'], 'only the daily workflow ran');
  if (!out.report.includes('Your daily "morning" workflow')) throw new Error('report header missing');
  eq(out.profile.workflows?.[0].lastRun, '2026-07-09', 'lastRun stamped');

  eq(await runDailyWorkflows(out.profile, run, '2026-07-09'), null, 'never twice the same day');
});

Deno.test('v26: pushMood keeps one entry per day, capped and ordered', () => {
  const d = (n: number) => ({ y: 2026, m: 7, d: n });
  let moods = pushMood(undefined, 'low', d(1));
  moods = pushMood(moods, 'good', d(1));
  eq(moods, [{ mood: 'good', date: '2026-07-01' }], 'same day replaces');
  moods = pushMood(moods, 'stressed', d(2));
  eq(moods.length, 2, 'new day appends');
});

Deno.test('v26: moodTrend gives an honest read or nothing', () => {
  const today = { y: 2026, m: 7, d: 9 };
  eq(moodTrend({}, today), null, 'no data, no guess');
  const heavy: Profile = { moods: [
    { mood: 'low', date: '2026-07-05' }, { mood: 'stressed', date: '2026-07-07' }, { mood: 'low', date: '2026-07-08' },
  ] };
  const readHeavy = moodTrend(heavy, today)!;
  if (!readHeavy.includes('low on 2 days') || !readHeavy.includes('heavier stretch')) throw new Error('heavy read wrong: ' + readHeavy);
  const light: Profile = { moods: [
    { mood: 'good', date: '2026-07-06' }, { mood: 'good', date: '2026-07-08' },
  ] };
  if (!moodTrend(light, today)!.includes('good run')) throw new Error('light read wrong');
  const stale: Profile = { moods: [{ mood: 'low', date: '2026-01-01' }] };
  eq(moodTrend(stale, today), null, 'old entries do not speak for today');
});

Deno.test('v26: "how have i been feeling" is answered from the journal', () => {
  const profile: Profile = { moods: [
    { mood: 'good', date: todayISOForTest() }, // today, always within 14 days
  ] };
  const r = answerProfileQuestion('how have i been feeling lately?', profile);
  if (!r || !r.includes('good')) throw new Error('mood ask must read the journal: ' + r);
  const empty = answerProfileQuestion('how have i been feeling?', {});
  if (!empty || !empty.includes('how are you right now')) throw new Error('no data must ask, not guess');
});

function todayISOForTest(): string {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date()).split('-');
  return `${y}-${m}-${d}`;
}

// ── v27: agentic round 3 — topic slots, mission editing, nudges, briefing ────

Deno.test('v27: parseWorkflowRun reads a topic tail on both run forms', () => {
  eq(parseWorkflowRun('run my study workflow on grace'), { name: 'study', topic: 'grace' }, 'name-first + on');
  eq(parseWorkflowRun('run the workflow called study about the holy spirit'), { name: 'study', topic: 'the holy spirit' }, 'keyword-first + about');
  eq(parseWorkflowRun('please run my study routine with patience'), { name: 'study', topic: 'patience' }, 'routine + with');
  eq(parseWorkflowRun('run my study workflow'), { name: 'study' }, 'no topic stays plain');
});

Deno.test('v27: a topic fills every * slot when the workflow runs', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [{ name: 'study', steps: ['a verse about *', 'define *'], created: 'now' }] };
  const out = await tryAgent('run my study workflow on grace', EMAIL, profile, run);
  eq(ran, ['a verse about grace', 'define grace'], 'slots filled in every step');
  if (!out?.reply.includes('on "grace"')) throw new Error('run header must name the topic: ' + out?.reply);
});

Deno.test('v27: slotted workflows prompt without a topic and refuse daily/trigger runs', async () => {
  const { ran, run } = stubRunner();
  let profile: Profile = { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now' }] };

  const bare = await tryAgent('run my study workflow', EMAIL, profile, run);
  if (!bare?.reply.includes('* slot')) throw new Error('bare run must teach the topic form: ' + bare?.reply);
  eq(ran, [], 'nothing executed without a topic');

  const daily = await tryAgent('run my study workflow every day', EMAIL, profile, run);
  if (!daily?.reply.includes('* slot')) throw new Error('daily set must be refused: ' + daily?.reply);
  eq(daily?.profile, undefined, 'no daily flag saved');

  profile = { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now', trigger: 'study time' }] };
  const fired = await tryAgent('study time', EMAIL, profile, run);
  if (!fired?.reply.includes('* slot')) throw new Error('trigger must prompt, not run a literal *: ' + fired?.reply);
  eq(ran, [], 'trigger did not execute slotted steps');

  const skipped = await runDailyWorkflows(
    { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now', daily: true }] },
    run, '2026-07-09');
  eq(skipped, null, 'daily runner never auto-runs a slotted workflow');
});

Deno.test('v27: mission skip drops the current step, and skipping the last wraps', async () => {
  const { run } = stubRunner();
  let profile: Profile = { mission: { goal: 'get fit', steps: ['s1', 's2', 's3'], done: 1, created: 'now' } };

  const skipped = await tryAgent('skip this step', EMAIL, profile, run);
  eq(skipped?.profile?.mission?.steps, ['s1', 's3'], 'current step removed');
  eq(skipped?.profile?.mission?.done, 1, 'done count untouched');
  if (!skipped?.reply.includes('s3')) throw new Error('reply must hand over the next step: ' + skipped?.reply);

  profile = { mission: { goal: 'get fit', steps: ['s1', 's2'], done: 1, created: 'now' } };
  const last = await tryAgent('skip', EMAIL, profile, run);
  eq(last?.profile?.mission, undefined, 'skipping the last step closes the mission');
  eq(last?.profile?.wins, ['get fit'], 'the goal still lands on the wins list');

  const noMission = await tryAgent('skip', EMAIL, {}, run);
  eq(noMission, null, 'bare skip without a mission stays ordinary conversation');
});

Deno.test('v27: add a step extends the active mission plan', async () => {
  const { run } = stubRunner();
  const profile: Profile = { mission: { goal: 'get fit', steps: ['s1', 's2'], done: 0, created: 'now' } };
  const out = await tryAgent('add a step to my mission: buy running shoes', EMAIL, profile, run);
  eq(out?.profile?.mission?.steps, ['s1', 's2', 'buy running shoes'], 'step appended');
  if (!out?.reply.includes('step 3 of 3')) throw new Error('reply must place the new step: ' + out?.reply);
  eq(await tryAgent('add a step to my mission: buy shoes', EMAIL, {}, run), null, 'no mission, no add');
});

Deno.test('v27: missionNudge fires after 3 idle days, once per day, never fresh', () => {
  const mission = { goal: 'get fit', steps: ['s1', 's2'], done: 0, created: '2026-07-01T08:00:00Z', touched: '2026-07-05T08:00:00Z' };
  const nudged = missionNudge({ mission }, '2026-07-09');
  if (!nudged) throw new Error('4 idle days must nudge');
  if (!nudged.note.includes('get fit') || !nudged.note.includes('s1')) throw new Error('nudge must name goal and step: ' + nudged.note);
  eq(nudged.profile.mission?.nudged, '2026-07-09', 'nudge stamped');
  eq(missionNudge(nudged.profile, '2026-07-09'), null, 'never twice the same day');
  eq(missionNudge({ mission: { ...mission, touched: '2026-07-08T08:00:00Z' } }, '2026-07-09'), null, 'a fresh mission is left alone');
  eq(missionNudge({}, '2026-07-09'), null, 'no mission, no nudge');
  const legacy = missionNudge({ mission: { goal: 'g', steps: ['s'], done: 0, created: '2026-07-01T08:00:00Z' } }, '2026-07-09');
  if (!legacy) throw new Error('pre-v27 missions fall back to created');
});

Deno.test('v27: isBriefingAsk hits the briefing forms and nothing else', () => {
  for (const yes of ['brief me', 'my briefing', 'give me my daily briefing', "what's my status", 'catch me up', 'where do i stand', 'status report']) {
    if (!isBriefingAsk(yes)) throw new Error('should be a briefing ask: ' + yes);
  }
  for (const no of ['mission status', 'brief me on the roman empire', 'give me a status update on my order', 'briefly explain grace', 'how are my habits']) {
    if (isBriefingAsk(no)) throw new Error('should NOT be a briefing ask: ' + no);
  }
});

Deno.test('v27: buildBriefing compiles mission, habits, reminders, events, and wins', async () => {
  const today = '2026-07-09';
  const profile: Profile = {
    name: 'Dian',
    mission: { goal: 'launch my ep', steps: ['s1', 's2'], done: 1, created: 'now' },
    habits: [{ name: 'pray', created: today, lastDone: today, streak: 4, best: 7, total: 20 }],
    reminders: [{ text: 'call mom', created: 'now' }, { text: 'renew domain', created: 'now', due: '2026-08-01' }],
    events: [{ text: 'exam', date: '2026-07-12' }, { text: 'old thing', date: '2026-06-01' }],
    wins: ['finished the site'],
  };
  const b = buildBriefing(profile, today);
  for (const bit of ['Dian', 'launch my ep', 'step 2', 's2', 'pray: 4-day streak', 'call mom', '1 more scheduled', 'exam — in 3 days', 'finished the site']) {
    if (!b.includes(bit)) throw new Error(`briefing missing "${bit}":\n` + b);
  }
  if (b.includes('old thing')) throw new Error('past events must not appear');
  const empty = buildBriefing({}, today);
  if (!empty.includes('MISSION — none active')) throw new Error('empty profile still briefs honestly');
  eq((await tryBriefing('brief me', '', {}))?.reply.includes('signed in'), true, 'anonymous is asked to sign in');
  eq(await tryBriefing('tell me about grace', EMAIL, {}), null, 'ordinary asks pass through');
});

// ── v28: the weekly review ───────────────────────────────────────────────────

Deno.test('v28: isReviewAsk hits the review forms and nothing else', () => {
  for (const yes of ['review my week', 'weekly review', 'run my weekly review', 'how was my week', 'how did my week go', 'Navi, review my week!', 'give me the week in review']) {
    if (!isReviewAsk(yes)) throw new Error('should be a review ask: ' + yes);
  }
  for (const no of ['review my essay', 'how was my day', 'review', 'can you review this verse for me', 'my week was rough', 'brief me']) {
    if (isReviewAsk(no)) throw new Error('should NOT be a review ask: ' + no);
  }
});

Deno.test('v28: the first review sets the baseline and says so', () => {
  const today = '2026-07-09';
  const profile: Profile = {
    name: 'Dian',
    habits: [{ name: 'pray', created: '2026-07-01', lastDone: today, streak: 4, best: 7, total: 20 }],
    wins: ['finished the site'],
  };
  const { reply, profile: next } = buildReview(profile, today);
  if (!reply.includes('first weekly review') || !reply.includes('Baseline set')) throw new Error('first review must announce the baseline:\n' + reply);
  if (!reply.includes('pray: 4-day streak')) throw new Error('first review still shows current streaks:\n' + reply);
  eq(next.review?.date, today, 'snapshot stamped');
  eq(next.review?.habitTotals, { pray: 20 }, 'habit totals captured');
  eq(next.review?.wins, ['finished the site'], 'wins list captured');
});

Deno.test('v28: buildReview reports habit deltas, mission velocity, wins earned, reminders cleared', () => {
  const today = '2026-07-09';
  const profile: Profile = {
    mission: { goal: 'launch my ep', steps: ['s1', 's2', 's3', 's4'], done: 3, created: 'now' },
    habits: [
      { name: 'pray', created: '2026-06-01', lastDone: today, streak: 5, best: 7, total: 25 },
      { name: 'run', created: '2026-07-05', lastDone: today, streak: 2, best: 2, total: 2 },
    ],
    wins: ['finished the site', 'paid off the card'],
    reminders: [{ text: 'call mom', created: 'now' }],
    review: {
      date: '2026-07-02',
      habitTotals: { pray: 20, read: 9 },
      wins: ['finished the site'],
      reminders: 3,
      missionGoal: 'launch my ep',
      missionDone: 1,
    },
  };
  const { reply, profile: next } = buildReview(profile, today);
  for (const bit of [
    'since 2026-07-02',
    'moved 2 steps — now 3 of 4', 's4',
    'pray: kept 5 days since last review',
    'run: new since last review',
    'Dropped since last review: read',
    'WINS THIS WEEK: paid off the card',
    'down from 3 to 1 open',
  ]) {
    if (!reply.includes(bit)) throw new Error(`review missing "${bit}":\n` + reply);
  }
  eq(next.review?.date, today, 'snapshot re-stamped');
  eq(next.review?.missionDone, 3, 'mission position captured for next week');
  eq(next.review?.habitTotals, { pray: 25, run: 2 }, 'dropped habit leaves the snapshot');
});

Deno.test('v28: a finished mission is the headline, and mood shift compares the weeks', () => {
  const today = '2026-07-15';
  const finished: Profile = {
    wins: ['get fit'],
    review: { date: '2026-07-08', wins: [], reminders: 0, missionGoal: 'get fit', missionDone: 2 },
  };
  const r1 = buildReview(finished, today).reply;
  if (!r1.includes('FINISHED "get fit"')) throw new Error('completed mission must headline:\n' + r1);

  const lighter: Profile = {
    moods: [
      { mood: 'low', date: '2026-07-03' }, { mood: 'stressed', date: '2026-07-05' }, // last week
      { mood: 'good', date: '2026-07-12' }, { mood: 'good', date: '2026-07-14' },   // this week
    ],
  };
  const r2 = buildReview(lighter, today).reply;
  if (!r2.includes('a good week') || !r2.includes('Lighter than last week')) throw new Error('mood shift must compare weeks:\n' + r2);

  const heavier: Profile = {
    moods: [
      { mood: 'good', date: '2026-07-04' },
      { mood: 'low', date: '2026-07-13' }, { mood: 'stressed', date: '2026-07-14' },
    ],
  };
  if (!buildReview(heavier, today).reply.includes('Heavier than last week')) throw new Error('heavier shift must be named');
});

Deno.test('v28: tryReview signs in the anonymous and leaves ordinary chat alone', () => {
  eq(tryReview('review my week', '', {})?.reply.includes('signed in'), true, 'anonymous is asked to sign in');
  eq(tryReview('my week was really hard', EMAIL, {}), null, 'venting about the week passes through');
  const out = tryReview('review my week', EMAIL, {});
  if (!out?.reply.includes('first weekly review')) throw new Error('empty profile still gets an honest first review');
  eq(out.profile?.review?.date !== undefined, true, 'even the empty review stamps the snapshot');
});

// ── v29: the executive round — conditions, topic triggers, mission-aware
// steps, mission queue, sparklines ───────────────────────────────────────────

Deno.test('v29: evalCondition covers the closed vocabulary and refuses the rest', async () => {
  const today = '2026-07-09';
  const p: Profile = {
    habits: [{ name: 'pray', created: '2026-07-01', lastDone: today, streak: 3, best: 3, total: 3 }],
    reminders: [{ text: 'call mom', created: 'now' }],
    lastMood: 'low',
    mission: { goal: 'get fit', steps: ['s1'], done: 0, created: '2026-07-01T08:00:00Z', touched: '2026-07-02T08:00:00Z' },
  };
  eq(await evalCondition("i haven't logged my pray habit", p, today), false, 'logged today, so not-logged is false');
  eq(await evalCondition('i logged my pray habit', p, today), true, 'positive form');
  eq(await evalCondition("i haven't logged my run habit", p, today), true, 'untracked habit counts as not logged');
  eq(await evalCondition('a reminder is due', p, today), true, 'undated reminder is due');
  eq(await evalCondition('a reminder is due', {}, today), false, 'no reminders, nothing due');
  eq(await evalCondition('my mood is down', p, today), true, 'mood aliases map (down → low)');
  eq(await evalCondition('my mood is good', p, today), false, 'mood mismatch');
  eq(await evalCondition('my mission is idle', p, today), true, 'untouched 7 days is idle');
  eq(await evalCondition('i have a mission', p, today), true, 'mission existence');
  eq(await evalCondition('i have a mission', {}, today), false, 'no mission');
  eq(await evalCondition('mercury is in retrograde', p, today), null, 'unknown conditions stay unknown');
  eq(parseConditionStep('when my mood is low: encourage me'), { cond: 'my mood is low', body: 'encourage me' }, 'condition step splits at the colon');
  eq(parseConditionStep('a verse about hope'), null, 'ordinary steps are not conditions');
});

Deno.test('v29: conditional workflow steps run when true and skip when false', async () => {
  const { ran, run } = stubRunner();
  const today = todayISOForTest();
  const profile: Profile = {
    habits: [{ name: 'pray', created: today, streak: 0, best: 0, total: 0 }], // NOT logged today
    workflows: [{
      name: 'check',
      steps: ["when i haven't logged my pray habit: encourage me", 'when my mood is good: a verse about joy'],
      created: 'now',
    }],
  };
  const out = await tryAgent('run my check workflow', EMAIL, profile, run);
  eq(ran, ['encourage me'], 'met condition runs its step, unmet skips');
  if (!out?.reply.includes(`("when my mood is good" isn't the case`)) throw new Error('skip must name its condition: ' + out?.reply);
  if (!out?.reply.includes('all 1 step executed (1 skipped')) throw new Error('summary counts conditionals honestly: ' + out?.reply);
});

Deno.test('v29: unknown conditions skip safely and teach the vocabulary', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [{ name: 'odd', steps: ['when the moon is full: encourage me'], created: 'now' }] };
  const out = await tryAgent('run my odd workflow', EMAIL, profile, run);
  eq(ran, [], 'unknown condition never executes its step');
  if (!out?.reply.includes(`don't know the condition "the moon is full"`)) throw new Error('must name the unknown condition: ' + out?.reply);
  if (!out?.reply.includes("i haven't logged my <habit> habit")) throw new Error('must teach the vocabulary: ' + out?.reply);
});

Deno.test('v29: "my next mission step" in a workflow reads the mission, read-only', async () => {
  const { ran, run } = stubRunner();
  const workflows = [{ name: 'morning', steps: ['encourage me', 'my next mission step'], created: 'now' }];
  const withMission: Profile = {
    mission: { goal: 'get fit', steps: ['s1', 's2'], done: 1, created: 'now' },
    workflows,
  };
  const out = await tryAgent('run my morning workflow', EMAIL, withMission, run);
  eq(ran, ['encourage me'], 'the mission step is read directly, never sent through the engines');
  if (!out?.reply.includes('s2')) throw new Error('current mission step must surface: ' + out?.reply);
  // v39: every run stamps a receipt on workflowLog, so the profile DOES come
  // back — the read-only contract is about the mission, which must not move.
  eq(out?.profile?.mission, withMission.mission, 'read-only — the mission never moves');

  const noMission = await tryAgent('run my morning workflow', EMAIL, { workflows }, run);
  if (!noMission?.reply.includes('No active mission')) throw new Error('honest when nothing is active: ' + noMission?.reply);

  const created = await tryAgent('create a workflow called morning2: encourage me, then my next mission step', EMAIL, {}, run);
  if (!created?.profile?.workflows?.length) throw new Error('the read-only mission step must be allowed at creation');
  const refused = await tryAgent('create a workflow called bad: abandon my mission', EMAIL, {}, run);
  if (refused?.profile) throw new Error('other mission phrasing is still refused in steps');
});

Deno.test('v29: open triggers — "study *" fires on "study grace" and fills the slot', async () => {
  const { ran, run } = stubRunner();
  let profile: Profile = { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now' }] };

  const set = await tryAgent('when i say study *, run my study workflow on it', EMAIL, profile, run);
  eq(set?.profile?.workflows?.[0].trigger, 'study *', 'open trigger stored normalized');
  profile = set!.profile!;

  const fired = await tryAgent('study grace', EMAIL, profile, run);
  eq(ran, ['a verse about grace'], 'the remainder fills the * slot');
  if (!fired?.reply.includes('"grace"')) throw new Error('run header names the topic: ' + fired?.reply);

  eq(await tryAgent('study', EMAIL, profile, run), null, 'the bare prefix without a topic stays conversation');
  eq(await tryAgent('studying hard today', EMAIL, profile, run), null, 'prefix matches on the word boundary only');
  eq(parseTriggerSet('when i say study <topic>, run my study workflow'), { trigger: 'study *', name: 'study' }, '<topic> normalizes to *');
});

Deno.test('v29: mission queue — queue, dedupe, cap, status, auto-promotion on completion', async () => {
  const { run } = stubRunner();
  let profile: Profile = { mission: { goal: 'get fit', steps: ['s1'], done: 0, created: 'now' } };

  const q1 = await tryAgent('queue a mission to learn piano', EMAIL, profile, run);
  eq(q1?.profile?.missionQueue, ['learn piano'], 'queued behind the active mission');
  profile = q1!.profile!;

  const dup = await tryAgent('queue a mission to learn piano', EMAIL, profile, run);
  if (!dup?.reply.includes('already')) throw new Error('duplicate queueing refused: ' + dup?.reply);
  eq(dup?.profile, undefined, 'no profile change on a duplicate');

  const full = await tryAgent('queue a mission to one more', EMAIL, { ...profile, missionQueue: ['a', 'b', 'c'] }, run);
  if (!full?.reply.includes('full')) throw new Error('cap of 3 enforced: ' + full?.reply);

  const status = await tryAgent('mission status', EMAIL, profile, run);
  if (!status?.reply.includes('learn piano')) throw new Error('status shows the queue: ' + status?.reply);

  const finished = await tryAgent('done', EMAIL, profile, run);
  if (!finished?.reply.includes('MISSION COMPLETE')) throw new Error('completion celebrated first: ' + finished?.reply);
  eq(finished?.profile?.mission?.goal, 'learn piano', 'queued mission auto-promoted to active');
  eq(finished?.profile?.missionQueue, undefined, 'queue emptied by the promotion');
  eq(finished?.profile?.wins, ['get fit'], 'the finished goal still lands on wins');

  const startNow = await tryAgent('queue a mission to get strong', EMAIL, {}, run);
  eq(startNow?.profile?.mission?.goal, 'get strong', 'queueing with nothing active starts immediately');

  eq(parseMissionQueue('queue a mission to end my life'), null, 'crisis is never a queued mission');
  eq(parseMissionQueue('the queue at the bank'), null, 'queue talk is not a command');
});

Deno.test('v29: abandoning keeps the queue waiting; ordinary queue talk untouched', async () => {
  const { run } = stubRunner();
  const profile: Profile = {
    mission: { goal: 'get fit', steps: ['s1'], done: 0, created: 'now' },
    missionQueue: ['learn piano'],
  };
  const out = await tryAgent('abandon mission', EMAIL, profile, run);
  if (!out?.reply.includes('learn piano')) throw new Error('abandon must name what still waits: ' + out?.reply);
  eq(out?.profile?.mission, undefined, 'mission dropped');
  eq(out?.profile?.missionQueue, ['learn piano'], 'the queue survives an abandonment, un-started');

  const removed = await tryAgent('remove the queued mission: learn piano', EMAIL, { ...profile }, run);
  eq(removed?.profile?.missionQueue, undefined, 'unqueue empties the queue');

  eq(await tryAgent('the queue at the bank was long', EMAIL, {}, run), null, 'talk about queues stays conversation');
});

Deno.test('v29: sparkline paints the last 7 days from the streak and recent logs', () => {
  const today = '2026-07-09';
  eq(
    sparkline({ name: 'pray', created: '2026-07-01', lastDone: today, streak: 3, best: 3, total: 3 }, today),
    '····✓✓✓',
    'the streak window fills the tail',
  );
  eq(
    sparkline({ name: 'run', created: '2026-07-01', lastDone: today, streak: 1, best: 3, total: 4, recent: ['2026-07-03', '2026-07-04', '2026-07-09'] }, today),
    '✓✓····✓',
    'recent logs paint the days a broken streak forgot',
  );
  eq(sparkline({ name: 'new', created: today, streak: 0, best: 0, total: 0 }, today), '·······', 'nothing logged, nothing painted');
  const line = streakLine({ name: 'pray', created: '2026-07-01', lastDone: today, streak: 3, best: 3, total: 3 }, today);
  if (!line.includes('····✓✓✓')) throw new Error('streakLine must carry the sparkline: ' + line);
  // logging a habit records the date for future sparklines
  const logged = tryHabit('i did my pray habit', { habits: [{ name: 'pray', created: today, streak: 0, best: 0, total: 0 }] }, today);
  eq(logged?.profile?.habits?.[0].recent, [today], 'each log records its date');
});

Deno.test('v28: reviewOffer fires after 7 days, once per day, and stays quiet with nothing to review', () => {
  // After a past review: offer, stamp, never twice the same day.
  const reviewed: Profile = { habits: [{ name: 'pray', created: '2026-06-20', streak: 1, best: 1, total: 5 }], review: { date: '2026-07-01', habitTotals: { pray: 3 }, wins: [], reminders: 0 } };
  const offer = reviewOffer(reviewed, '2026-07-09');
  if (!offer || !offer.note.includes('review my week')) throw new Error('7+ days since review must offer');
  eq(offer.profile.review?.offered, '2026-07-09', 'offer stamped');
  eq(offer.profile.review?.date, '2026-07-01', 'stamp must not touch the review date');
  eq(reviewOffer(offer.profile, '2026-07-09'), null, 'never twice the same day');
  eq(reviewOffer(reviewed, '2026-07-05'), null, 'a recent review stays quiet');

  // Never reviewed: the oldest tracked history anchors the first offer.
  const fresh: Profile = { habits: [{ name: 'pray', created: '2026-07-01', streak: 4, best: 4, total: 4 }] };
  const first = reviewOffer(fresh, '2026-07-09');
  if (!first || !first.note.includes('week of history')) throw new Error('a week of history must earn the first offer');
  eq(reviewOffer(fresh, '2026-07-05'), null, 'too little history stays quiet');
  eq(reviewOffer({}, '2026-07-09'), null, 'nothing tracked, nothing offered');
});

// ── v30: the cross-platform round ─────────────────────────────────────────────

Deno.test('v30: vision board parsers — add/pin/colon/remove forms, guarded', () => {
  eq(parseVisionAdd('add finish my album to my vision board'), 'finish my album', 'plain add');
  eq(parseVisionAdd('Hey Navi, pin "world tour" onto my vision board!'), 'world tour', 'pin + quotes + address');
  eq(parseVisionAdd('add to my vision board: buy the studio'), 'buy the studio', 'colon form');
  eq(parseVisionAdd('put my mission on my vision board'), 'my mission', 'the mission pin parses');
  eq(parseVisionAdd('add i want to die to my vision board'), null, 'crisis is never a goal to pin');
  eq(parseVisionAdd('what should i add to my vision board'), null, 'a question is not a command');
  eq(parseVisionRemove('remove finish my album from my vision board'), 'finish my album', 'remove');
  eq(parseVisionRemove('take world tour off my vision board'), 'world tour', 'take … off');
  eq(isVisionListAsk("what's on my vision board?"), true, 'list ask');
  eq(isVisionListAsk('show my vision board'), true, 'show ask');
  eq(isVisionListAsk('i love my vision board'), false, 'talk about the board is not a command');
});

Deno.test('v30: tryVision — sign-in gate, mission pin needs a mission, chatter untouched', async () => {
  const anon = await tryVision('add win a grammy to my vision board', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous must be pointed at sign-in: ' + anon?.reply);
  const noMission = await tryVision('put my mission on my vision board', EMAIL, {});
  if (!noMission?.reply.includes('no active mission')) throw new Error('mission pin without a mission must explain: ' + noMission?.reply);
  eq(await tryVision('i love my vision board', EMAIL, {}), null, 'ordinary talk is not board business');
  eq(await tryVision('give me a verse about hope', EMAIL, {}), null, 'unrelated asks fall through');
  if (!Deno.env.get('SUPABASE_URL')) {
    const out = await tryVision('add win a grammy to my vision board', EMAIL, {});
    if (!out?.reply.includes("couldn't reach")) throw new Error('an unreachable board must be reported honestly: ' + out?.reply);
  }
});

Deno.test('v30: evalCondition — negations and streak thresholds join the vocabulary', async () => {
  const t = '2026-07-09';
  eq(await evalCondition('no reminders are due', {}, t), true, 'no reminders at all');
  eq(await evalCondition('no reminders are due', { reminders: [{ text: 'x', created: t }] }, t), false, 'an undated reminder is due');
  eq(await evalCondition("my mood isn't low", { lastMood: 'good' }, t), true, 'mood negation holds');
  eq(await evalCondition('my mood is not low', { lastMood: 'low' }, t), false, 'mood negation fails on a low day');
  eq(await evalCondition("my mood isn't wobbly", {}, t), null, 'unknown mood words still teach, never guess');
  eq(await evalCondition('i have no mission', {}, t), true, 'no mission');
  eq(await evalCondition("i don't have a mission", { mission: { goal: 'g', steps: ['s'], done: 0, created: t } }, t), false, 'mission negation with one active');
  const streaky: Profile = { habits: [{ name: 'prayer', created: '2026-07-01', streak: 5, best: 5, total: 5 }] };
  eq(await evalCondition('my prayer streak is under 3', streaky, t), false, '5 is not under 3');
  eq(await evalCondition('my prayer streak is under 3', {}, t), true, 'an untracked habit has a streak of 0');
  eq(await evalCondition('my prayer streak is at least 5', streaky, t), true, 'at least = inclusive');
  eq(await evalCondition('my prayer streak is over 5', streaky, t), false, 'over = strict');
  eq(await evalCondition('my prayer streak is over 4', streaky, t), true, 'over holds above the bar');
  eq(await evalCondition('the sky is blue', {}, t), null, 'the vocabulary stays closed');
});

Deno.test('v30: queue editing — move to front reorders, honestly', async () => {
  const { run } = stubRunner();
  const profile: Profile = {
    mission: { goal: 'get fit', steps: ['s1', 's2'], done: 0, created: 'now' },
    missionQueue: ['a', 'b', 'c'],
  };
  const moved = await tryAgent('move c to the front of the queue', EMAIL, profile, run);
  eq(moved?.profile?.missionQueue, ['c', 'a', 'b'], 'reordered to the front');
  const already = await tryAgent('move a to the front of the queue', EMAIL, profile, run);
  if (!already?.reply.includes('already at the front')) throw new Error('front stays front: ' + already?.reply);
  eq(already?.profile, undefined, 'no profile change when already first');
  const empty = await tryAgent('move x to the front of the queue', EMAIL, {}, run);
  if (!empty?.reply.includes('empty')) throw new Error('empty queue named: ' + empty?.reply);
  eq(await tryAgent('move the sofa to the front of the room', EMAIL, profile, run), null, 'furniture stays conversation');
});

Deno.test('v30: queue editing — start the queued mission now swaps the active one back', async () => {
  const { run } = stubRunner();
  const profile: Profile = {
    mission: { goal: 'get fit', steps: ['s1', 's2'], done: 1, created: 'now' },
    missionQueue: ['learn piano', 'write a book'],
  };
  const swapped = await tryAgent('start the queued mission learn piano now', EMAIL, profile, run);
  eq(swapped?.profile?.mission?.goal, 'learn piano', 'queued goal takes the floor');
  eq(swapped?.profile?.missionQueue, ['get fit', 'write a book'], 'active goal steps back to the FRONT');
  if (!swapped?.reply.includes("won't be re-counted")) throw new Error('lost progress must be said out loud: ' + swapped?.reply);

  const bare = await tryAgent('start the queued mission', EMAIL, { missionQueue: ['learn piano'] }, run);
  eq(bare?.profile?.mission?.goal, 'learn piano', 'bare form promotes the first queued goal');
  eq(bare?.profile?.missionQueue, undefined, 'queue emptied by the promotion');

  const none = await tryAgent('start the queued mission now', EMAIL, {}, run);
  if (!none?.reply.includes('empty')) throw new Error('nothing queued must be named: ' + none?.reply);
});

Deno.test('v30: reminderEscalation offers once per reminder, and only after 3 days', () => {
  const waiting: Profile = { reminders: [{ text: 'call the lawyer', created: '2026-07-01' }] };
  const offer = reminderEscalation(waiting, '2026-07-09');
  if (!offer || !offer.note.includes('call the lawyer') || !offer.note.includes('make that reminder a habit')) {
    throw new Error('a 8-day reminder must earn the offer: ' + offer?.note);
  }
  eq(offer.profile.reminders?.[0].offered, '2026-07-09', 'offer stamped on the reminder');
  eq(reminderEscalation(offer.profile, '2026-07-15'), null, 'one offer per reminder, ever');
  eq(reminderEscalation({ reminders: [{ text: 'young', created: '2026-07-08' }] }, '2026-07-09'), null, 'young reminders wait');
  eq(reminderEscalation({}, '2026-07-09'), null, 'no reminders, no offer');
});

Deno.test('v30: tryEscalate — a reminder promotes into a tracked habit', () => {
  const today = { y: 2026, m: 7, d: 9 };
  const profile: Profile = { reminders: [{ text: 'Pray for the team', created: '2026-07-01' }] };
  const out = tryEscalate('make that reminder a habit', profile, today);
  eq(out?.profile?.habits?.[0].name, 'pray for the team', 'habit created from the reminder text');
  eq(out?.profile?.reminders, [], 'the reminder leaves the list — promoted, not abandoned');

  const dup = tryEscalate('make that reminder a habit', { ...profile, habits: [{ name: 'pray for the team', created: '2026-07-01', streak: 2, best: 2, total: 2 }] }, today);
  if (!dup?.reply.includes('already tracking')) throw new Error('an existing habit is named, not duplicated: ' + dup?.reply);
  eq(dup?.profile?.reminders, [], 'the redundant reminder still clears');

  const six = Array.from({ length: 6 }, (_, i) => ({ name: `h${i}`, created: '2026-07-01', streak: 0, best: 0, total: 0 }));
  const full = tryEscalate('make that reminder a habit', { ...profile, habits: six }, today);
  if (!full?.reply.includes('6 habits')) throw new Error('the habit cap holds: ' + full?.reply);
  eq(full?.profile, undefined, 'nothing changes when the cap refuses');

  const none = tryEscalate('make that reminder a habit', {}, today);
  if (!none?.reply.includes('no reminders')) throw new Error('nothing to promote must be said: ' + none?.reply);
  eq(tryEscalate('make a habit of running', {}, today), null, 'ordinary habit talk is not an escalation');
});

Deno.test('v30: tryEscalate — a reminder promotes into a mission step, by number too', () => {
  const today = { y: 2026, m: 7, d: 9 };
  const profile: Profile = {
    mission: { goal: 'launch my ep', steps: ['s1', 's2'], done: 0, created: 'now' },
    reminders: [
      { text: 'book studio time', created: '2026-07-01' },
      { text: 'email the label', created: '2026-07-05' },
    ],
  };
  const out = tryEscalate('make reminder 2 a mission step', profile, today);
  eq(out?.profile?.mission?.steps, ['s1', 's2', 'email the label'], 'numbered pick appends to the plan');
  eq(out?.profile?.reminders?.map((r) => r.text), ['book studio time'], 'only the promoted reminder leaves');

  const alt = tryEscalate('add that reminder to my mission', profile, today);
  eq(alt?.profile?.mission?.steps, ['s1', 's2', 'book studio time'], 'bare "that" picks the longest-waiting');

  const noMission = tryEscalate('make that reminder a mission step', { reminders: profile.reminders }, today);
  if (!noMission?.reply.includes('no active mission')) throw new Error('no mission must be explained: ' + noMission?.reply);
  eq(noMission?.profile, undefined, 'the reminder stays when there is nowhere to send it');

  const ten = Array.from({ length: 10 }, (_, i) => `step ${i}`);
  const full = tryEscalate('make that reminder a mission step', { ...profile, mission: { ...profile.mission!, steps: ten } }, today);
  if (!full?.reply.includes('10 steps')) throw new Error('the mission-step cap holds: ' + full?.reply);
});

Deno.test('v30: the self-improvement loop — gaps ask detection and the non-owner line', async () => {
  eq(isGapsAsk('what should you learn?'), true, 'the core ask');
  eq(isGapsAsk('What are your blind spots'), true, 'blind spots');
  eq(isGapsAsk('show me your learning list'), true, 'learning list');
  eq(isGapsAsk('what should i learn about prayer'), false, 'the user learning is not NAVI learning');
  eq(isGapsAsk('tell me about gaps in the market'), false, 'market gaps stay conversation');
  const outsider = await tryGapsReport('what should you learn', EMAIL);
  if (!outsider?.includes('private list')) throw new Error('non-owner gets the friendly line: ' + outsider);
  eq(await tryGapsReport('give me a verse about hope', 'prophetdian@gmail.com'), null, 'unrelated asks fall through');
  if (!Deno.env.get('SUPABASE_URL')) {
    const owner = await tryGapsReport('what should you learn', 'prophetdian@gmail.com');
    if (!owner?.includes("couldn't reach")) throw new Error('an unreachable list is reported honestly: ' + owner);
  }
});

// ── v31: the stewardship round ───────────────────────────────────────────────

Deno.test('v31: parseCleanupAsk reads horizons and stays out of conversation', () => {
  eq(parseCleanupAsk('clean up my old chats'), 30, 'bare cleanup defaults to 30 days');
  eq(parseCleanupAsk('delete my old conversations'), 30, 'conversations count too');
  eq(parseCleanupAsk('delete chats older than 60 days'), 60, 'explicit days');
  eq(parseCleanupAsk('remove my chats older than 2 weeks'), 14, 'weeks convert');
  eq(parseCleanupAsk('prune conversations older than 2 months'), 60, 'months convert');
  eq(parseCleanupAsk('clean up my room'), null, 'rooms are not chats');
  eq(parseCleanupAsk('delete my old photos'), null, 'photos are not chats');
});

Deno.test('v31: isChatCountAsk detects reads, not life questions', () => {
  eq(isChatCountAsk('how many chats do i have'), true, 'the core ask');
  eq(isChatCountAsk('list my chats'), true, 'list form');
  eq(isChatCountAsk('show me my conversations'), true, 'show form');
  eq(isChatCountAsk('how many kids do i have'), false, 'kids are not chats');
  eq(isChatCountAsk('how many chats about prayer'), false, 'unanchored tails fall through');
});

Deno.test('v31: tryChats — bare yes/no is conversation unless an offer is pending', async () => {
  eq(await tryChats('yes', EMAIL, {}), null, 'bare yes with nothing pending');
  eq(await tryChats('no', EMAIL, {}), null, 'bare no with nothing pending');
  eq(await tryChats('what is 2+2', EMAIL, { chatCleanup: { cutoff: 'x', count: 2, asked: new Date().toISOString() } }), null, 'a pending offer never captures unrelated talk');
  const anon = await tryChats('clean up my old chats', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous cleanup points at sign-in: ' + anon?.reply);
  const noPending = await tryChats('yes, clean them up', EMAIL, {});
  if (!noPending?.reply.includes('no chat cleanup waiting')) throw new Error('explicit confirm with nothing pending is redirected: ' + noPending?.reply);
});

Deno.test('v31: tryChats — cancel keeps everything and clears the stamp; stale bare yes refuses', async () => {
  const fresh: Profile = { chatCleanup: { cutoff: '2026-06-01T00:00:00Z', count: 3, asked: new Date().toISOString() } };
  const kept = await tryChats('no', EMAIL, fresh);
  if (!kept?.reply.includes('Kept')) throw new Error('cancel keeps: ' + kept?.reply);
  eq(kept?.profile?.chatCleanup, undefined, 'cancel clears the stamp');

  const stale: Profile = { chatCleanup: { cutoff: '2026-06-01T00:00:00Z', count: 3, asked: '2026-07-01T00:00:00Z' } };
  const refused = await tryChats('yes', EMAIL, stale);
  if (!refused?.reply.includes('stale')) throw new Error('a stale offer refuses a bare yes: ' + refused?.reply);
  eq(refused?.profile?.chatCleanup, undefined, 'the stale stamp is cleared');
});

Deno.test('v31: tryChats — offline, reads and confirmed deletes fail HONESTLY', async () => {
  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise this for real
  const count = await tryChats('how many chats do i have', EMAIL, {});
  if (!count?.reply.includes("couldn't reach")) throw new Error('unreachable reads are honest: ' + count?.reply);
  const ask = await tryChats('clean up my old chats', EMAIL, {});
  if (!ask?.reply.includes("couldn't reach")) throw new Error('unreachable counts are honest: ' + ask?.reply);
  const fresh: Profile = { chatCleanup: { cutoff: '2026-06-01T00:00:00Z', count: 3, asked: new Date().toISOString() } };
  const confirmed = await tryChats('yes, clean them up', EMAIL, fresh);
  if (!confirmed?.reply.includes("couldn't reach")) throw new Error('unreachable deletes are honest: ' + confirmed?.reply);
  eq(confirmed?.profile, undefined, 'the stamp survives an unreachable delete, so a retry works');
});

Deno.test('v31: tryGapsManage — owner-only curation, conversation untouched', async () => {
  const outsider = await tryGapsManage('dismiss gap 2', EMAIL);
  if (!outsider?.includes('Prophet Dian')) throw new Error('non-owner gets the friendly line: ' + outsider);
  eq(await tryGapsManage('mind the gap', 'prophetdian@gmail.com'), null, 'ordinary gap talk falls through');
  eq(await tryGapsManage('clear my reminders', 'prophetdian@gmail.com'), null, 'reminders belong to remind.ts');
  eq(await tryGapsManage('clear my learning list of doubts somehow', 'prophetdian@gmail.com'), null, 'unanchored tails fall through');
  if (!Deno.env.get('SUPABASE_URL')) {
    const dismiss = await tryGapsManage('dismiss gap 1', 'prophetdian@gmail.com');
    if (!dismiss?.includes("couldn't reach")) throw new Error('unreachable dismiss is honest: ' + dismiss);
    const wipe = await tryGapsManage('clear my learning list', 'prophetdian@gmail.com');
    if (!wipe?.includes("couldn't reach")) throw new Error('unreachable clear is honest: ' + wipe);
  }
});

Deno.test('v31: parseWorkflowShow / parseWorkflowStepEdit read the edit commands', () => {
  eq(parseWorkflowShow('show my morning workflow'), 'morning', 'the core show');
  eq(parseWorkflowShow('show me the steps of my morning workflow'), 'morning', 'steps-of form');
  eq(parseWorkflowShow('view the study routine'), 'study', 'view + routine');
  eq(parseWorkflowShow('show my workflows'), null, 'the plural belongs to list');
  eq(parseWorkflowShow('show my mission queue'), null, 'queues are not workflows');
  eq(parseWorkflowStepEdit('add a step to my study workflow: define grace'), { kind: 'add', name: 'study', text: 'define grace' }, 'add');
  eq(parseWorkflowStepEdit('replace step 2 of my study workflow with a verse about hope'), { kind: 'replace', name: 'study', n: 2, text: 'a verse about hope' }, 'replace');
  eq(parseWorkflowStepEdit('remove step 2 from my study workflow'), { kind: 'remove', name: 'study', n: 2 }, 'remove');
  eq(parseWorkflowStepEdit('remove the step ladder from my garage'), null, 'garages stay conversation');
  eq(parseWorkflowStepEdit('add a step to my study workflow: end my life'), null, 'crisis language never enters a workflow');
  eq(parseWorkflowStepEdit('add a step to my mission: call the venue'), null, 'mission steps belong to the mission block');
});

Deno.test('v31: workflow editing — show, add, replace, remove, and every guard', async () => {
  const { run } = stubRunner();
  const profile: Profile = {
    workflows: [{ name: 'morning', steps: ['s1', 's2', 's3'], created: 'now' }],
  };

  const shown = await tryAgent('show my morning workflow', EMAIL, profile, run);
  if (!shown?.reply.includes('1. s1') || !shown.reply.includes('3. s3')) throw new Error('show numbers the steps: ' + shown?.reply);
  eq(shown?.profile, undefined, 'show is read-only');

  const missing = await tryAgent('show my evening workflow', EMAIL, profile, run);
  if (!missing?.reply.includes(`don't have a workflow called "evening"`)) throw new Error('a missing name is named: ' + missing?.reply);

  const added = await tryAgent('add a step to my morning workflow: define grace', EMAIL, profile, run);
  eq(added?.profile?.workflows?.[0].steps, ['s1', 's2', 's3', 'define grace'], 'add appends');

  const replaced = await tryAgent('replace step 2 of my morning workflow with a verse about hope', EMAIL, profile, run);
  eq(replaced?.profile?.workflows?.[0].steps, ['s1', 'a verse about hope', 's3'], 'replace swaps in place');

  const removed = await tryAgent('remove step 2 from my morning workflow', EMAIL, profile, run);
  eq(removed?.profile?.workflows?.[0].steps, ['s1', 's3'], 'remove drops the step');

  const outOfRange = await tryAgent('replace step 9 of my morning workflow with x-rays', EMAIL, profile, run);
  if (!outOfRange?.reply.includes('only has 3 steps')) throw new Error('out-of-range is honest: ' + outOfRange?.reply);
  eq(outOfRange?.profile, undefined, 'nothing changes out of range');

  const five: Profile = { workflows: [{ name: 'full', steps: ['a1', 'a2', 'a3', 'a4', 'a5'], created: 'now' }] };
  const capped = await tryAgent('add a step to my full workflow: one more', EMAIL, five, run);
  if (!capped?.reply.includes('5 steps')) throw new Error('the step cap holds: ' + capped?.reply);
  eq(capped?.profile, undefined, 'the cap refuses without changing anything');

  const solo: Profile = { workflows: [{ name: 'tiny', steps: ['only'], created: 'now' }] };
  const lastOne = await tryAgent('remove step 1 from my tiny workflow', EMAIL, solo, run);
  if (!lastOne?.reply.includes('delete my tiny workflow')) throw new Error('the last step points at delete: ' + lastOne?.reply);
  eq(lastOne?.profile, undefined, 'the shell is never emptied');

  // v46 changed this law: the RUN form is now a sanctioned chain step, so the
  // meta guard is tested on management phrasing instead.
  const meta = await tryAgent('replace step 1 of my morning workflow with delete my evening workflow', EMAIL, profile, run);
  if (!meta?.reply.includes('ordinary asks')) throw new Error('workflows never manage workflows: ' + meta?.reply);
  eq(meta?.profile, undefined, 'the meta guard refuses without changing anything');
  const chain = await tryAgent('replace step 1 of my morning workflow with run my evening workflow', EMAIL, profile, run);
  if (!chain?.profile) throw new Error('v46: the chain form is edit-legal now: ' + chain?.reply);

  const anon = await tryAgent('remove step 2 from my morning workflow', '', profile, run);
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous editing points at sign-in: ' + anon?.reply);

  eq(profile.workflows?.[0].steps, ['s1', 's2', 's3'], 'the original profile is never mutated');
});

// ── v32: the real-tasks round ────────────────────────────────────────────────

Deno.test('v32: parseMailDraft reads draft asks and stays out of conversation', () => {
  eq(parseMailDraft('draft an email to me about the studio schedule'),
    { to: 'me', subject: 'the studio schedule', wantSend: false }, 'subject-only draft to me');
  eq(parseMailDraft('draft an email to sam@studio.com about friday saying see you at 3'),
    { to: 'sam@studio.com', subject: 'friday', body: 'see you at 3', wantSend: false }, 'recipient + body');
  eq(parseMailDraft('send an email to me about payday that says the money landed'),
    { to: 'me', subject: 'payday', body: 'the money landed', wantSend: true }, 'the send verb flags the offer');
  eq(parseMailDraft('write me an email to myself regarding the invoice'),
    { to: 'myself', subject: 'the invoice', wantSend: false }, 'write/regarding forms');
  eq(parseMailDraft('draft a plan to win the week'), null, 'plans belong to plan.ts');
  eq(parseMailDraft('i should email my landlord about the leak'), null, 'musings are not commands');
  eq(parseMailDraft('draft an email to me about wanting to end my life'), null, 'crisis language never enters an envelope');
});

Deno.test('v32: mail list/delete/send parsers are anchored', () => {
  eq(isDraftListAsk('list my email drafts'), true, 'the core list ask');
  eq(isDraftListAsk('show me my email drafts'), true, 'show form');
  eq(isDraftListAsk('what email drafts do i have'), true, 'question form');
  eq(isDraftListAsk('list my drafts'), false, 'unqualified drafts stay conversation');
  eq(isDraftListAsk('list my email addresses'), false, 'addresses are not drafts');
  eq(parseDraftDelete('delete email draft 2'), 2, 'delete by number');
  eq(parseDraftDelete('discard draft 1'), 1, 'discard form');
  eq(parseDraftDelete('delete the draft dodger'), null, 'no number, no command');
  eq(parseDraftSend('send draft 2'), 2, 'send by number');
  eq(parseDraftSend('send email draft 12'), 12, 'send email-draft form');
  eq(parseDraftSend('send my regards to broadway'), null, 'regards stay conversation');
});

Deno.test('v32: tryMail — bare yes/no is conversation unless a send is pending', async () => {
  eq(await tryMail('yes', EMAIL, {}), null, 'bare yes with nothing pending');
  eq(await tryMail('no', EMAIL, {}), null, 'bare no with nothing pending');
  eq(await tryMail('what is 2+2', EMAIL, { mailSend: { id: 'x', to: 'a@b.co', subject: 's', asked: new Date().toISOString() } }), null, 'a pending offer never captures unrelated talk');
  const anon = await tryMail('list my email drafts', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous mail points at sign-in: ' + anon?.reply);
  const noPending = await tryMail('yes, send it', EMAIL, {});
  if (!noPending?.reply.includes('no email waiting')) throw new Error('explicit confirm with nothing pending is redirected: ' + noPending?.reply);
});

Deno.test('v32: tryMail — cancel keeps the draft and clears the stamp; stale bare yes refuses', async () => {
  const fresh: Profile = { mailSend: { id: 'd1', to: 'sam@studio.com', subject: 'friday', asked: new Date().toISOString() } };
  const kept = await tryMail('no', EMAIL, fresh);
  if (!kept?.reply.includes('Kept as a draft')) throw new Error('cancel keeps the draft: ' + kept?.reply);
  eq(kept?.profile?.mailSend, undefined, 'cancel clears the stamp');

  const stale: Profile = { mailSend: { id: 'd1', to: 'sam@studio.com', subject: 'friday', asked: '2026-07-01T00:00:00Z' } };
  const refused = await tryMail('yes', EMAIL, stale);
  if (!refused?.reply.includes('stale')) throw new Error('a stale offer refuses a bare yes: ' + refused?.reply);
  eq(refused?.profile?.mailSend, undefined, 'the stale stamp is cleared');
});

Deno.test('v32: tryMail — offline, every DB-touching path fails HONESTLY', async () => {
  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise this for real
  const list = await tryMail('list my email drafts', EMAIL, {});
  if (!list?.reply.includes("couldn't reach")) throw new Error('unreachable lists are honest: ' + list?.reply);
  const draft = await tryMail('draft an email to me about the gig', EMAIL, {});
  if (!draft?.reply.includes("couldn't reach")) throw new Error('unreachable drafts are honest: ' + draft?.reply);
  const send = await tryMail('send draft 1', EMAIL, {});
  if (!send?.reply.includes("couldn't reach")) throw new Error('unreachable send offers are honest: ' + send?.reply);
  const fresh: Profile = { mailSend: { id: 'd1', to: 'sam@studio.com', subject: 'friday', asked: new Date().toISOString() } };
  const confirmed = await tryMail('yes, send it', EMAIL, fresh);
  if (!confirmed?.reply.includes("couldn't reach")) throw new Error('unreachable confirmed sends are honest: ' + confirmed?.reply);
  eq(confirmed?.profile, undefined, 'the stamp survives an unreachable send, so a retry works');
});

Deno.test('v32: parseWorkflowStepMove / parseWorkflowRename read the reorder commands', () => {
  eq(parseWorkflowStepMove('move step 3 up in my morning workflow'), { name: 'morning', n: 3, dir: 'up' }, 'up');
  eq(parseWorkflowStepMove('move step 2 down in my morning routine'), { name: 'morning', n: 2, dir: 'down' }, 'down + routine');
  eq(parseWorkflowStepMove('move step 3 to the top of my study workflow'), { name: 'study', n: 3, dir: 'top' }, 'to the top');
  eq(parseWorkflowStepMove('move step 1 to the end of my study workflow'), { name: 'study', n: 1, dir: 'bottom' }, 'to the end');
  eq(parseWorkflowStepMove('move the couch up to my bedroom'), null, 'furniture stays conversation');
  eq(parseWorkflowRename('rename my morning workflow to sunrise'), { from: 'morning', to: 'sunrise' }, 'the core rename');
  eq(parseWorkflowRename('rename the morning routine as dawn patrol'), { from: 'morning', to: 'dawn patrol' }, 'as + routine');
  eq(parseWorkflowRename('rename my playlist to bangers'), null, 'playlists are not workflows');
});

Deno.test('v32: step moving and renaming — the guards hold', async () => {
  const { run } = stubRunner();
  const profile: Profile = {
    workflows: [
      { name: 'morning', steps: ['s1', 's2', 's3'], created: 'now', trigger: 'good morning' },
      { name: 'evening', steps: ['e1'], created: 'now' },
    ],
  };

  const up = await tryAgent('move step 3 up in my morning workflow', EMAIL, profile, run);
  eq(up?.profile?.workflows?.[0].steps, ['s1', 's3', 's2'], 'up swaps with the step above');

  const toTop = await tryAgent('move step 3 to the top of my morning workflow', EMAIL, profile, run);
  eq(toTop?.profile?.workflows?.[0].steps, ['s3', 's1', 's2'], 'to the top goes first');

  const toEnd = await tryAgent('move step 1 to the end of my morning workflow', EMAIL, profile, run);
  eq(toEnd?.profile?.workflows?.[0].steps, ['s2', 's3', 's1'], 'to the end goes last');

  const stuck = await tryAgent('move step 1 up in my morning workflow', EMAIL, profile, run);
  if (!stuck?.reply.includes('already at the top')) throw new Error('the top step cannot rise: ' + stuck?.reply);
  eq(stuck?.profile, undefined, 'nothing changes when already there');

  const range = await tryAgent('move step 9 up in my morning workflow', EMAIL, profile, run);
  if (!range?.reply.includes('only has 3 steps')) throw new Error('out-of-range is honest: ' + range?.reply);

  const renamed = await tryAgent('rename my morning workflow to sunrise', EMAIL, profile, run);
  eq(renamed?.profile?.workflows?.[0].name, 'sunrise', 'rename lands');
  eq(renamed?.profile?.workflows?.[0].trigger, 'good morning', 'the trigger survives a rename');
  if (!renamed?.reply.includes('good morning')) throw new Error('the reply names the surviving trigger: ' + renamed?.reply);

  const dupe = await tryAgent('rename my morning workflow to evening', EMAIL, profile, run);
  if (!dupe?.reply.includes('share a name')) throw new Error('renaming onto a taken name refuses: ' + dupe?.reply);
  eq(dupe?.profile, undefined, 'the dupe guard changes nothing');

  const same = await tryAgent('rename my morning workflow to morning', EMAIL, profile, run);
  if (!same?.reply.includes('already its name')) throw new Error('renaming to itself is honest: ' + same?.reply);

  const missing = await tryAgent('rename my midnight workflow to dawn', EMAIL, profile, run);
  if (!missing?.reply.includes(`don't have a workflow called "midnight"`)) throw new Error('a missing name is named: ' + missing?.reply);

  const anon = await tryAgent('rename my morning workflow to sunrise', '', profile, run);
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous renaming points at sign-in: ' + anon?.reply);

  eq(profile.workflows?.[0].steps, ['s1', 's2', 's3'], 'the original profile is never mutated');
  eq(profile.workflows?.[0].name, 'morning', 'the original name is never mutated');
});

// ── v33: the correspondence round ────────────────────────────────────────────

Deno.test('v33: parseSendWhen speaks the closed time vocabulary', () => {
  // Tue 14 July 2026, 10:00 UTC = 12:00 SA time.
  const now = Date.UTC(2026, 6, 14, 10, 0);
  const today = { y: 2026, m: 7, d: 14 };

  eq(parseSendWhen('now', now, today), 'now', 'now');
  eq(parseSendWhen('right now', now, today), 'now', 'right now');
  eq(parseSendWhen('in 2 hours', now, today), new Date(now + 2 * 3600_000).toISOString(), 'in 2 hours');
  eq(parseSendWhen('in 30 minutes', now, today), new Date(now + 30 * 60_000).toISOString(), 'in 30 minutes');
  eq(parseSendWhen('tonight', now, today), '2026-07-14T16:00:00.000Z', 'tonight = 18:00 SA');
  eq(parseSendWhen('tomorrow', now, today), '2026-07-15T06:00:00.000Z', 'tomorrow = 08:00 SA');
  eq(parseSendWhen('tomorrow afternoon', now, today), '2026-07-15T12:00:00.000Z', 'tomorrow afternoon = 14:00 SA');
  eq(parseSendWhen('tomorrow at 9pm', now, today), '2026-07-15T19:00:00.000Z', 'tomorrow at 9pm = 21:00 SA');
  eq(parseSendWhen('on friday', now, today), '2026-07-17T06:00:00.000Z', 'friday from a tuesday');
  eq(parseSendWhen('friday evening', now, today), '2026-07-17T16:00:00.000Z', 'weekday + time of day');
  eq(parseSendWhen('on tuesday', now, today), '2026-07-21T06:00:00.000Z', 'a weekday named on that weekday means NEXT week');

  const evening = Date.UTC(2026, 6, 14, 17, 0); // 19:00 SA — tonight is gone
  eq(parseSendWhen('tonight', evening, today), 'past', 'a moment already gone is past, never immediate');
  eq(parseSendWhen('in 0 hours', now, today), 'past', 'zero delay is past');

  eq(parseSendWhen('when the moon is full', now, today), null, 'unknown phrasing is refused, never guessed');
  eq(parseSendWhen('at some point', now, today), null, 'vague phrasing is refused');
  eq(parseSendWhen('tomorrow at 13pm', now, today), null, '13pm is not a clock time');
});

Deno.test('v33: schedule/inbox/reply parsers are anchored', () => {
  eq(parseDraftSendLater('send draft 2 tomorrow morning'), { n: 2, when: 'tomorrow morning' }, 'the core booking ask');
  eq(parseDraftSendLater('send draft 2'), null, 'a bare send belongs to the immediate parser');
  eq(parseDraftSendLater('send my regards tomorrow'), null, 'regards stay conversation');

  eq(isInboxAsk('check my inbox'), true, 'the core inbox ask');
  eq(isInboxAsk('any new emails?'), true, 'question form');
  eq(isInboxAsk('check my email'), true, 'email form');
  eq(isInboxAsk('read my inbox'), true, 'read form');
  eq(isInboxAsk('check my facts'), false, 'facts are not an inbox');
  eq(isInboxAsk('inbox zero is a lie'), false, 'musings stay conversation');

  eq(parseMailReply('reply to the last email from sam'), { from: 'sam' }, 'reply by name');
  eq(parseMailReply('reply to the latest email from sam saying thanks for the notes'),
    { from: 'sam', body: 'thanks for the notes' }, 'reply with a said body');
  eq(parseMailReply('reply to sam'), null, 'a bare reply is not anchored enough');
  eq(parseMailReply('reply to the last email from my boss saying i want to die'), null, 'crisis language never enters an envelope');

  eq(isScheduledListAsk('show my scheduled sends'), true, 'the core list ask');
  eq(isScheduledListAsk('what emails are scheduled'), true, 'question form');
  eq(isScheduledListAsk('show my schedule'), false, 'a diary is not the send book');

  eq(parseScheduledCancel('cancel the scheduled send'), 0, 'bare cancel resolves later');
  eq(parseScheduledCancel('cancel scheduled send 2'), 2, 'numbered cancel');
  eq(parseScheduledCancel('unschedule draft 2'), 2, 'unschedule form');
  eq(parseScheduledCancel('cancel my subscription'), null, 'subscriptions are not bookings');
});

Deno.test('v33: booking asks — vocabulary is taught, the past is refused', async () => {
  const vocab = await tryMail('send draft 2 when the moon is full', EMAIL, {});
  if (!vocab?.reply.includes("didn't recognise the time")) throw new Error('unknown time teaches the vocabulary: ' + vocab?.reply);
  const past = await tryMail('send draft 1 in 0 hours', EMAIL, {});
  if (!past?.reply.includes('already passed')) throw new Error('a past time is refused: ' + past?.reply);
  eq(await tryMail('i sent flowers to my mom yesterday', EMAIL, {}), null, 'ordinary talk of sending stays conversation');
});

Deno.test('v33: a scheduled confirm BOOKS instead of firing — profile-only', async () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const fresh: Profile = { mailSend: { id: 'd1', to: 'sam@studio.com', subject: 'friday', asked: new Date().toISOString(), sendAt: future } };

  const booked = await tryMail('yes', EMAIL, fresh);
  if (!booked?.reply.includes('Booked')) throw new Error('the yes books the send: ' + booked?.reply);
  eq(booked?.profile?.mailSend, undefined, 'the offer stamp is consumed');
  eq(booked?.profile?.mailScheduled?.length, 1, 'the booking lands on the schedule');
  eq(booked?.profile?.mailScheduled?.[0].id, 'd1', 'the booking keeps the draft id');
  eq(booked?.profile?.mailScheduled?.[0].sendAt, future, 'the booking keeps its moment');

  const cancelled = await tryMail('no', EMAIL, fresh);
  if (!cancelled?.reply.includes('Kept as a draft')) throw new Error('no keeps the draft: ' + cancelled?.reply);
  eq(cancelled?.profile?.mailScheduled, undefined, 'nothing is booked on a no');

  const stale: Profile = { mailSend: { id: 'd1', to: 'sam@studio.com', subject: 'friday', asked: '2026-07-01T00:00:00Z', sendAt: future } };
  const refused = await tryMail('yes', EMAIL, stale);
  if (!refused?.reply.includes('stale')) throw new Error('a stale booking offer refuses a bare yes: ' + refused?.reply);

  const full: Profile = {
    mailSend: { id: 'd4', to: 'a@b.co', subject: 's4', asked: new Date().toISOString(), sendAt: future },
    mailScheduled: [
      { id: 'a', to: 'a@b.co', subject: '1', sendAt: future, created: 'x' },
      { id: 'b', to: 'a@b.co', subject: '2', sendAt: future, created: 'x' },
      { id: 'c', to: 'a@b.co', subject: '3', sendAt: future, created: 'x' },
    ],
  };
  const refusedFull = await tryMail('yes', EMAIL, full);
  if (!refusedFull?.reply.includes('full')) throw new Error('the schedule cap holds at the confirm too: ' + refusedFull?.reply);
  eq(refusedFull?.profile?.mailScheduled?.length, 3, 'nothing extra is booked past the cap');

  const dupe: Profile = {
    mailSend: { id: 'a', to: 'a@b.co', subject: '1', asked: new Date().toISOString(), sendAt: future },
    mailScheduled: [{ id: 'a', to: 'a@b.co', subject: '1', sendAt: future, created: 'x' }],
  };
  const refusedDupe = await tryMail('yes', EMAIL, dupe);
  if (!refusedDupe?.reply.includes('already booked')) throw new Error('a draft books once: ' + refusedDupe?.reply);
});

Deno.test('v33: the schedule list and cancel are profile-only moves', async () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const empty = await tryMail('show my scheduled sends', EMAIL, {});
  if (!empty?.reply.includes('Nothing is booked')) throw new Error('an empty schedule says so: ' + empty?.reply);

  const two: Profile = { mailScheduled: [
    { id: 'a', to: 'a@b.co', subject: 'first', sendAt: future, created: 'x' },
    { id: 'b', to: 'c@d.co', subject: 'second', sendAt: future, created: 'x' },
  ] };
  const listed = await tryMail('show my scheduled sends', EMAIL, two);
  if (!listed?.reply.includes('1. "first"') || !listed?.reply.includes('2. "second"')) {
    throw new Error('the schedule lists numbered: ' + listed?.reply);
  }

  const noneToCancel = await tryMail('cancel the scheduled send', EMAIL, {});
  if (!noneToCancel?.reply.includes('Nothing is booked')) throw new Error('cancelling an empty schedule is honest: ' + noneToCancel?.reply);

  const ambiguous = await tryMail('cancel the scheduled send', EMAIL, two);
  if (!ambiguous?.reply.includes('cancel scheduled send N')) throw new Error('two bookings need a number: ' + ambiguous?.reply);

  const second = await tryMail('cancel scheduled send 2', EMAIL, two);
  if (!second?.reply.includes('Unbooked') || !second?.reply.includes('second')) throw new Error('the numbered cancel names its booking: ' + second?.reply);
  eq(second?.profile?.mailScheduled?.length, 1, 'one booking remains');
  eq(second?.profile?.mailScheduled?.[0].id, 'a', 'the right booking remains');

  const one: Profile = { mailScheduled: [{ id: 'a', to: 'a@b.co', subject: 'only', sendAt: future, created: 'x' }] };
  const bare = await tryMail('cancel the scheduled send', EMAIL, one);
  if (!bare?.reply.includes('Unbooked')) throw new Error('a lone booking cancels bare: ' + bare?.reply);
  eq(bare?.profile?.mailScheduled, undefined, 'an emptied schedule leaves the profile');

  const range = await tryMail('cancel scheduled send 9', EMAIL, one);
  if (!range?.reply.includes('only 1 booked send')) throw new Error('out-of-range is honest: ' + range?.reply);

  const offer: Profile = { mailSend: { id: 'z', to: 'a@b.co', subject: 'pending', asked: new Date().toISOString(), sendAt: future } };
  const offCancelled = await tryMail('cancel the scheduled send', EMAIL, offer);
  if (!offCancelled?.reply.includes("won't be booked")) throw new Error('a pending booking offer can be cancelled by name: ' + offCancelled?.reply);
  eq(offCancelled?.profile?.mailSend, undefined, 'the offer stamp is cleared');
});

Deno.test('v33: runDueSends — quiet when nothing is due, honest when it cannot fire', async () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const pastDue = new Date(Date.now() - 60_000).toISOString();

  eq(await runDueSends({}, EMAIL), null, 'no schedule, no note');
  eq(await runDueSends({ mailScheduled: [{ id: 'a', to: 'a@b.co', subject: 's', sendAt: future, created: 'x' }] }, EMAIL), null, 'a future booking stays silent');
  eq(await runDueSends({ mailScheduled: [{ id: 'a', to: 'a@b.co', subject: 's', sendAt: pastDue, created: 'x' }] }, ''), null, 'anonymous sessions never fire sends');

  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise the real path
  const due = await runDueSends({ mailScheduled: [{ id: 'a', to: 'a@b.co', subject: 's', sendAt: pastDue, created: 'x' }] }, EMAIL);
  if (!due?.note.includes("couldn't reach")) throw new Error('an unreachable due send is honest: ' + due?.note);
  eq(due?.profile.mailScheduled?.length, 1, 'the booking survives to retry next session');
});

Deno.test('v33: inbox and reply asks fail honestly offline; anonymous asks point at sign-in', async () => {
  const anon = await tryMail('check my inbox', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous inbox points at sign-in: ' + anon?.reply);
  const anonReply = await tryMail('reply to the last email from sam', '', {});
  if (!anonReply?.reply.includes('signed in')) throw new Error('anonymous reply points at sign-in: ' + anonReply?.reply);

  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise the real path
  const inbox = await tryMail('check my inbox', EMAIL, {});
  if (!inbox?.reply.includes("couldn't reach")) throw new Error('an unreachable inbox is honest: ' + inbox?.reply);
  const reply = await tryMail('reply to the last email from sam', EMAIL, {});
  if (!reply?.reply.includes("couldn't reach")) throw new Error('an unreachable reply is honest: ' + reply?.reply);
});

Deno.test('v33: a pending booking offer never captures unrelated conversation', async () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const offer: Profile = { mailSend: { id: 'z', to: 'a@b.co', subject: 'pending', asked: new Date().toISOString(), sendAt: future } };
  eq(await tryMail('what is 2+2', EMAIL, offer), null, 'math is not a confirmation');
  eq(await tryMail('schedule a meeting with sam', EMAIL, {}), null, 'meetings are not send bookings');
  eq(await tryMail('yes', EMAIL, {}), null, 'bare yes with nothing pending stays conversation');
});

// ── v34: the slash-command round ─────────────────────────────────────────────

Deno.test('v34: parseMailSlash reads the /email shorthand, keeps case, teaches when malformed', () => {
  eq(parseMailSlash('/email/sam@studio.com/Friday plans/See you at 7, bring the Mix.'),
    { to: 'sam@studio.com', subject: 'Friday plans', body: 'See you at 7, bring the Mix.', wantSend: false }, 'the core slash ask');
  eq(parseMailSlash('/email/SAM@Studio.com/Hi There/The Body keeps CASE'),
    { to: 'sam@studio.com', subject: 'Hi There', body: 'The Body keeps CASE', wantSend: false }, 'the address lowercases; subject and body keep case');
  eq(parseMailSlash('/email/me/Note to self/Remember the 9am call and then the studio'),
    { to: 'me', subject: 'Note to self', body: 'Remember the 9am call and then the studio', wantSend: false }, '"me" rides through; "and then" is body, not a second ask');
  eq(parseMailSlash('/email/sam@x.com/Mix notes/Bounce v2, then A/B the chorus/verse levels'),
    { to: 'sam@x.com', subject: 'Mix notes', body: 'Bounce v2, then A/B the chorus/verse levels', wantSend: false }, 'the body keeps its own slashes');
  eq(parseMailSlash('/ email / sam@x.com / Hi / Body text'),
    { to: 'sam@x.com', subject: 'Hi', body: 'Body text', wantSend: false }, 'spaced slashes still read');

  eq(parseMailSlash('/email/sam@x.com/only a subject'), 'malformed', 'a missing body is taught');
  eq(parseMailSlash('/email/sam@x.com'), 'malformed', 'a bare recipient is taught');
  eq(parseMailSlash('/email//Hi/Body'), 'malformed', 'an empty recipient is taught');
  eq(parseMailSlash('/email sam@x.com hello there friend'), null, 'the legacy space form belongs to the client parser');
  eq(parseMailSlash('either/or/neither/both'), null, 'slashy prose stays conversation');
  eq(parseMailSlash('/email/me/goodbye/i want to die'), null, 'crisis language never enters an envelope');

  eq(isMailSlashAsk('/email/a@b.co/s/b'), true, 'the split guard sees slash asks');
  eq(isMailSlashAsk('remind me to pray and give me a verse'), false, 'ordinary compounds still split');
});

Deno.test('v34: slash asks through tryMail — honest address check, teaching, sign-in, offline', async () => {
  const taught = await tryMail('/email/sam@x.com/only a subject', EMAIL, {});
  if (!taught?.reply.includes('three parts')) throw new Error('a malformed slash ask is taught: ' + taught?.reply);
  const bad = await tryMail('/email/not an address/Hi/Body here', EMAIL, {});
  if (!bad?.reply.includes("doesn't look like an email address")) throw new Error('a bad address is answered honestly: ' + bad?.reply);
  const anon = await tryMail('/email/sam@x.com/Hi/Body text', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous slash asks point at sign-in: ' + anon?.reply);

  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise the real path
  const offline = await tryMail('/email/me/Hi/Body text here', EMAIL, {});
  if (!offline?.reply.includes("couldn't reach")) throw new Error('an unreachable slash draft is honest: ' + offline?.reply);
});

Deno.test('v34: isInboxDigestAsk is anchored; the digest fails honestly offline', async () => {
  eq(isInboxDigestAsk('summarise my inbox'), true, 'the core digest ask');
  eq(isInboxDigestAsk('summarize the email inbox'), true, 'z-spelling + email form');
  eq(isInboxDigestAsk('digest my inbox'), true, 'digest verb');
  eq(isInboxDigestAsk('inbox digest'), true, 'noun form');
  eq(isInboxDigestAsk('give me an inbox summary'), true, 'give-me form');
  eq(isInboxDigestAsk("what's new in my inbox"), true, 'question form');
  eq(isInboxDigestAsk('check my inbox'), false, 'a plain check belongs to the reader');
  eq(isInboxDigestAsk('summarise this article for me'), false, 'pasted-text summaries stay with understand.ts');
  eq(isInboxDigestAsk('my inbox is a mess'), false, 'musings stay conversation');

  const anon = await tryMail('summarise my inbox', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous digest points at sign-in: ' + anon?.reply);

  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise the real path
  const offline = await tryMail('summarise my inbox', EMAIL, {});
  if (!offline?.reply.includes("couldn't reach")) throw new Error('an unreachable digest is honest: ' + offline?.reply);
});

// ── v35: the awareness round ─────────────────────────────────────────────────

const stubSources = (
  vision: number | null,
  unread: number | 'not-connected' | null,
  oldChats: number | null = 0, // v37: the chats-age source rides the same stub
) => {
  const calls: string[] = [];
  const days: number[] = [];
  return {
    calls,
    days,
    sources: {
      visionCount: (_e: string) => { calls.push('vision'); return Promise.resolve(vision); },
      inboxUnread: (_e: string) => { calls.push('inbox'); return Promise.resolve(unread); },
      chatsOlderThan: (_e: string, d: number) => {
        calls.push('chats');
        days.push(d);
        return Promise.resolve(oldChats);
      },
    },
  };
};

Deno.test('v35: evalCondition looks at the world — board and inbox, lazily, honestly', async () => {
  const t = '2026-07-14';

  const empty = stubSources(0, 0);
  eq(await evalCondition('my vision board is empty', {}, t, EMAIL, empty.sources), true, 'an empty board is empty');
  eq(await evalCondition("my vision board isn't empty", {}, t, EMAIL, empty.sources), false, 'an empty board is not not-empty');
  eq(await evalCondition('i have no new email', {}, t, EMAIL, empty.sources), true, 'zero unread is a clear inbox');
  eq(await evalCondition('my inbox is clear', {}, t, EMAIL, empty.sources), true, 'clear-inbox form');
  eq(await evalCondition('i have new email', {}, t, EMAIL, empty.sources), false, 'zero unread is no new email');

  const busy = stubSources(3, 2);
  eq(await evalCondition('my vision board is empty', {}, t, EMAIL, busy.sources), false, 'three items is not empty');
  eq(await evalCondition('my vision board is not empty', {}, t, EMAIL, busy.sources), true, 'not-empty holds');
  eq(await evalCondition('i have new email', {}, t, EMAIL, busy.sources), true, 'two unread is new email');
  eq(await evalCondition('i have unread emails', {}, t, EMAIL, busy.sources), true, 'unread form');
  eq(await evalCondition('i have no new emails', {}, t, EMAIL, busy.sources), false, 'a busy inbox is not clear');

  const offline = stubSources(null, null);
  eq(await evalCondition('my vision board is empty', {}, t, EMAIL, offline.sources), 'unreachable', 'an unreachable board is honest');
  eq(await evalCondition('i have new email', {}, t, EMAIL, offline.sources), 'unreachable', 'an unreachable inbox is honest');

  const unlinked = stubSources(0, 'not-connected');
  eq(await evalCondition('i have new email', {}, t, EMAIL, unlinked.sources), 'not-connected', 'no Gmail link is its own verdict');
  eq(await evalCondition('i have no new email', {}, t, EMAIL, unlinked.sources), 'not-connected', 'the negation needs Gmail too');

  // Lazy: profile and unknown conditions never touch the world.
  const spy = stubSources(0, 0);
  await evalCondition('i have a mission', {}, t, EMAIL, spy.sources);
  await evalCondition('mercury is in retrograde', {}, t, EMAIL, spy.sources);
  eq(spy.calls, [], 'profile and unknown conditions never call a source');
  eq(await evalCondition('my vision board is beautiful', {}, t, EMAIL, spy.sources), null, 'the vocabulary stays closed');
});

Deno.test('v35: world conditions steer workflow steps — run, skip, honest cannot-check', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = {
    workflows: [{
      name: 'aware',
      steps: ['when my vision board is empty: encourage me', 'when i have new email: a verse about diligence'],
      created: 'now',
    }],
  };

  const emptyWorld = stubSources(0, 0);
  const out1 = await tryAgent('run my aware workflow', EMAIL, profile, run, emptyWorld.sources);
  if (!out1?.reply.includes('Step 1 — encourage me')) throw new Error('an empty board runs the step: ' + out1?.reply);
  if (!out1?.reply.includes(`Step 2 — skipped ("when i have new email" isn't the case right now)`)) {
    throw new Error('a clear inbox skips the mail step: ' + out1?.reply);
  }
  eq(ran, ['encourage me'], 'only the true condition executed');

  const busyWorld = stubSources(3, 2);
  const out2 = await tryAgent('run my aware workflow', EMAIL, profile, run, busyWorld.sources);
  if (!out2?.reply.includes('skipped ("when my vision board is empty"')) throw new Error('a full board skips: ' + out2?.reply);
  if (!out2?.reply.includes('Step 2 — a verse about diligence')) throw new Error('unread mail runs the step: ' + out2?.reply);

  const offlineWorld = stubSources(null, null);
  const out3 = await tryAgent('run my aware workflow', EMAIL, profile, run, offlineWorld.sources);
  if (!out3?.reply.includes(`couldn't check "my vision board is empty"`)) throw new Error('unreachable is honest: ' + out3?.reply);
  if (!out3?.reply.includes('every step was skipped')) throw new Error('all-skipped summary holds: ' + out3?.reply);

  const unlinkedWorld = stubSources(0, 'not-connected');
  const out4 = await tryAgent('run my aware workflow', EMAIL, profile, run, unlinkedWorld.sources);
  if (!out4?.reply.includes('needs your Gmail')) throw new Error('a missing Gmail link is named: ' + out4?.reply);

  eq(profile.workflows?.[0].steps.length, 2, 'the original profile is never mutated');
});

// ── v36: the foresight round ─────────────────────────────────────────────────

Deno.test('v36: parseWorkflowPreview reads dry-run asks and stays out of conversation', () => {
  eq(parseWorkflowPreview('preview my aware workflow'), { name: 'aware' }, 'the core preview');
  eq(parseWorkflowPreview('dry run my study workflow on grace'), { name: 'study', topic: 'grace' }, 'dry run + topic');
  eq(parseWorkflowPreview('dry-run the study routine'), { name: 'study' }, 'hyphenated + routine');
  eq(parseWorkflowPreview('what would my aware workflow do right now?'), { name: 'aware' }, 'the question form');
  eq(parseWorkflowPreview('what would my study workflow do on grace'), { name: 'study', topic: 'grace' }, 'question + topic');
  eq(parseWorkflowPreview('preview my mixtape'), null, 'no workflow word, no preview');
  eq(parseWorkflowPreview('what would jesus do'), null, 'not a workflow question');
  eq(parseWorkflowPreview('preview my week'), null, 'a week is not a workflow');
});

Deno.test('v36: the dry-run reports without executing — run, skip, cannot-tell', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = {
    mailScheduled: [{ id: 'a', to: 'a@b.co', subject: 's', sendAt: '2027-01-01T08:00:00Z', created: 'x' }],
    workflows: [{
      name: 'aware',
      steps: [
        'a verse about strength',
        'when my vision board is empty: encourage me',
        'when i have new email: a verse about diligence',
        'when a booked send is waiting: a verse about patience',
      ],
      created: 'now',
    }],
  };

  const world = stubSources(3, 'not-connected');
  const out = await tryAgent('preview my aware workflow', EMAIL, profile, run, world.sources);
  if (!out?.reply.includes('nothing was executed')) throw new Error('the dry-run says what it is: ' + out?.reply);
  if (!out.reply.includes('1. would run — a verse about strength')) throw new Error('ordinary steps would run: ' + out.reply);
  if (!out.reply.includes(`2. would skip — "when my vision board is empty" isn't the case right now`)) throw new Error('a false condition would skip: ' + out.reply);
  if (!out.reply.includes(`3. can't tell`)) throw new Error('no Gmail is a cannot-tell: ' + out.reply);
  if (!out.reply.includes('4. would run — a verse about patience')) throw new Error('the booked-send condition holds: ' + out.reply);
  eq(ran, [], 'NOTHING was executed');
  eq(out.profile, undefined, 'nothing changed');

  const slotted: Profile = { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now' }] };
  const needsTopic = await tryAgent('preview my study workflow', EMAIL, slotted, run, world.sources);
  if (!needsTopic?.reply.includes('needs a topic')) throw new Error('slotted previews ask for a topic: ' + needsTopic?.reply);
  const withTopic = await tryAgent('what would my study workflow do on grace', EMAIL, slotted, run, world.sources);
  if (!withTopic?.reply.includes('would run — a verse about grace')) throw new Error('the topic fills the slot: ' + withTopic?.reply);

  const missing = await tryAgent('preview my night workflow', EMAIL, profile, run, world.sources);
  if (!missing?.reply.includes(`don't have a workflow called "night"`)) throw new Error('a missing name is named: ' + missing?.reply);

  const anon = await tryAgent('preview my aware workflow', '', profile, run, world.sources);
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous previews point at sign-in: ' + anon?.reply);
  eq(ran, [], 'still nothing executed after every preview');
});

Deno.test('v36: booked-send conditions read the profile — sync and free', async () => {
  const t = '2026-07-14';
  const spy = stubSources(0, 0);
  const booked: Profile = { mailScheduled: [{ id: 'a', to: 'a@b.co', subject: 's', sendAt: '2027-01-01T08:00:00Z', created: 'x' }] };
  eq(await evalCondition('a booked send is waiting', booked, t, EMAIL, spy.sources), true, 'a booking waits');
  eq(await evalCondition('a booked send is waiting', {}, t, EMAIL, spy.sources), false, 'no bookings');
  eq(await evalCondition('no booked sends are waiting', {}, t, EMAIL, spy.sources), true, 'the negation holds');
  eq(await evalCondition('i have no booked sends', booked, t, EMAIL, spy.sources), false, 'the negation fails with one booked');
  eq(spy.calls, [], 'booked-send conditions never touch a source');
});

// ── v37: the horizon round ───────────────────────────────────────────────────

Deno.test('v37: the mission dry-run reads the whole remaining tail — read-only', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = {
    mission: {
      goal: 'launch my ep',
      steps: ['write the tracklist', 'record vocals', 'mix the record', 'plan the release'],
      done: 1,
      created: '2026-07-01T08:00:00Z',
      touched: '2026-07-01T08:00:00Z',
    },
  };

  const out = await tryAgent('what would finish my mission?', EMAIL, profile, run);
  if (!out?.reply.includes('3 steps stand')) throw new Error('the tail is counted: ' + out?.reply);
  if (!out.reply.includes('2. record vocals')) throw new Error('numbering starts at the current step: ' + out.reply);
  if (!out.reply.includes('4. plan the release')) throw new Error('the last step is read back: ' + out.reply);
  if (out.reply.includes('1. write the tracklist')) throw new Error('finished steps stay finished: ' + out.reply);
  if (!out.reply.includes('Nothing moved')) throw new Error('the preview says it is read-only: ' + out.reply);
  eq(out.profile, undefined, 'nothing changed');
  eq(ran, [], 'nothing executed');

  const preview = await tryAgent('preview my mission', EMAIL, profile, run);
  if (!preview?.reply.includes('3 steps stand')) throw new Error('the preview verb works: ' + preview?.reply);
  const show = await tryAgent('show my remaining mission steps', EMAIL, profile, run);
  if (!show?.reply.includes('3 steps stand')) throw new Error('the show form works: ' + show?.reply);

  const lastLeg: Profile = { ...profile, mission: { ...profile.mission!, done: 3 } };
  const one = await tryAgent('what would finish my mission', EMAIL, lastLeg, run);
  if (!one?.reply.includes('One step stands')) throw new Error('the last leg reads singular: ' + one?.reply);

  const none = await tryAgent('what would finish my mission?', EMAIL, {}, run);
  if (!none?.reply.includes('No active mission')) throw new Error('no mission is answered honestly: ' + none?.reply);
  const anon = await tryAgent('preview my mission', '', {}, run);
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous asks point at sign-in: ' + anon?.reply);

  eq(await tryAgent('what would finish my sandwich?', EMAIL, profile, run), null, 'ordinary conversation stays untouched');
  const wf = await tryAgent('preview my mission workflow', EMAIL, { workflows: [] }, run);
  if (!wf?.reply.includes('to preview')) throw new Error('"my mission workflow" is a WORKFLOW preview ask: ' + wf?.reply);
});

Deno.test('v37: chats-age conditions count the idle history — lazily, honestly', async () => {
  const t = '2026-07-14';

  const dusty = stubSources(0, 0, 4);
  eq(await evalCondition('i have chats older than 30 days', {}, t, EMAIL, dusty.sources), true, 'four idle chats hold the condition');
  eq(await evalCondition('i have no chats older than 30 days', {}, t, EMAIL, dusty.sources), false, 'the negation fails');
  eq(dusty.days, [30, 30], 'the horizon is passed through to the source');

  const tidy = stubSources(0, 0, 0);
  eq(await evalCondition('i have chats older than 90 days', {}, t, EMAIL, tidy.sources), false, 'a tidy history fails the condition');
  eq(await evalCondition('i have no chats idle than 90 days', {}, t, EMAIL, tidy.sources), true, 'the negation holds (idle form too)');
  eq(tidy.days, [90, 90], 'each phrasing carries its own horizon');

  const offline = stubSources(0, 0, null);
  eq(await evalCondition('i have chats older than 30 days', {}, t, EMAIL, offline.sources), 'unreachable', 'an unreachable history is honest');

  // Lazy + closed: profile conditions never count chats; loose phrasing teaches.
  const spy = stubSources(0, 0, 9);
  eq(await evalCondition('i have a mission', {}, t, EMAIL, spy.sources), false, 'profile conditions still answer from the profile');
  eq(await evalCondition('my chats are old', {}, t, EMAIL, spy.sources), null, 'the vocabulary stays closed');
  eq(spy.calls, [], 'neither of those touched the source');
});

Deno.test('v37: chats-age conditions steer runs and previews like any world condition', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = {
    workflows: [{
      name: 'tidy',
      steps: ['when i have chats older than 30 days: encourage me', 'a verse about order'],
      created: 'now',
    }],
  };

  const dusty = stubSources(0, 0, 2);
  const out1 = await tryAgent('run my tidy workflow', EMAIL, profile, run, dusty.sources);
  if (!out1?.reply.includes('Step 1 — encourage me')) throw new Error('idle chats run the step: ' + out1?.reply);
  eq(ran.splice(0), ['encourage me', 'a verse about order'], 'both steps executed');

  const clean = stubSources(0, 0, 0);
  const out2 = await tryAgent('run my tidy workflow', EMAIL, profile, run, clean.sources);
  if (!out2?.reply.includes(`skipped ("when i have chats older than 30 days"`)) {
    throw new Error('a tidy history skips the step: ' + out2?.reply);
  }
  eq(ran.splice(0), ['a verse about order'], 'only the unconditional step executed');

  const preview = await tryAgent('preview my tidy workflow', EMAIL, profile, run, dusty.sources);
  if (!preview?.reply.includes('1. would run — encourage me')) throw new Error('the dry-run sees the condition hold: ' + preview?.reply);
  eq(ran, [], 'the preview executed nothing');
});

// ── v38: the tempo round — weekly workflows + calendar/clock conditions ─────

Deno.test('v38: parseDailySet learns weekdays; weekly schedules set, swap, and clear', async () => {
  eq(parseDailySet('run my sabbath workflow every sunday'), { name: 'sabbath', daily: true, day: 'sunday' }, 'weekly on');
  eq(parseDailySet('set my review routine each friday'), { name: 'review', daily: true, day: 'friday' }, 'each-day form');
  eq(parseDailySet('run my sabbath workflow every sundays'), { name: 'sabbath', daily: true, day: 'sunday' }, 'plural day tolerated');
  eq(parseDailySet('stop running my sabbath workflow every sunday'), { name: 'sabbath', daily: false }, 'weekly off');
  eq(parseDailySet('stop running my sabbath workflow on sundays'), { name: 'sabbath', daily: false }, 'off with "on"');
  eq(parseDailySet('run my morning workflow every day'), { name: 'morning', daily: true }, 'daily on unchanged');
  eq(parseDailySet('run my errands every monday'), null, 'no workflow word, no schedule');
  eq(parseDailySet('run my study workflow on friday'), null, '"on <day>" is a run topic, never a schedule');

  const { run } = stubRunner();
  let profile: Profile = { workflows: [
    { name: 'sabbath', steps: ['a verse about rest'], created: 'now' },
    { name: 'topical', steps: ['a verse about *'], created: 'now' },
  ] };
  const on = await tryAgent('run my sabbath workflow every sunday', EMAIL, profile, run);
  eq(on?.profile?.workflows?.[0].day, 'sunday', 'weekday stored');
  eq(on?.profile?.workflows?.[0].daily, undefined, 'weekly is not daily');
  if (!on?.reply.includes('every sunday')) throw new Error('confirm must name the day: ' + on?.reply);
  profile = on!.profile!;

  const listed = await tryAgent('list my workflows', EMAIL, profile, run);
  if (!listed?.reply.includes('runs every sunday')) throw new Error('list must show the weekly schedule: ' + listed?.reply);
  const shown = await tryAgent('show my sabbath workflow', EMAIL, profile, run);
  if (!shown?.reply.includes('Runs every sunday')) throw new Error('show must show the weekly schedule: ' + shown?.reply);

  // The schedule is exclusive: daily replaces weekly, weekly replaces daily.
  const daily = await tryAgent('run my sabbath workflow every day', EMAIL, profile, run);
  eq(daily?.profile?.workflows?.[0].daily, true, 'daily replaces weekly');
  eq(daily?.profile?.workflows?.[0].day, undefined, 'the weekday is gone');
  const weekly = await tryAgent('run my sabbath workflow every monday', EMAIL, daily!.profile!, run);
  eq(weekly?.profile?.workflows?.[0].day, 'monday', 'weekly replaces daily');
  eq(weekly?.profile?.workflows?.[0].daily, undefined, 'daily flag is gone');

  const off = await tryAgent('stop running my sabbath workflow every monday', EMAIL, weekly!.profile!, run);
  eq(off?.profile?.workflows?.[0].day, undefined, 'off clears the weekday');
  eq(off?.profile?.workflows?.[0].lastRun, undefined, 'off clears the stamp');

  const slotted = await tryAgent('run my topical workflow every friday', EMAIL, profile, run);
  if (!slotted?.reply.includes('* slot')) throw new Error('slotted workflows refuse a weekly schedule: ' + slotted?.reply);
  eq(slotted?.profile, undefined, 'the refusal changes nothing');
});

Deno.test('v38: evalCondition tells the day — weekdays, weekends, negations, from todayISO', async () => {
  const spy = stubSources(0, 0, 0);
  const MON = '2026-07-13', FRI = '2026-07-17', SAT = '2026-07-18', SUN = '2026-07-19';
  eq(await evalCondition("it's monday", {}, MON, EMAIL, spy.sources), true, 'monday is monday');
  eq(await evalCondition('today is friday', {}, FRI, EMAIL, spy.sources), true, 'today-is form');
  eq(await evalCondition('it is friday', {}, MON, EMAIL, spy.sources), false, 'monday is not friday');
  eq(await evalCondition("it isn't friday", {}, MON, EMAIL, spy.sources), true, 'negation holds');
  eq(await evalCondition("today isn't monday", {}, MON, EMAIL, spy.sources), false, 'negation fails on the day itself');
  eq(await evalCondition("it's the weekend", {}, SAT, EMAIL, spy.sources), true, 'saturday is the weekend');
  eq(await evalCondition("it's the weekend", {}, SUN, EMAIL, spy.sources), true, 'sunday too');
  eq(await evalCondition("it's the weekend", {}, FRI, EMAIL, spy.sources), false, 'friday is not the weekend');
  eq(await evalCondition("it's a weekday", {}, FRI, EMAIL, spy.sources), true, 'friday is a weekday');
  eq(await evalCondition("it isn't the weekend", {}, MON, EMAIL, spy.sources), true, 'weekend negation is the weekday');
  eq(await evalCondition("it's not a weekday", {}, SUN, EMAIL, spy.sources), true, 'weekday negation is the weekend');
  eq(await evalCondition("it's caturday", {}, SAT, EMAIL, spy.sources), null, 'the vocabulary stays closed');
  eq(spy.calls, [], 'calendar conditions never touch a source');
});

Deno.test('v44: evalCondition knows the day of the month — sync, free, closed', async () => {
  const spy = stubSources(0, 0, 0);
  const t = '2026-07-15';
  eq(await evalCondition("it's the 15th", {}, t, EMAIL, spy.sources), true, 'the day itself');
  eq(await evalCondition("it's the 15th of the month", {}, t, EMAIL, spy.sources), true, 'of-the-month suffix');
  eq(await evalCondition('today is the 1st', {}, t, EMAIL, spy.sources), false, 'a different day');
  eq(await evalCondition("it isn't the 1st", {}, t, EMAIL, spy.sources), true, 'negation holds');
  eq(await evalCondition("it's not the 15th", {}, t, EMAIL, spy.sources), false, 'negation fails on the day');
  eq(await evalCondition("it's the 1st", {}, '2026-08-01', EMAIL, spy.sources), true, 'month boundary');
  eq(await evalCondition("it's the 32nd", {}, t, EMAIL, spy.sources), null, 'an impossible day teaches');
  eq(spy.calls, [], 'day-of-month conditions never touch a source');
});

Deno.test('v38: evalCondition tells the time of day — pinned clock, closed segments', async () => {
  const spy = stubSources(0, 0, 0);
  const t = '2026-07-15';
  const at = (cond: string, h: number) => evalCondition(cond, {}, t, EMAIL, spy.sources, h);
  eq(await at("it's morning", 9), true, '9am is morning');
  eq(await at("it's morning", 13), false, '1pm is not morning');
  eq(await at('it is afternoon', 13), true, '1pm is afternoon');
  eq(await at("it's evening", 19), true, '7pm is evening');
  eq(await at("it's night", 23), true, '11pm is night');
  eq(await at("it's night", 3), true, '3am is still night');
  eq(await at("it's night", 12), false, 'noon is not night');
  eq(await at("it's morning time", 6), true, 'the "time" suffix parses');
  eq(await at("it isn't evening", 9), true, 'clock negation holds');
  eq(await at("it's not morning", 9), false, 'clock negation fails in the morning');
  eq(await at("it's teatime", 16), null, 'the vocabulary stays closed');
  eq(spy.calls, [], 'clock conditions never touch a source');
});

Deno.test('v38: runDailyWorkflows runs weekly workflows on their day only', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'sabbath', steps: ['a verse about rest'], created: 'now', day: 'sunday' },
    { name: 'morning', steps: ['a verse about strength'], created: 'now', daily: true },
  ] };

  const monday = await runDailyWorkflows(profile, run, '2026-07-13');
  if (!monday) throw new Error('the daily workflow is still due on a monday');
  eq(ran.splice(0), ['a verse about strength'], 'only the daily ran on monday');
  if (monday.report.includes('sabbath')) throw new Error('the weekly workflow must wait for its day');

  const sunday = await runDailyWorkflows(profile, run, '2026-07-19');
  if (!sunday) throw new Error('sunday runs both');
  eq(ran.splice(0), ['a verse about rest', 'a verse about strength'], 'both ran on sunday, in list order');
  if (!sunday.report.includes('Your sunday "sabbath" workflow')) throw new Error('the weekly header names its day: ' + sunday.report);
  eq(sunday.profile.workflows?.find((w) => w.name === 'sabbath')?.lastRun, '2026-07-19', 'lastRun stamped');

  eq(await runDailyWorkflows(sunday.profile, run, '2026-07-19'), null, 'never twice the same day');
});

// ── v39: the hands round — device tasks, the runner contract, ICS, receipts ─

Deno.test('v39: device task queue — add, list, tick off, clear, caps, guards', () => {
  let profile: Profile = {};
  const add = tryTasks('add a task for my laptop: push the repo', EMAIL, profile)!;
  eq(add.profile?.deviceTasks?.length, 1, 'task queued');
  eq(add.profile?.deviceTasks?.[0].device, 'laptop', 'device kept');
  profile = add.profile!;
  profile = tryTasks('add a task for my laptop: renew the domain', EMAIL, profile)!.profile!;
  profile = tryTasks('queue a task on my phone: back up photos', EMAIL, profile)!.profile!;

  const list = tryTasks('show my laptop tasks', EMAIL, profile)!;
  if (!list.reply.includes('1. push the repo') || !list.reply.includes('2. renew the domain')) {
    throw new Error('device list wrong: ' + list.reply);
  }
  if (list.reply.includes('back up photos')) throw new Error('other devices stay out of a device list');
  const waiting = tryTasks("what's waiting on my phone", EMAIL, profile)!;
  if (!waiting.reply.includes('back up photos')) throw new Error('waiting form reads the queue: ' + waiting.reply);
  const all = tryTasks('show my device tasks', EMAIL, profile)!;
  if (!all.reply.includes('laptop') || !all.reply.includes('phone')) throw new Error('all-devices list: ' + all.reply);

  const done = tryTasks('done with task 1 on my laptop', EMAIL, profile)!;
  if (!done.reply.includes('push the repo')) throw new Error('tick-off names the task: ' + done.reply);
  eq(done.profile?.deviceTasks?.filter((x) => x.device === 'laptop').length, 1, 'one left on the laptop');
  profile = done.profile!;

  const badNum = tryTasks('done with task 9 on my laptop', EMAIL, profile)!;
  if (!badNum.reply.includes('no task 9')) throw new Error('out-of-range answered with the list: ' + badNum.reply);
  eq(badNum.profile, undefined, 'out-of-range changes nothing');

  const cleared = tryTasks('clear my laptop tasks', EMAIL, profile)!;
  eq(cleared.profile?.deviceTasks?.length, 1, 'only the phone task survives');

  eq(tryTasks('add a task for my laptop: hurt myself', EMAIL, {}), null, 'crisis is never a task');
  eq(tryTasks('i finished a task at work today', EMAIL, {}), null, 'plain sentences untouched');
  eq(tryTasks('add a task for my laptop: x y z', '', {})?.reply.includes('signed in'), true, 'anonymous asked to sign in');
  eq(isTasksAsk('add a task for my laptop: push'), true, 'isTasksAsk sees the ask');

  const full: Profile = { deviceTasks: Array.from({ length: 12 }, (_, i) => ({ device: 'pc', text: `t${i}`, created: 'now' })) };
  const over = tryTasks('add a task for my pc: one more', EMAIL, full)!;
  if (!over.reply.includes('full')) throw new Error('the cap refuses honestly: ' + over.reply);
  eq(over.profile, undefined, 'the cap never evicts');
});

Deno.test('v39: auto tasks carry a NAME for the runner; receipts read once and clear', () => {
  let profile: Profile = {};
  const queued = tryTasks('run backup on my pc', EMAIL, profile)!;
  eq(queued.profile?.deviceTasks?.[0].auto, true, 'auto flag set');
  eq(queued.profile?.deviceTasks?.[0].text, 'backup', 'only the name rides');
  if (!queued.reply.includes('allowlist')) throw new Error('the reply states the safety contract: ' + queued.reply);
  profile = queued.profile!;

  const dupe = tryTasks("run 'backup' on my pc", EMAIL, profile)!;
  if (!dupe.reply.includes('already queued')) throw new Error('dupe guard: ' + dupe.reply);
  eq(dupe.profile, undefined, 'dupe changes nothing');

  const early = tryTasks('any results from my pc', EMAIL, profile)!;
  if (!early.reply.includes('still waiting')) throw new Error('no results yet is honest: ' + early.reply);
  eq(early.profile, undefined, 'waiting receipts stay queued');

  // The runner ran: it stamps a result on the task.
  profile = { ...profile, deviceTasks: [{ ...profile.deviceTasks![0], result: 'ok — 2 files copied' }] };
  const got = tryTasks('any results from my pc', EMAIL, profile)!;
  if (!got.reply.includes('backup — ok — 2 files copied')) throw new Error('receipt read back: ' + got.reply);
  eq(got.profile?.deviceTasks?.length, 0, 'receipts clear once read');

  eq(tryTasks('run for your life on my street', EMAIL, {}), null, 'loose "run" sentences that fail the name shape stay conversation');
});

Deno.test('v39: buildIcs exports everything dated; the export ask wraps it', () => {
  const profile: Profile = {
    reminders: [{ text: 'call mom', created: 'now' }, { text: 'renew, the domain; now', created: 'now', due: '2026-08-01' }],
    events: [{ text: 'exam', date: '2026-07-20' }],
    mailScheduled: [{ id: 'd1', to: 'sam@x.com', subject: 'plans', sendAt: '2026-07-16T06:00:00.000Z', created: 'now' }],
  };
  const ics = buildIcs(profile, '2026-07-15T10:00:00.000Z')!;
  for (const bit of [
    'BEGIN:VCALENDAR', 'END:VCALENDAR',
    'DTSTART;VALUE=DATE:20260801', 'SUMMARY:renew\\, the domain\\; now',
    'DTSTART;VALUE=DATE:20260720', 'SUMMARY:exam',
    'DTSTART:20260716T060000Z', 'SUMMARY:NAVI sends "plans" to sam@x.com',
    'DTSTAMP:20260715T100000Z',
  ]) {
    if (!ics.includes(bit)) throw new Error(`ics missing ${bit}:\n` + ics);
  }
  if (ics.includes('call mom')) throw new Error('undated reminders stay out of the calendar');

  const exported = tryTasks('export my reminders as a calendar', EMAIL, profile)!;
  if (!exported.reply.includes('BEGIN:VCALENDAR') || !exported.reply.includes('navi.ics')) {
    throw new Error('export ask returns the block + instructions: ' + exported.reply.slice(0, 200));
  }
  const nothing = tryTasks('export my calendar', EMAIL, {})!;
  if (!nothing.reply.includes('Nothing dated')) throw new Error('empty export is honest: ' + nothing.reply);
  eq(buildIcs({}), null, 'no dated data, no calendar');
});

Deno.test('v39: workflow runs leave receipts; "which workflows ran today" reads them', async () => {
  const { run } = stubRunner();
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
  let profile: Profile = { workflows: [
    { name: 'study', steps: ['a verse about *'], created: 'now', trigger: 'study *' },
    { name: 'calm', steps: ['a verse about peace'], created: 'now', daily: true },
  ] };

  const none = await tryAgent('which workflows ran today', EMAIL, profile, run);
  if (!none?.reply.includes('Nothing has run today')) throw new Error('empty log is honest: ' + none?.reply);

  const manual = await tryAgent('run my calm workflow', EMAIL, profile, run);
  eq(manual?.profile?.workflowLog?.length, 1, 'a manual run stamps one receipt');
  // v47 grew the receipt: per-step outcomes ride along now.
  eq(manual?.profile?.workflowLog?.[0], { name: 'calm', date: t, via: 'manual', steps: [{ s: 'a verse about peace', o: 'ran' }] }, 'receipt shape');
  profile = manual!.profile!;

  const triggered = await tryAgent('study grace', EMAIL, profile, run);
  eq(triggered?.profile?.workflowLog?.[1].via, 'trigger', 'a trigger run says so');
  profile = triggered!.profile!;

  const daily = await runDailyWorkflows(profile, run, t);
  if (!daily) throw new Error('the daily workflow was due');
  const log = daily.profile.workflowLog!;
  eq(log[log.length - 1].via, 'daily', 'a daily auto-run says so');
  profile = daily.profile;

  const report = await tryAgent('which workflows ran today', EMAIL, profile, run);
  if (!report?.reply.includes('"calm" — you ran it')) throw new Error('manual receipt: ' + report?.reply);
  if (!report?.reply.includes('"study" — fired by its trigger phrase')) throw new Error('trigger receipt: ' + report?.reply);
  if (!report?.reply.includes('"calm" — daily auto-run')) throw new Error('daily receipt: ' + report?.reply);

  const preview = await tryAgent('preview my calm workflow', EMAIL, profile, run);
  eq(preview?.profile, undefined, 'a dry-run never stamps a receipt');

  const capped: Profile = { ...profile, workflowLog: Array.from({ length: 10 }, (_, i) => ({ name: `w${i}`, date: '2026-01-01', via: 'manual' as const })) };
  const eleventh = await tryAgent('run my calm workflow', EMAIL, capped, run);
  eq(eleventh?.profile?.workflowLog?.length, 10, 'the log stays capped at 10');
  eq(eleventh?.profile?.workflowLog?.[0].name, 'w1', 'oldest receipt evicted');
});

Deno.test('v39: the briefing looks at the world once — honest at every stage', async () => {
  const src = (board: number | null, unread: number | 'not-connected' | null) => ({
    visionCount: () => Promise.resolve(board),
    inboxUnread: () => Promise.resolve(unread),
  });
  eq(await worldLine(EMAIL, src(3, 2)), 'OUT IN THE WORLD: vision board: 3 items · inbox: 2 unread.', 'counts read plainly');
  eq(await worldLine(EMAIL, src(0, 0)), 'OUT IN THE WORLD: vision board: empty · inbox: clear.', 'zero is calm');
  eq((await worldLine(EMAIL, src(null, 'not-connected'))).includes("didn't answer"), true, 'unreachable board is honest');
  eq((await worldLine(EMAIL, src(1, 'not-connected'))).includes('Gmail not connected'), true, 'no link is honest');

  const brief = await tryBriefing('brief me', EMAIL, { name: 'Dian' }, src(2, 0));
  if (!brief?.reply.includes('OUT IN THE WORLD: vision board: 2 items · inbox: clear.')) {
    throw new Error('the briefing carries the world line: ' + brief?.reply);
  }
  eq(await tryBriefing('what is grace', EMAIL, {}, src(9, 9)), null, 'non-briefing asks never fetch');
});

// ── v41: the rhythm round — monthly workflows, device conditions, receipts ──

Deno.test('v41: parseDailySet learns months; monthly schedules set, swap, and clear', async () => {
  eq(parseDailySet('run my budget workflow every month'), { name: 'budget', daily: true, monthDay: 1 }, 'bare monthly defaults to the 1st');
  eq(parseDailySet('run my budget workflow every month on the 15th'), { name: 'budget', daily: true, monthDay: 15 }, 'monthly with a day');
  eq(parseDailySet('run my budget workflow on the 1st of every month'), { name: 'budget', daily: true, monthDay: 1 }, 'day-first form');
  eq(parseDailySet('make my budget routine monthly'), { name: 'budget', daily: true, monthDay: 1 }, 'the word monthly');
  eq(parseDailySet('stop running my budget workflow every month'), { name: 'budget', daily: false }, 'monthly off');
  eq(parseDailySet('run my budget workflow on grace'), null, 'a topic run is never a schedule');
  eq(parseDailySet('i budget every month'), null, 'plain sentences untouched');

  const { run } = stubRunner();
  const profile: Profile = { workflows: [{ name: 'budget', steps: ['list my reminders'], created: 'now' }] };
  const on = await tryAgent('run my budget workflow every month on the 15th', EMAIL, profile, run);
  eq(on?.profile?.workflows?.[0].monthDay, 15, 'monthDay stored');
  eq(on?.profile?.workflows?.[0].daily, undefined, 'monthly is not daily');
  if (!on?.reply.includes('15th of every month')) throw new Error('confirm must name the day: ' + on?.reply);

  const listed = await tryAgent('list my workflows', EMAIL, on!.profile!, run);
  if (!listed?.reply.includes('runs monthly on the 15th')) throw new Error('list must show the monthly schedule: ' + listed?.reply);
  const shown = await tryAgent('show my budget workflow', EMAIL, on!.profile!, run);
  if (!shown?.reply.includes('Runs on the 15th of every month')) throw new Error('show must show the monthly schedule: ' + shown?.reply);

  // The schedule stays exclusive: weekly replaces monthly, monthly replaces daily.
  const weekly = await tryAgent('run my budget workflow every friday', EMAIL, on!.profile!, run);
  eq(weekly?.profile?.workflows?.[0].day, 'friday', 'weekly replaces monthly');
  eq(weekly?.profile?.workflows?.[0].monthDay, undefined, 'monthDay is gone');
  const monthly = await tryAgent('run my budget workflow every month', EMAIL, weekly!.profile!, run);
  eq(monthly?.profile?.workflows?.[0].monthDay, 1, 'monthly replaces weekly');
  eq(monthly?.profile?.workflows?.[0].day, undefined, 'weekday is gone');
  const off = await tryAgent('stop running my budget workflow monthly', EMAIL, monthly!.profile!, run);
  eq(off?.profile?.workflows?.[0].monthDay, undefined, 'off clears the schedule');

  const late = await tryAgent('run my budget workflow every month on the 30th', EMAIL, profile, run);
  if (!late?.reply.includes('1st through the 28th')) throw new Error('29-31 refused honestly: ' + late?.reply);
  eq(late?.profile, undefined, 'a refused day changes nothing');

  const slotted: Profile = { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now' }] };
  const refuse = await tryAgent('run my study workflow every month', EMAIL, slotted, run);
  if (!refuse?.reply.includes('* slot')) throw new Error('slotted workflows refuse a monthly schedule: ' + refuse?.reply);
});

Deno.test('v41: runDailyWorkflows runs monthly workflows on their day only', async () => {
  const { run } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'budget', steps: ['list my reminders'], created: 'now', monthDay: 15 },
  ] };
  eq(await runDailyWorkflows(profile, run, '2026-07-14'), null, 'the monthly workflow waits for its day');
  const due = await runDailyWorkflows(profile, run, '2026-07-15');
  if (!due) throw new Error('the 15th is its day');
  if (!due.report.includes('Your monthly "budget" workflow')) throw new Error('the monthly header says so: ' + due.report);
  const log = due.profile.workflowLog!;
  eq(log[log.length - 1].via, 'monthly', 'the receipt says monthly');
  eq(due.profile.workflows?.[0].lastRun, '2026-07-15', 'lastRun stamped');
  eq(await runDailyWorkflows(due.profile, run, '2026-07-15'), null, 'never twice the same day');
});

Deno.test('v41: device-task conditions read the queue and the receipts, sync and free', async () => {
  const t = '2026-07-15';
  const p: Profile = { deviceTasks: [
    { device: 'pc', text: 'backup', created: 'now', auto: true, result: 'ok — done' },
    { device: 'laptop', text: 'push the repo', created: 'now' },
  ] };
  eq(await evalCondition('my laptop has tasks waiting', p, t), true, 'a queued task is waiting');
  eq(await evalCondition('my laptop has no tasks waiting', p, t), false, 'negation fails when one waits');
  eq(await evalCondition('my pc has tasks waiting', p, t), false, 'a finished receipt is not a waiting task');
  eq(await evalCondition('my pc has results waiting', p, t), true, 'the receipt is a waiting result');
  eq(await evalCondition('my pc has no results waiting', p, t), false, 'negation sees the receipt');
  eq(await evalCondition('my laptop has results waiting', p, t), false, 'no receipts on the laptop');
  eq(await evalCondition('my phone has tasks waiting', {}, t), false, 'an unknown device honestly has nothing');
  eq(await evalCondition('my phone has no tasks waiting', {}, t), true, 'and its negation holds');
  eq(await evalCondition('my pc has homework waiting', p, t), null, 'the vocabulary stays closed');

  // The pair lights up inside a real workflow run, step-level.
  const { run, ran } = stubRunner();
  const wf: Profile = { ...p, workflows: [{
    name: 'aware',
    steps: ['when my pc has results waiting: list my reminders', 'when my laptop has no tasks waiting: encourage me'],
    created: 'now',
  }] };
  const out = await tryAgent('run my aware workflow', EMAIL, wf, run);
  eq(ran, ['list my reminders'], 'the holding condition ran, the failing one skipped');
  if (!out?.reply.includes('skipped')) throw new Error('the skip is reported: ' + out?.reply);
});

Deno.test('v41: deviceReceipts surfaces unread receipts once, then clears them', () => {
  eq(deviceReceipts({}), null, 'no tasks, no note');
  eq(deviceReceipts({ deviceTasks: [{ device: 'pc', text: 'backup', created: 'now', auto: true }] }), null, 'a waiting auto task is not a receipt');
  eq(deviceReceipts({ deviceTasks: [{ device: 'laptop', text: 'push', created: 'now' }] }), null, 'manual tasks are not receipts');

  const p: Profile = { deviceTasks: [
    { device: 'pc', text: 'backup', created: 'now', auto: true, result: 'ok — 2 files copied' },
    { device: 'pc', text: 'cleanup', created: 'now', auto: true, result: 'refused — not in the allowlist' },
    { device: 'phone', text: 'sync', created: 'now', auto: true, result: 'ok — synced' },
    { device: 'pc', text: 'update', created: 'now', auto: true },
    { device: 'laptop', text: 'push the repo', created: 'now' },
  ] };
  const got = deviceReceipts(p)!;
  if (!got.note.includes('From the runner on your pc:')) throw new Error('pc block missing: ' + got.note);
  if (!got.note.includes('backup — ok — 2 files copied')) throw new Error('receipt text missing: ' + got.note);
  if (!got.note.includes('cleanup — refused — not in the allowlist')) throw new Error('refusals ride too: ' + got.note);
  if (!got.note.includes('From the runner on your phone:')) throw new Error('phone block missing: ' + got.note);
  if (!got.note.includes('read and cleared')) throw new Error('the note states the contract: ' + got.note);
  eq(got.profile.deviceTasks?.length, 2, 'only the receipts clear');
  eq(got.profile.deviceTasks?.map((x) => x.text), ['update', 'push the repo'], 'waiting work survives');
  eq(deviceReceipts(got.profile), null, 'read once — a second session-start stays quiet');
});

// ── v42: the trust round — run-time send confirm + run-report headline ──────

Deno.test('v42: isSendStep knows the closed send vocabulary', () => {
  eq(isSendStep('send an email to me about the day'), true, 'send verb');
  eq(isSendStep('send an email to sam@x.com about plans saying see you at 6'), true, 'send with body');
  eq(isSendStep('send draft 2'), true, 'numbered send');
  eq(isSendStep('send draft 2 tomorrow morning'), true, 'a booking is a send too');
  eq(isSendStep('draft an email to me about the day'), false, 'a draft is harmless');
  eq(isSendStep('/email/me/subject/body'), false, 'the slash form only drafts');
  eq(isSendStep('a verse about hope'), false, 'ordinary steps untouched');
  eq(isSendStep('i want to send an email to my boss someday'), false, 'loose sentences untouched');
});

Deno.test('v42: a run with send steps is offered, not run — yes runs it, no parks it', async () => {
  const mk = () => stubRunner();
  let profile: Profile = { workflows: [
    { name: 'mailer', steps: ['send an email to me about *', 'a verse about *'], created: 'now', trigger: 'mail me *' },
  ] };

  // The offer: nothing runs, the stamp rides.
  let s = mk();
  const offer = await tryAgent('run my mailer workflow on the harvest', EMAIL, profile, s.run);
  if (!offer?.reply.includes('sends real email')) throw new Error('the offer names the danger: ' + offer?.reply);
  eq(offer?.profile?.runSend?.name, 'mailer', 'stamp carries the name');
  eq(offer?.profile?.runSend?.topic, 'the harvest', 'stamp carries the topic');
  eq(s.ran, [], 'NOTHING ran on the offer');

  // "no" parks it — cleared, still nothing run.
  s = mk();
  const parked = await tryAgent('no', EMAIL, offer!.profile!, s.run);
  if (!parked?.reply.includes('Parked')) throw new Error('no parks the run: ' + parked?.reply);
  eq(parked?.profile?.runSend, undefined, 'stamp cleared on no');
  eq(s.ran, [], 'nothing ran on no');

  // A fresh "yes" runs it, topic and all (stubRunner never stamps mailSend,
  // so the programmatic confirm is exercised in the next test).
  s = mk();
  const again = await tryAgent('run my mailer workflow on the harvest', EMAIL, profile, s.run);
  const ranIt = await tryAgent('yes', EMAIL, again!.profile!, s.run);
  eq(s.ran, ['send an email to me about the harvest', 'a verse about the harvest'], 'yes runs every step with the topic filled');
  if (!ranIt?.reply.includes('complete')) throw new Error('the confirmed run reports: ' + ranIt?.reply);
  eq(ranIt?.profile?.runSend, undefined, 'stamp consumed by the run');

  // Stale offers refuse the bare yes, honestly.
  s = mk();
  const stale: Profile = { ...profile, runSend: { name: 'mailer', asked: new Date(Date.now() - 11 * 60 * 1000).toISOString() } };
  const refused = await tryAgent('yes', EMAIL, stale, s.run);
  if (!refused?.reply.includes('stale')) throw new Error('a stale offer refuses: ' + refused?.reply);
  eq(refused?.profile?.runSend, undefined, 'stale stamp cleared');
  eq(s.ran, [], 'nothing ran stale');

  // A vanished workflow answers honestly.
  s = mk();
  const ghost: Profile = { runSend: { name: 'ghost', asked: new Date().toISOString() } };
  const gone = await tryAgent('yes', EMAIL, ghost, s.run);
  if (!gone?.reply.includes("isn't on the shelf")) throw new Error('a deleted workflow is honest: ' + gone?.reply);

  // Bare yes/no with no stamp stays conversation.
  s = mk();
  eq(await tryAgent('yes', EMAIL, {}, s.run), null, 'bare yes with nothing pending is not ours');
  eq(await tryAgent('no', EMAIL, {}, s.run), null, 'bare no with nothing pending is not ours');

  // The trigger path gates too — a trigger is live, so it offers.
  s = mk();
  const trig = await tryAgent('mail me the harvest', EMAIL, profile, s.run);
  if (!trig?.reply.includes('sends real email')) throw new Error('triggers gate sends: ' + trig?.reply);
  eq(trig?.profile?.runSend?.topic, 'the harvest', 'trigger topic rides the stamp');
  eq(s.ran, [], 'the trigger ran nothing');
});

Deno.test('v42: a confirmed send step consumes its offer through the real yes-machinery', async () => {
  // This runner stamps a fresh mailSend offer, exactly like the live engine
  // does for "send an email to …". With no SUPABASE_URL in the test env the
  // draft shelf is unreachable — mail.ts answers honestly and keeps its
  // retry stamp, and runWorkflow must CLEAR it so no later bare "yes" fires.
  const stamping = (part: string, p: Profile) => Promise.resolve({
    reply: `[drafted: ${part}]`,
    profile: { ...p, mailSend: { id: 'row1', to: EMAIL, subject: 'the day', asked: new Date().toISOString() } },
  });
  const profile: Profile = {
    workflows: [{ name: 'mailer', steps: ['send an email to me about the day'], created: 'now' }],
    runSend: { name: 'mailer', asked: new Date().toISOString() },
  };
  const out = await tryAgent('yes', EMAIL, profile, stamping);
  if (!out?.reply.includes('[drafted: send an email to me about the day]')) throw new Error('the step executed: ' + out?.reply);
  if (!out?.reply.includes('cleared that pending send')) throw new Error('the dangling stamp is named and cleared: ' + out?.reply);
  eq(out?.profile?.mailSend, undefined, 'no mailSend stamp survives the run');
  eq(out?.profile?.runSend, undefined, 'no runSend stamp survives the run');
});

Deno.test('v42: scheduled runs hold send steps back; the report headline counts', async () => {
  const { run, ran } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'morning', steps: ['send an email to me about the day', 'a verse about peace'], created: 'now', daily: true },
  ] };
  const due = await runDailyWorkflows(profile, run, '2026-07-15');
  if (!due) throw new Error('the daily workflow was due');
  eq(ran, ['a verse about peace'], 'the send step never executed');
  if (!due.report.includes('held back')) throw new Error('the hold is honest: ' + due.report);
  if (!due.report.includes('a scheduled run never sends')) throw new Error('the reason is named: ' + due.report);
  if (!due.report.includes('(1 of 2 steps ran)')) throw new Error('the #27 headline counts: ' + due.report);
  if (!due.report.includes('1 send step held for your yes')) throw new Error('the footer counts the hold: ' + due.report);
});

Deno.test('v42: previews and creation name send steps before anything real happens', async () => {
  const { run } = stubRunner();
  const created = await tryAgent('create a workflow called mailer: send an email to me about the week, then a verse about hope', EMAIL, {}, run);
  if (!created?.reply.includes('Heads up: this workflow sends real email')) throw new Error('creation warns: ' + created?.reply);

  const preview = await tryAgent('preview my mailer workflow', EMAIL, created!.profile!, run);
  if (!preview?.reply.includes('sends real email — the run itself will ask')) throw new Error('the preview tags the send step: ' + preview?.reply);
  eq(preview?.profile, undefined, 'previews still change nothing');

  const help = await tryAgent('what are workflows', EMAIL, {}, run);
  if (!help?.reply.includes('send steps back entirely')) throw new Error('help teaches the send law: ' + help?.reply);
  if (!help?.reply.includes('run backup on my pc')) throw new Error('help covers devices now: ' + help?.reply);
  if (!help?.reply.includes('every month on the 15th')) throw new Error('help covers monthly schedules: ' + help?.reply);
});

// ── v43: the reader round — /email/…/send, the single-mail digest, shaped
//        summaries, and the email-aware cleaner ──────────────────────────────

Deno.test('v43: a trailing /send segment turns the slash draft into a send ask', () => {
  eq(parseMailSlash('/email/sam@x.com/Friday plans/See you at 7/send'),
    { to: 'sam@x.com', subject: 'Friday plans', body: 'See you at 7', wantSend: true }, 'the core /send form');
  eq(parseMailSlash('/email/me/Note to self/Do the thing/SEND'),
    { to: 'me', subject: 'Note to self', body: 'Do the thing', wantSend: true }, 'the send word is case-blind');
  eq(parseMailSlash('/email/sam@x.com/Mix notes/Bounce v2, then A/B the levels/send'),
    { to: 'sam@x.com', subject: 'Mix notes', body: 'Bounce v2, then A/B the levels', wantSend: true },
    'the body keeps its own slashes; only the FINAL send segment is consumed');
  eq(parseMailSlash('/email/sam@x.com/Plans/Body here/ send '),
    { to: 'sam@x.com', subject: 'Plans', body: 'Body here', wantSend: true }, 'a padded send still counts');
  eq(parseMailSlash('/email/sam@x.com/Plans/send'),
    { to: 'sam@x.com', subject: 'Plans', body: 'send', wantSend: false },
    'three parts stay a plain draft — the last part is the body, even when it reads "send"');
  eq(parseMailSlash('/email/sam@x.com/Plans/Send it tonight'),
    { to: 'sam@x.com', subject: 'Plans', body: 'Send it tonight', wantSend: false },
    'a body that merely OPENS with send is just a body');
});

Deno.test('v43: "/email/…/send" is a send step — the run-time confirm law covers it', () => {
  eq(isSendStep('/email/me/subject/body/send'), true, 'the slash send gates a workflow run');
  eq(isSendStep('/email/me/subject/body'), false, 'the plain slash draft stays harmless');
  eq(isSendStep('/email/me/hi'), false, 'a malformed slash ask is not a send step');
});

Deno.test('v43: slash sends through tryMail — sign-in, teaching, offline honesty', async () => {
  const anon = await tryMail('/email/sam@x.com/Hi/Body text/send', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous slash sends point at sign-in: ' + anon?.reply);
  const taught = await tryMail('/email/sam@x.com/only a subject', EMAIL, {});
  if (!taught?.reply.includes('/send')) throw new Error('the malformed teach now names the /send tail: ' + taught?.reply);

  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise the real path
  const offline = await tryMail('/email/me/Hi/Body text here/send', EMAIL, {});
  if (!offline?.reply.includes("couldn't reach")) throw new Error('an unreachable slash send is honest: ' + offline?.reply);
});

Deno.test('v43: parseMailDigestOne is anchored to one mail from one sender', () => {
  eq(parseMailDigestOne('summarise the last email from sam'), 'sam', 'the core ask');
  eq(parseMailDigestOne('summarize the latest email from Sam Smith'), 'sam smith', 'z-spelling + full name');
  eq(parseMailDigestOne('digest the newest email from mom'), 'mom', 'digest verb');
  eq(parseMailDigestOne('give me the gist of the last email from sam'), 'sam', 'gist form');
  eq(parseMailDigestOne('what does the last email from sam say'), 'sam', 'question form');
  eq(parseMailDigestOne('summarise my inbox'), null, 'the whole-inbox digest belongs to v34');
  eq(parseMailDigestOne('summarise the bible'), null, 'topic asks stay on the knowledge path');
  eq(parseMailDigestOne('reply to the last email from sam'), null, 'replies belong to the reply command');
  eq(parseMailDigestOne('what does the last email from sam say about the gig'), null, 'the question form is whole-message');
  eq(parseMailDigestOne('summarise the last email from i want to die'), null, 'crisis language never drives a search');
});

Deno.test('v43: the single-mail digest fails honestly offline; anonymous asks point at sign-in', async () => {
  const anon = await tryMail('summarise the last email from sam', '', {});
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous digest points at sign-in: ' + anon?.reply);

  if (Deno.env.get('SUPABASE_URL')) return; // live runs exercise the real path
  const offline = await tryMail('summarise the last email from sam', EMAIL, {});
  if (!offline?.reply.includes("couldn't reach")) throw new Error('an unreachable single-mail digest is honest: ' + offline?.reply);
});

Deno.test('v43: cleanEmailText keeps the message and drops the furniture', () => {
  const raw = [
    'Hi Dian,',
    '',
    'The mix is ready for Friday and the stems are uploaded here: https://drive.example.com/folder/abc123',
    'Let me know if the chorus needs another pass.',
    '',
    'On Tue, 14 Jul 2026, Prophet Dian wrote:',
    '> Can you send the stems?',
    '> Thanks',
    'Sent from my iPhone',
    '--',
    'Sam Smith',
    'Producer, Studio X',
  ].join('\n');
  const out = cleanEmailText(raw);
  if (!out.includes('The mix is ready for Friday')) throw new Error('the real prose survives: ' + out);
  if (!out.includes('(link)')) throw new Error('URLs collapse to (link): ' + out);
  if (out.includes('Can you send the stems')) throw new Error('quoted history is dropped: ' + out);
  if (out.includes('wrote:')) throw new Error('the quote introduction is dropped: ' + out);
  if (out.includes('Sent from my')) throw new Error('device signatures are dropped: ' + out);
  if (out.includes('Producer, Studio X')) throw new Error('everything after the -- delimiter is dropped: ' + out);
  eq(cleanEmailText(''), '', 'empty in, empty out');
  eq(cleanEmailText('> only quotes\n> nothing else'), '', 'a pure quote block cleans to nothing');
});

Deno.test('v43: shaped summaries — one sentence and key points', () => {
  const one = trySummarize(`summarize in one sentence: ${PASTED}`);
  if (!one.startsWith('One sentence:')) throw new Error(`one-sentence shape failed: ${one}`);
  const boiled = trySummarize(`boil down to a single sentence: ${PASTED}`);
  if (!boiled.startsWith('One sentence:')) throw new Error(`boil-down shape failed: ${boiled}`);
  const points = trySummarize(`key points: ${PASTED}`);
  if (!points.startsWith('The key points:')) throw new Error(`key-points shape failed: ${points}`);
  if (!points.includes('• ')) throw new Error(`key points come as bullets: ${points}`);
  const bullets = trySummarize(`bullet points of: ${PASTED}`);
  if (!bullets.startsWith('The key points:')) throw new Error(`bullet-points shape failed: ${bullets}`);
  eq(trySummarize('key points of the bible'), '', 'topic asks stay on the knowledge path');
  eq(trySummarize('summarize in one sentence: too short'), '', 'a short paste is not a text');
  const plain = trySummarize(`summarize: ${PASTED}`);
  if (!plain.startsWith("Here's the heart of it:")) throw new Error(`the classic shape still works: ${plain}`);
});

// ── v46: orchestration — nested workflows, otherwise steps, pause/resume ──────

Deno.test('v46: parseOtherwiseStep, pause/resume parsers, and isPaused', () => {
  eq(parseOtherwiseStep('otherwise: encourage me'), 'encourage me', 'colon form');
  eq(parseOtherwiseStep('otherwise — a verse about rest'), 'a verse about rest', 'dash form');
  eq(parseOtherwiseStep('when it is monday: a verse'), null, 'conditions are not otherwise');
  eq(parseOtherwiseStep('encourage me'), null, 'plain step');
  eq(parseWorkflowPause('pause my morning workflow'), { name: 'morning' }, 'bare pause');
  eq(parseWorkflowPause('suspend the night routine until friday'), { name: 'night', until: 'friday' }, 'until phrase');
  eq(parseWorkflowPause('pause my morning workflow for a week'), { name: 'morning', until: 'a week' }, 'for phrase');
  eq(parseWorkflowPause('pause for a moment'), null, 'conversation is not a pause');
  eq(parseWorkflowResume('resume my morning workflow'), 'morning', 'resume');
  eq(parseWorkflowResume('unpause the night routine'), 'night', 'unpause');
  eq(parseWorkflowResume('resume where we left off'), null, 'conversation is not a resume');
  const wf = { name: 'm', steps: ['x y z'], created: 'now' };
  eq(isPaused({ ...wf, paused: true }, '2026-07-16'), true, 'indefinite pause holds');
  eq(isPaused({ ...wf, paused: '2026-07-20' }, '2026-07-16'), true, 'dated pause holds before the date');
  eq(isPaused({ ...wf, paused: '2026-07-20' }, '2026-07-20'), false, 'wakes on the day itself');
  eq(isPaused(wf, '2026-07-16'), false, 'no pause field');
});

Deno.test('v46: creation allows the chain form, refuses self-reference and management', async () => {
  const { run } = stubRunner();
  const okay = await tryAgent('create a workflow called day: run my morning workflow, then encourage me', EMAIL, { workflows: [{ name: 'morning', steps: ['a verse about strength'], created: 'now' }] }, run);
  if (!okay?.profile?.workflows?.some((w) => w.name === 'day')) throw new Error(`chain step must save: ${okay?.reply}`);

  const self = await tryAgent('create a workflow called loop: run my loop workflow', EMAIL, {}, run);
  if (!self?.reply.includes("can't run itself") || self.profile) throw new Error(`self-reference must refuse: ${self?.reply}`);

  const manage = await tryAgent('create a workflow called bad: delete my morning workflow', EMAIL, {}, run);
  if (!manage?.reply.includes('ordinary asks') || manage.profile) throw new Error(`management steps still refused: ${manage?.reply}`);
});

Deno.test('v46: a nested step runs the whole inner workflow, one level deep', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'outer', steps: ['run my inner workflow', 'encourage me'], created: 'now' },
    { name: 'inner', steps: ['a verse about strength', 'run my outer workflow'], created: 'now' },
  ] };
  const out = await tryAgent('run my outer workflow', EMAIL, profile, run);
  eq(ran, ['a verse about strength', 'encourage me'], 'inner steps ran in place, nested-nested did not');
  if (!out?.reply.includes('one level deep')) throw new Error(`depth guard must speak: ${out?.reply}`);
  const log = out?.profile?.workflowLog ?? [];
  eq(log.map((r) => `${r.name}:${r.via}`), ['inner:nested', 'outer:manual'], 'both runs left receipts');

  const missing = await tryAgent('run my outer workflow', EMAIL, { workflows: [{ name: 'outer', steps: ['run my gone workflow'], created: 'now' }] }, run);
  if (!missing?.reply.includes('no workflow called "gone"')) throw new Error(`missing inner must be honest: ${missing?.reply}`);
});

Deno.test('v46: a nested topic slot passes the outer topic through', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'outer', steps: ['run my study workflow on *'], created: 'now' },
    { name: 'study', steps: ['a verse about *'], created: 'now' },
  ] };
  await tryAgent('run my outer workflow on grace', EMAIL, profile, run);
  eq(ran, ['a verse about grace'], 'the topic flowed outer to inner to step');
});

Deno.test('v46: chaining into a sending workflow is gated like sending yourself', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'outer', steps: ['run my mailer workflow'], created: 'now' },
    { name: 'mailer', steps: ['send an email to me about the day'], created: 'now' },
  ] };
  const out = await tryAgent('run my outer workflow', EMAIL, profile, run);
  eq(ran, [], 'nothing ran before the confirm');
  if (!out?.reply.includes('sends real email')) throw new Error(`the chain must be offered, not run: ${out?.reply}`);
  if (!out?.profile?.runSend) throw new Error('the runSend stamp must ride the profile');
});

Deno.test('v46: otherwise fires on a clean skip, stays quiet otherwise', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [{
    name: 'either',
    steps: ['when i have a mission: my next mission step', 'otherwise: encourage me'],
    created: 'now',
  }] };

  const noMission = await tryAgent('run my either workflow', EMAIL, profile, run);
  eq(ran, ['encourage me'], 'the otherwise ran when the condition failed');
  if (!noMission?.reply.includes('[did: encourage me]')) throw new Error(`otherwise must report: ${noMission?.reply}`);

  ran.length = 0;
  const withMission: Profile = { ...profile, mission: { goal: 'ship it', steps: ['step one'], done: 0, created: 'now' } };
  const quiet = await tryAgent('run my either workflow', EMAIL, withMission, run);
  eq(ran, [], 'the mission literal ran instead (no engine call), the otherwise stayed quiet');
  if (!quiet?.reply.includes('otherwise stays quiet')) throw new Error(`quiet otherwise must say why: ${quiet?.reply}`);

  const orphanProfile: Profile = { workflows: [{ name: 'o', steps: ['otherwise: encourage me'], created: 'now' }] };
  const orphan = await tryAgent('run my o workflow', EMAIL, orphanProfile, run);
  if (!orphan?.reply.includes('right before it')) throw new Error(`orphan must teach: ${orphan?.reply}`);

  const unknownProfile: Profile = { workflows: [{ name: 'u', steps: ['when the moon is full: a verse', 'otherwise: encourage me'], created: 'now' }] };
  ran.length = 0;
  const unknown = await tryAgent('run my u workflow', EMAIL, unknownProfile, run);
  eq(ran, [], 'an unknown condition quiets both branches');
  if (!unknown?.reply.includes('stays quiet too')) throw new Error(`unknown-condition otherwise must say why: ${unknown?.reply}`);
});

Deno.test('v46: pause holds every door — manual, trigger, schedule — and resume opens them', async () => {
  const { ran, run } = stubRunner();
  let profile: Profile = { workflows: [{ name: 'morning', steps: ['a verse about strength'], created: 'now', daily: true, trigger: 'good morning' }] };

  const paused = await tryAgent('pause my morning workflow', EMAIL, profile, run);
  eq(paused?.profile?.workflows?.[0].paused, true, 'pause stored');
  profile = paused!.profile!;

  const manual = await tryAgent('run my morning workflow', EMAIL, profile, run);
  eq(ran, [], 'a paused workflow never runs');
  if (!manual?.reply.includes('paused')) throw new Error(`manual run must name the pause: ${manual?.reply}`);

  const trig = await tryAgent('good morning', EMAIL, profile, run);
  if (!trig?.reply.includes('paused')) throw new Error(`trigger must name the pause: ${trig?.reply}`);
  eq(ran, [], 'the trigger slept too');

  eq(await runDailyWorkflows(profile, run, '2026-07-16', EMAIL), null, 'the schedule sleeps silently');

  const listed = await tryAgent('list my workflows', EMAIL, profile, run);
  if (!listed?.reply.includes('paused')) throw new Error(`the list must name the pause: ${listed?.reply}`);

  const resumed = await tryAgent('resume my morning workflow', EMAIL, profile, run);
  eq(resumed?.profile?.workflows?.[0].paused, undefined, 'resume clears the field');
  profile = resumed!.profile!;
  const daily = await runDailyWorkflows(profile, run, '2026-07-16', EMAIL);
  if (!daily) throw new Error('the schedule works again after resume');
  eq(ran, ['a verse about strength'], 'the run is real again');
});

Deno.test('v46: a dated pause wakes by itself; bad pause phrases teach or refuse', async () => {
  const { run } = stubRunner();
  const profile: Profile = { workflows: [{ name: 'm', steps: ['a verse about hope'], created: 'now', daily: true }] };

  const until = await tryAgent('pause my m workflow until tomorrow', EMAIL, profile, run);
  const stamp = until?.profile?.workflows?.[0].paused;
  if (typeof stamp !== 'string') throw new Error(`dated pause must store the date: ${until?.reply}`);
  eq(await runDailyWorkflows(until!.profile!, run, stamp, EMAIL) !== null, true, 'awake on the wake day itself');

  const unknown = await tryAgent('pause my m workflow until the cows come home', EMAIL, profile, run);
  if (!unknown?.reply.includes('until friday') || unknown.profile) throw new Error(`unknown phrase teaches: ${unknown?.reply}`);
  const past = await tryAgent('pause my m workflow until today', EMAIL, profile, run);
  if (!past?.reply.includes('after today') || past.profile) throw new Error(`today refused: ${past?.reply}`);
  const nothing = await tryAgent('resume my m workflow', EMAIL, profile, run);
  if (!nothing?.reply.includes("isn't paused") || nothing.profile) throw new Error(`resuming the unpaused answers honestly: ${nothing?.reply}`);
});

Deno.test('v46: previews see otherwise branches and name chained workflows', async () => {
  const { ran, run } = stubRunner();
  const profile: Profile = { workflows: [
    { name: 'either', steps: ['when i have a mission: my next mission step', 'otherwise: encourage me'], created: 'now' },
    { name: 'outer', steps: ['run my inner workflow'], created: 'now' },
    { name: 'inner', steps: ['a verse about strength', 'encourage me'], created: 'now' },
  ] };
  const p1 = await tryAgent('preview my either workflow', EMAIL, profile, run);
  if (!p1?.reply.includes('this otherwise fires')) throw new Error(`preview must show the live branch: ${p1?.reply}`);
  const p2 = await tryAgent('preview my outer workflow', EMAIL, profile, run);
  if (!p2?.reply.includes('runs your "inner" workflow — 2 steps of its own')) throw new Error(`preview must name the chain: ${p2?.reply}`);
  eq(ran, [], 'previews never execute');
});


// ── v47: the chronicle round — per-step receipts, the re-run form, deadlines ─

Deno.test('v47: parseLastRun reads bare and named receipt asks, nothing else', () => {
  eq(parseLastRun('what did my last run do'), {}, 'bare form');
  eq(parseLastRun('what did my last workflow run do'), {}, 'bare with the workflow word');
  eq(parseLastRun('how did my last run go'), {}, 'go form');
  eq(parseLastRun('show me my last workflow run'), {}, 'show form');
  eq(parseLastRun('what did my last study run do'), { name: 'study' }, 'named form');
  eq(parseLastRun('what did my last study workflow run do'), { name: 'study' }, 'named with the workflow word');
  eq(parseLastRun('show my last morning run'), { name: 'morning' }, 'named show form');
  eq(parseLastRun('what did my last run do yesterday'), null, 'trailing words are not the ask');
  eq(parseLastRun('what did the teacher do'), null, 'ordinary conversation untouched');
});

Deno.test('v47: parseWorkflowRunAgain reads named and bare re-run asks', () => {
  eq(parseWorkflowRunAgain('run my study workflow again'), { name: 'study' }, 'named again');
  eq(parseWorkflowRunAgain('rerun my study workflow'), { name: 'study' }, 'rerun verb');
  eq(parseWorkflowRunAgain('re-run the morning routine'), { name: 'morning' }, 'hyphenated + routine');
  eq(parseWorkflowRunAgain('run that again'), {}, 'bare form');
  eq(parseWorkflowRunAgain('run the last run again'), {}, 'last-run form');
  eq(parseWorkflowRunAgain('run my last workflow again'), {}, 'my-last form stays bare, never a name');
  eq(parseWorkflowRunAgain('run my study workflow'), null, 'a plain run is not ours');
  eq(parseWorkflowRunAgain('play that song again'), null, 'ordinary conversation untouched');
});

Deno.test('v47: a run stamps per-step outcomes and the read-back tells the story', async () => {
  const { run } = stubRunner('encourage me');
  const profile: Profile = { workflows: [{
    name: 'mixed',
    steps: ['a verse about *', 'when i have a mission: my next mission step', 'encourage me'],
    created: 'now',
  }] };
  const out = await tryAgent('run my mixed workflow on grace', EMAIL, profile, run);
  const log = out?.profile?.workflowLog;
  if (!log?.length) throw new Error('the run must leave a receipt');
  eq(log[0].topic, 'grace', 'the receipt keeps the topic');
  eq(log[0].steps?.map((s) => s.o), ['ran', 'skipped', 'failed'], 'each step fate recorded');
  if (!log[0].steps?.[1].w?.includes("wasn't the case")) throw new Error('the skip keeps its why: ' + JSON.stringify(log[0].steps));

  const read = await tryAgent('what did my last run do', EMAIL, out!.profile!, run);
  if (!read?.reply.includes('"mixed" on "grace"')) throw new Error('the read-back names run and topic: ' + read?.reply);
  if (!read?.reply.includes('✓ ran — a verse about grace')) throw new Error('ran steps read back: ' + read?.reply);
  if (!read?.reply.includes('– skipped')) throw new Error('skipped steps read back: ' + read?.reply);
  if (!read?.reply.includes("✗ couldn't execute — encourage me")) throw new Error('failed steps read back: ' + read?.reply);
  if (!read?.reply.includes('1 of 3 steps ran')) throw new Error('the count is honest: ' + read?.reply);
  eq(read?.profile, undefined, 'the read-back changes nothing');
});

Deno.test('v47: the named read-back finds that workflow; empty and pre-v47 receipts answer honestly', async () => {
  const { run } = stubRunner();
  eq((await tryAgent('what did my last run do', EMAIL, {}, run))?.reply.includes('No runs on the receipts yet'), true, 'empty log is honest');

  const p: Profile = { workflowLog: [
    { name: 'old', date: '2026-07-10', via: 'manual' },
    { name: 'fresh', date: '2026-07-15', via: 'daily', steps: [{ s: 'a verse about hope', o: 'ran' }] },
  ] };
  const named = await tryAgent('what did my last old run do', EMAIL, p, run);
  if (!named?.reply.includes('predates per-step receipts')) throw new Error('a pre-v47 receipt says so: ' + named?.reply);
  const bare = await tryAgent('what did my last run do', EMAIL, p, run);
  if (!bare?.reply.includes('"fresh"')) throw new Error('bare takes the newest: ' + bare?.reply);
  if (!bare?.reply.includes('daily auto-run')) throw new Error('the via is named: ' + bare?.reply);
  const missing = await tryAgent('what did my last ghost run do', EMAIL, p, run);
  if (!missing?.reply.includes('No "ghost" run on the receipts')) throw new Error('an unknown name is honest: ' + missing?.reply);
});

Deno.test('v47: "run my X workflow again" replays the receipt topic; bare "run that again" takes the newest', async () => {
  const { ran, run } = stubRunner();
  let profile: Profile = { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now' }] };

  const first = await tryAgent('run my study workflow on grace', EMAIL, profile, run);
  profile = first!.profile!;
  eq(ran, ['a verse about grace'], 'the first run filled the slot');

  ran.length = 0;
  const again = await tryAgent('run my study workflow again', EMAIL, profile, run);
  eq(ran, ['a verse about grace'], 'again replays the same topic');
  if (!again?.reply.includes('replaying the last run\'s topic, "grace"')) throw new Error('the replay is named: ' + again?.reply);
  profile = again!.profile!;

  ran.length = 0;
  const bare = await tryAgent('run that again', EMAIL, profile, run);
  eq(ran, ['a verse about grace'], 'bare form replays the newest receipt');
  if (!bare?.profile?.workflowLog?.length) throw new Error('the re-run leaves its own receipt');
});

Deno.test('v47: the re-run form keeps every gate — slot, pause, send confirm, honesty', async () => {
  const { ran, run } = stubRunner();

  // A slotted workflow with no receipt has nothing to replay.
  const slotted: Profile = { workflows: [{ name: 'study', steps: ['a verse about *'], created: 'now' }] };
  const noReceipt = await tryAgent('run my study workflow again', EMAIL, slotted, run);
  eq(ran, [], 'nothing ran without a topic');
  if (!noReceipt?.reply.includes('nothing to replay')) throw new Error('the missing topic is honest: ' + noReceipt?.reply);

  // A plain workflow with no receipt just runs fresh — "again" can only mean "run it".
  const plain: Profile = { workflows: [{ name: 'm', steps: ['a verse about hope'], created: 'now' }] };
  const fresh = await tryAgent('run my m workflow again', EMAIL, plain, run);
  eq(ran, ['a verse about hope'], 'no slot means a fresh run is the honest again');
  if (!fresh?.profile?.workflowLog?.length) throw new Error('and it leaves a receipt');

  // Paused workflows stay asleep.
  ran.length = 0;
  const paused: Profile = { workflows: [{ name: 'm', steps: ['a verse about hope'], created: 'now', paused: true }], workflowLog: [{ name: 'm', date: '2026-07-15', via: 'manual' }] };
  const held = await tryAgent('run my m workflow again', EMAIL, paused, run);
  eq(ran, [], 'a paused workflow never re-runs');
  if (!held?.reply.includes('paused')) throw new Error('the pause is named: ' + held?.reply);

  // The send law never sleeps: a re-run of a sender is offered, not run.
  const sender: Profile = {
    workflows: [{ name: 'mailer', steps: ['send an email to me about *'], created: 'now' }],
    workflowLog: [{ name: 'mailer', date: '2026-07-15', via: 'manual', topic: 'the day' }],
  };
  const offer = await tryAgent('run my mailer workflow again', EMAIL, sender, run);
  eq(ran, [], 'nothing ran before the confirm');
  if (!offer?.reply.includes('sends real email')) throw new Error('the re-run is offered: ' + offer?.reply);
  eq(offer?.profile?.runSend?.topic, 'the day', 'the replayed topic rides the offer stamp');

  // A vanished workflow answers honestly on the bare form.
  const ghost: Profile = { workflowLog: [{ name: 'gone', date: '2026-07-15', via: 'manual' }] };
  const gone = await tryAgent('run that again', EMAIL, ghost, run);
  if (!gone?.reply.includes("isn't on the shelf anymore")) throw new Error('a vanished workflow is honest: ' + gone?.reply);
  eq((await tryAgent('run that again', EMAIL, {}, run))?.reply.includes('No runs on the receipts yet'), true, 'an empty log is honest');
});

Deno.test('v47: parseMissionDeadline reads the deadline forms, nothing else', () => {
  eq(parseMissionDeadline('finish this mission by friday'), 'friday', 'finish by');
  eq(parseMissionDeadline('complete my mission by 25 december'), '25 december', 'complete by');
  eq(parseMissionDeadline('set my mission deadline to tomorrow'), 'tomorrow', 'set to');
  eq(parseMissionDeadline('my mission is due on friday'), 'friday', 'due on');
  eq(parseMissionDeadline('finish this mission'), null, 'no date, no deadline');
  eq(parseMissionDeadline('i finished the mission'), null, 'past tense is the done path');
});

Deno.test('v47: mission deadline lifecycle — set, status, show, clear, teach, refuse', async () => {
  const { run } = stubRunner();
  let profile: Profile = { mission: { goal: 'ship the ep', steps: ['a', 'b', 'c'], done: 1, created: 'now' } };

  const teach = await tryAgent('finish this mission by the twelfth of never', EMAIL, profile, run);
  if (!teach?.reply.includes('by friday') || teach.profile) throw new Error('unknown phrasing teaches: ' + teach?.reply);

  const set = await tryAgent('finish this mission by tomorrow', EMAIL, profile, run);
  const due = set?.profile?.mission?.deadline;
  if (!due) throw new Error('the deadline must be stored: ' + set?.reply);
  if (!set?.reply.includes('due tomorrow')) throw new Error('the countdown speaks: ' + set?.reply);
  if (!set?.reply.includes('2 steps')) throw new Error('the remaining steps are named: ' + set?.reply);
  profile = set!.profile!;

  const status = await tryAgent('mission status', EMAIL, profile, run);
  if (!status?.reply.includes('Deadline: due tomorrow')) throw new Error('status counts it down: ' + status?.reply);
  const show = await tryAgent('when is my mission due', EMAIL, profile, run);
  if (!show?.reply.includes('due tomorrow')) throw new Error('the show form answers: ' + show?.reply);

  const cleared = await tryAgent('clear my mission deadline', EMAIL, profile, run);
  eq(cleared?.profile?.mission?.deadline, undefined, 'clear removes the date');
  if (!cleared?.reply.includes('back on your own clock')) throw new Error('clear says so: ' + cleared?.reply);

  const noneToClear = await tryAgent('clear my mission deadline', EMAIL, cleared!.profile!, run);
  if (!noneToClear?.reply.includes('no deadline to clear') || noneToClear.profile) throw new Error('clearing nothing is honest: ' + noneToClear?.reply);
  const noneToShow = await tryAgent('when is my mission due', EMAIL, cleared!.profile!, run);
  if (!noneToShow?.reply.includes('no deadline')) throw new Error('showing nothing is honest: ' + noneToShow?.reply);

  const noMission = await tryAgent('finish this mission by friday', EMAIL, {}, run);
  if (!noMission?.reply.includes('No active mission')) throw new Error('deadline talk with no mission is honest: ' + noMission?.reply);
});

Deno.test('v47: the deadline nudge speaks as the date closes in, once per day, above the idle rule', () => {
  const mk = (deadline: string): Profile => ({
    mission: { goal: 'ship it', steps: ['a', 'b'], done: 0, created: '2026-07-15T00:00:00Z', touched: '2026-07-15T00:00:00Z', deadline },
  });

  eq(missionNudge(mk('2026-07-20'), '2026-07-16'), null, 'four days out stays quiet');
  const soon = missionNudge(mk('2026-07-18'), '2026-07-16');
  if (!soon?.note.includes('due in 2 days')) throw new Error('two days out speaks: ' + soon?.note);
  eq(soon?.profile.mission?.deadlineNudged, '2026-07-16', 'the day is stamped');
  eq(missionNudge(soon!.profile, '2026-07-16'), null, 'once per day only');

  const today = missionNudge(mk('2026-07-16'), '2026-07-16');
  if (!today?.note.includes('due TODAY')) throw new Error('due today speaks: ' + today?.note);
  const late = missionNudge(mk('2026-07-14'), '2026-07-16');
  if (!late?.note.includes('the date passed, the goal didn\'t')) throw new Error('overdue is honest: ' + late?.note);

  // The idle rule still works when no deadline presses (v27 behaviour intact).
  const idle: Profile = { mission: { goal: 'ship it', steps: ['a'], done: 0, created: '2026-07-10T00:00:00Z', touched: '2026-07-10T00:00:00Z' } };
  const nudged = missionNudge(idle, '2026-07-16');
  if (!nudged?.note.includes('still open')) throw new Error('the idle nudge survives: ' + nudged?.note);
});

Deno.test('v47: deadline conditions — due soon and overdue, sync and honest', async () => {
  const t = '2026-07-16';
  const withDl = (d: string): Profile => ({ mission: { goal: 'g', steps: ['a'], done: 0, created: 'now', deadline: d } });
  eq(await evalCondition('my mission is due soon', withDl('2026-07-18'), t), true, 'two days out is soon');
  eq(await evalCondition('my mission is due soon', withDl('2026-07-25'), t), false, 'nine days out is not');
  eq(await evalCondition('my mission is due soon', withDl('2026-07-14'), t), false, 'overdue is not "due soon"');
  eq(await evalCondition('my mission is due soon', {}, t), false, 'no mission, nothing due');
  eq(await evalCondition("my mission isn't due soon", withDl('2026-07-25'), t), true, 'negation holds far out');
  eq(await evalCondition('my mission is overdue', withDl('2026-07-14'), t), true, 'past the date is overdue');
  eq(await evalCondition('my mission is overdue', withDl('2026-07-16'), t), false, 'due today is not overdue yet');
  eq(await evalCondition('my mission is overdue', {}, t), false, 'no deadline, never overdue');
  eq(await evalCondition("my mission isn't overdue", {}, t), true, 'and the negation is honestly true');
});

Deno.test('v47: mission completion names a beaten deadline; the new asks cover sign-in', async () => {
  const { run } = stubRunner();
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const profile: Profile = { mission: { goal: 'ship it', steps: ['only step'], done: 0, created: 'now', deadline: future } };
  const won = await tryAgent('done', EMAIL, profile, run);
  if (!won?.reply.includes('ahead of your')) throw new Error('a beaten deadline is celebrated: ' + won?.reply);
  eq(won?.profile?.mission, undefined, 'mission closed');

  eq(isAgentAsk('what did my last run do'), true, 'read-back is an agent ask');
  eq(isAgentAsk('run my study workflow again'), true, 're-run is an agent ask');
  eq(isAgentAsk('finish this mission by friday'), true, 'deadline set is an agent ask');
  eq(isAgentAsk('clear my mission deadline'), true, 'deadline clear is an agent ask');
  eq(isAgentAsk('when is my mission due'), true, 'deadline show is an agent ask');
  const anon = await tryAgent('finish this mission by friday', '', {}, run);
  if (!anon?.reply.includes('signed in')) throw new Error('anonymous deadline asks get the sign-in prompt: ' + anon?.reply);
});

Deno.test('v47: ordinary conversation still falls through the new parsers', async () => {
  const { run } = stubRunner();
  eq(await tryAgent('i will finish my homework by friday', EMAIL, {}, run), null, 'homework is not a mission');
  eq(await tryAgent('what did the last prophet do', EMAIL, {}, run), null, 'history questions untouched');
  eq(await tryAgent('again', EMAIL, {}, run), null, 'a bare "again" is conversation');
  eq(await tryAgent('run it back one more time', EMAIL, {}, run), null, 'loose replay talk untouched');
  eq(parseWorkflowRun('run my study workflow again') === null, true, 'the plain run parser never eats the again form');
});
