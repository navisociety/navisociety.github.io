// Regression suite for navi-choice's pure decision-scoring/answer-building logic.
// Run with (dummy Supabase env vars needed because importing index.ts runs
// createClient() and serve() at module load time as a side effect - neither
// is actually exercised by these tests):
//   SUPABASE_URL=http://localhost:0 SUPABASE_SERVICE_ROLE_KEY=test \
//     deno test --allow-net --allow-env supabase/functions/navi-choice/_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {
  parseList,
  wordCount,
  scoreVerdict,
  buildAnswer,
  weighItem,
  weighList,
  usableInsight,
} from './index.ts';

Deno.test('parseList', () => {
  assertEquals(parseList('a\nb\n\n c \n'), ['a', 'b', 'c']);
  assertEquals(parseList(''), []);
  assertEquals(parseList('   \n  '), []);
});

Deno.test('wordCount', () => {
  assertEquals(wordCount('one two three'), 3);
  assertEquals(wordCount('  spaced   out   words  '), 3);
  assertEquals(wordCount(''), 0);
});

Deno.test('scoreVerdict buckets', () => {
  assertEquals(scoreVerdict(5, 1), 'Go for it');
  assertEquals(scoreVerdict(2, 1), 'Lean toward yes');
  assertEquals(scoreVerdict(2, 2), "It's a genuine toss-up");
  assertEquals(scoreVerdict(1, 2), 'Lean toward no');
  assertEquals(scoreVerdict(0, 5), "Don't do it");
});

Deno.test('weighItem boosts life themes over neutral notes', () => {
  const neutral = weighItem('Nicer office');
  const health = weighItem('My health is suffering badly');
  const faith = weighItem('It would pull me away from my church community');
  assert(health.weight > neutral.weight, 'health point should outweigh a neutral one');
  assert(faith.weight > neutral.weight, 'faith/people point should outweigh a neutral one');
  assertEquals(neutral.theme, null);
  assert(health.theme !== null && health.theme.name.includes('health'));
});

Deno.test('weighted verdict can disagree with the raw count', () => {
  const pros = ['Slightly cheaper', 'A bit closer to the shops'];
  const cons = ['It would take me away from my family and my church community'];
  // 2 pros vs 1 con by count, but the single con carries far more weight.
  assert(weighList(cons) > weighList(pros), 'heavy con should outweigh two light pros');
  assertEquals(scoreVerdict(weighList(pros), weighList(cons)), 'Lean toward no');
  const answer = buildAnswer('Move to the cheaper flat?', pros, cons);
  assert(answer.startsWith('Best choice: Lean toward no.'), 'answer verdict should follow the weights, not the count');
  assert(answer.includes('by raw count your list leans the other way'), 'answer should call out the count-vs-substance mismatch');
});

Deno.test('answer quotes and discusses the heaviest points', () => {
  const pros = ['Higher pay', 'Better growth'];
  const cons = ['I would never see my kids in the evenings'];
  const answer = buildAnswer('Should I take the new job?', pros, cons);
  assert(answer.includes('"I would never see my kids in the evenings"'), 'heaviest con should be quoted');
  assert(answer.includes('people in your life'), 'heaviest con should get theme commentary');
});

Deno.test('NAVI LLM insights are woven into the answer when provided', () => {
  const insight = 'Purpose is not found, it is built through commitment over time.';
  const answer = buildAnswer('Should I take the new job?', ['Higher pay'], ['Longer commute'], {
    question: insight,
    crux: 'Time is the one resource you never get back.',
    cruxText: 'Longer commute',
  });
  assert(answer.includes(insight), 'question insight should appear in the answer');
  assert(answer.includes('And on "Longer commute" specifically:'), 'crux insight should be attributed to the item');
  assert(wordCount(answer) >= 200, 'answer with insights must still clear the word minimum');
});

Deno.test('usableInsight filters fallbacks, strips trailing questions, trims to 3 sentences', () => {
  const keep = 'Discipline is choosing what you want most over what you want now, and it compounds.';
  assertEquals(usableInsight(keep), keep);
  // NAVI's conversational closing question is stripped, the substance kept.
  assertEquals(
    usableInsight("Purpose usually reveals itself through what you keep returning to — even when it's hard. What keeps pulling you back?"),
    "Purpose usually reveals itself through what you keep returning to — even when it's hard.",
  );
  assertEquals(usableInsight(''), '');
  assertEquals(usableInsight('short'), '');
  assertEquals(usableInsight("I don't have a sharp answer for that yet — but I'm growing. Tell me more."), '');
  // Pure counter-question with no substance left after stripping.
  assertEquals(usableInsight("What's actually going on?"), '');
  assertEquals(usableInsight('One is enough. Two is plenty. Three is the cap. Four is dropped. Five too.'), 'One is enough. Two is plenty. Three is the cap.');
});

Deno.test('buildAnswer always meets the 200-word minimum and states the verdict first and last', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['Should I take the new job?', ['Higher pay', 'Better growth'], ['Longer commute']],
    ['Move cities?', [], []],
    ['One pro one con', ['a'], ['b']],
    ['Lots of both', ['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']],
    ['Heavily against', [], ['a', 'b', 'c', 'd', 'e']],
  ];
  for (const [question, pros, cons] of cases) {
    const verdict = scoreVerdict(weighList(pros), weighList(cons));
    const answer = buildAnswer(question, pros, cons);
    const count = wordCount(answer);
    assert(count >= 200, `expected >=200 words, got ${count} for "${question}"`);
    assert(answer.startsWith(`Best choice: ${verdict}.`), `answer should open with the verdict for "${question}"`);
    assert(answer.trim().endsWith(`the best choice is ${verdict}.`), `answer should close by restating the verdict for "${question}"`);
  }
});
