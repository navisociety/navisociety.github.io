// Regression suite for navi-choice's pure decision-scoring/answer-building logic.
// Run with (dummy Supabase env vars needed because importing index.ts runs
// createClient() and serve() at module load time as a side effect - neither
// is actually exercised by these tests):
//   SUPABASE_URL=http://localhost:0 SUPABASE_SERVICE_ROLE_KEY=test \
//     deno test --allow-net --allow-env supabase/functions/navi-choice/_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { parseList, wordCount, scoreVerdict, buildAnswer } from './index.ts';

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

Deno.test('buildAnswer always meets the 200-word minimum and states the verdict first and last', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['Should I take the new job?', ['Higher pay', 'Better growth'], ['Longer commute']],
    ['Move cities?', [], []],
    ['One pro one con', ['a'], ['b']],
    ['Lots of both', ['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']],
    ['Heavily against', [], ['a', 'b', 'c', 'd', 'e']],
  ];
  for (const [question, pros, cons] of cases) {
    const verdict = scoreVerdict(pros.length, cons.length);
    const answer = buildAnswer(question, pros, cons);
    const count = wordCount(answer);
    assert(count >= 200, `expected >=200 words, got ${count} for "${question}"`);
    assert(answer.startsWith(`Best choice: ${verdict}.`), `answer should open with the verdict for "${question}"`);
    assert(answer.trim().endsWith(`the best choice is ${verdict}.`), `answer should close by restating the verdict for "${question}"`);
  }
});
