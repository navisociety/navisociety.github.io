// Regression suite for navi-create's pure prompt-parsing/design logic.
// Run with (dummy Supabase env vars needed because importing index.ts runs
// createClient() and serve() at module load time as a side effect - neither
// is actually exercised by these tests, but the import will throw/bind a
// port without them):
//   SUPABASE_URL=http://localhost:0 SUPABASE_SERVICE_ROLE_KEY=test \
//     deno test --allow-net --allow-env supabase/functions/navi-create/_test.ts
//
// Covers deriveTitle, extractHeadlineBody (splitting the one prompt box into
// a headline + body), font-fit shrink sizing, and a runtime smoke test that
// actually invokes pptxgenjs to generate real .pptx bytes at the fixed
// 1080x1920 design size. No AI/network calls beyond the pptxgenjs CDN import
// - all logic under test is pure string handling.
import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {
  deriveTitle, extractHeadlineBody, estimateLines, fitFontSize, buildPptx,
} from './index.ts';

Deno.test('deriveTitle', () => {
  assertEquals(deriveTitle('  '), 'New Creation');
  assertEquals(deriveTitle('Sunday Service Announcement Flyer For Everyone Extra'), 'Sunday Service Announcement Flyer For Everyone');
});

Deno.test('headline extraction', () => {
  assertEquals(extractHeadlineBody('Title\nLine1\nLine2'), { heading: 'Title', body: 'Line1\nLine2' });
  assertEquals(extractHeadlineBody('\n\nTitle only'), { heading: 'Title only', body: '' });
  assertEquals(extractHeadlineBody(''), { heading: '', body: '' });
});

Deno.test('font-fit sizing sanity', () => {
  assert(estimateLines('short', 20, 5) >= 1);
  assert(fitFontSize(['a very long paragraph '.repeat(30)], 3, 1, 44, 10) < 44);
  assertEquals(fitFontSize(['hi'], 5, 5, 44, 10), 44);
});

// ---- Runtime smoke test: actually invoke pptxgenjs, not just types ----
Deno.test('buildPptx generates valid pptx bytes', async () => {
  const cases: Array<[string, () => Promise<Uint8Array>]> = [
    ['heading + body', () => buildPptx('Join Us', 'Sunday 10AM')],
    ['heading only', () => buildPptx('Logo', '')],
    ['body only', () => buildPptx('', 'Just body text')],
    ['empty content', () => buildPptx('', '')],
    ['long content auto-shrink', () => buildPptx('A Very Long Heading That Should Shrink To Fit The Box Properly', 'A very long body paragraph. '.repeat(20))],
  ];
  for (const [label, fn] of cases) {
    const bytes = await fn();
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK" zip magic
    assert(bytes.length > 1000 && isZip, `${label}: expected a valid-looking non-trivial pptx, got ${bytes.length} bytes, isZip=${isZip}`);
  }
});
