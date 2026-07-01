// Regression suite for navi-create's pure prompt-parsing/design logic.
// Run with (dummy Supabase env vars needed because importing index.ts runs
// createClient() and serve() at module load time as a side effect - neither
// is actually exercised by these tests, but the import will throw/bind a
// port without them):
//   SUPABASE_URL=http://localhost:0 SUPABASE_SERVICE_ROLE_KEY=test \
//     deno test --allow-net --allow-env supabase/functions/navi-create/_test.ts
//
// Covers deriveDesignType (including false-positive guards for ordinary
// English words like "story"/"video"/"pin" that must NOT hijack detection
// when a more specific type is also present - a real bug found and fixed
// 2026-07-01), deriveStyle (colors/font/size/align/valign/uppercase/border,
// including a hex-color regex-boundary bug fixed the same day), shape
// detection, multi-slide/bullet/table content parsing, and a runtime smoke
// test that actually invokes pptxgenjs to generate real .pptx bytes for a
// range of style combinations. No AI/network calls beyond the pptxgenjs CDN
// import - all logic under test is pure regex/string handling.
import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {
  preset, custom, deriveDesignType, deriveTitle, deriveStyle, deriveShape,
  deriveAlign, deriveVAlign, splitIntoSlides, extractHeadlineBody, isBulletList,
  parseTableRows, estimateLines, fitFontSize, buildPptx, DEFAULT_DESIGN,
} from './index.ts';

// ---- deriveDesignType: correctness on clear cases ----
Deno.test('design type: clear single-signal prompts', () => {
  assertEquals(deriveDesignType('Instagram post about Sunday service'), custom(1080, 1080));
  assertEquals(deriveDesignType('Instagram story for youth night'), custom(1080, 1920));
  assertEquals(deriveDesignType('a fun reel for TikTok'), custom(1080, 1920));
  assertEquals(deriveDesignType('Facebook cover photo for our church page'), custom(820, 312));
  assertEquals(deriveDesignType('LinkedIn banner for the ministry'), custom(1584, 396));
  assertEquals(deriveDesignType('Twitter header image'), custom(1500, 500));
  assertEquals(deriveDesignType('YouTube channel art banner'), custom(2560, 1440));
  assertEquals(deriveDesignType('book cover for the new devotional'), custom(1600, 2400));
  assertEquals(deriveDesignType('album cover for the worship EP'), custom(3000, 3000));
  assertEquals(deriveDesignType('podcast cover art'), custom(3000, 3000));
  assertEquals(deriveDesignType('Facebook post announcing the fundraiser'), custom(1200, 630));
  assertEquals(deriveDesignType('a Pinterest pin for the recipe'), custom(1000, 1500));
  assertEquals(deriveDesignType('YouTube thumbnail for the sermon'), custom(1280, 720));
  assertEquals(deriveDesignType('a promotional video'), custom(1920, 1080));
  assertEquals(deriveDesignType('zoom background for bible study'), custom(1920, 1080));
  assertEquals(deriveDesignType('a poster for Sunday service at 10am'), custom(2480, 3508));
  assertEquals(deriveDesignType('flyer for the youth retreat'), custom(2480, 3508));
  assertEquals(deriveDesignType('postcard invite for Easter'), custom(1500, 1050));
  assertEquals(deriveDesignType('business card for pastor John'), custom(1050, 600));
  assertEquals(deriveDesignType('name tag for volunteers'), custom(1050, 675));
  assertEquals(deriveDesignType('logo for the youth ministry'), custom(500, 500));
  assertEquals(deriveDesignType('sticker for the kids program'), custom(800, 800));
  assertEquals(deriveDesignType('desktop wallpaper with scripture'), custom(1920, 1080));
  assertEquals(deriveDesignType('certificate of completion'), custom(3300, 2550));
  assertEquals(deriveDesignType('infographic about giving'), custom(1080, 2700));
  assertEquals(deriveDesignType('brochure for the mission trip'), custom(2550, 3300));
  assertEquals(deriveDesignType('letterhead for the church office'), custom(2550, 3300));
  assertEquals(deriveDesignType('menu for the fellowship dinner'), custom(1275, 1650));
  assertEquals(deriveDesignType('planner for the ministry year'), custom(2550, 3300));
  assertEquals(deriveDesignType('invitation to the baptism'), custom(1500, 1050));
  assertEquals(deriveDesignType('resume for the youth pastor position'), preset('doc'));
  assertEquals(deriveDesignType('newsletter for the congregation'), preset('email'));
  assertEquals(deriveDesignType('whiteboard brainstorm for outreach'), preset('whiteboard'));
  assertEquals(deriveDesignType('a document with the sermon notes'), preset('doc'));
  assertEquals(deriveDesignType('a presentation for the elders meeting'), preset('presentation'));
  assertEquals(deriveDesignType('something completely generic'), DEFAULT_DESIGN);
});

// ---- deriveDesignType: false-positive guards (church/faith language that must NOT misfire) ----
Deno.test('design type: false-positive guards for weak bare words', () => {
  assertEquals(deriveDesignType('A poster telling the story of the prodigal son'), custom(2480, 3508));
  assertEquals(deriveDesignType('Flyer sharing our testimony story for the youth group'), custom(2480, 3508));
  assertEquals(deriveDesignType('A poster for our video sermon series launch'), custom(2480, 3508));
  assertEquals(deriveDesignType('Pin the announcement flyer on the noticeboard'), custom(2480, 3508));
  assertEquals(deriveDesignType('A business card with a pin icon'), custom(1050, 600));
  assertEquals(deriveDesignType('Our Story - about us document'), preset('doc'));
});

Deno.test('deriveTitle', () => {
  assertEquals(deriveTitle('  '), 'New Creation');
  assertEquals(deriveTitle('Sunday Service Announcement Flyer For Everyone Extra'), 'Sunday Service Announcement Flyer For Everyone');
});

// ---- deriveStyle: colors (includes the hex-boundary regression) ----
Deno.test('style: color detection', () => {
  assertEquals(deriveStyle('black poster with cyan text').text, '00FFFF');
  assertEquals(deriveStyle('a poster, #00F7FF background').bg, '00F7FF');
  assertEquals(deriveStyle('background colour: navy, text color: gold').bg, '000080');
  assertEquals(deriveStyle('background colour: navy, text color: gold').text, 'FFD700');
  assertEquals(deriveStyle('poster with #0FF accent').accent, '00FFFF');
  assertEquals(deriveStyle('poster with a black poster').bg, undefined);
});

Deno.test('style: font detection', () => {
  assertEquals(deriveStyle('poster in Bebas Neue font').font, 'Bebas Neue');
  assertEquals(deriveStyle('poster, font: "Playfair Display"').font, 'Playfair Display');
  assertEquals(deriveStyle('a poster in Fredoka').font, 'Fredoka');
  assertEquals(deriveStyle('a poster in Bebas Neue font').font, 'Bebas Neue');
});

Deno.test('style: size detection', () => {
  assertEquals(deriveStyle('poster, 44pt text').sizePt, 44);
  assertEquals(deriveStyle('poster with large text').sizeMult, 1.4);
  assertEquals(deriveStyle('poster with tiny text').sizeMult, 0.7);
  assertEquals(deriveStyle('poster, font size 200').sizePt, 120);
});

Deno.test('style: align/valign/uppercase/border with false-positive guards', () => {
  assertEquals(deriveAlign('poster, left aligned text'), 'left');
  assertEquals(deriveAlign('poster with centered text'), undefined);
  assertEquals(deriveVAlign('poster with text at the bottom'), 'bottom');
  assertEquals(deriveVAlign('poster for the event at the bottom of the hill'), undefined);
  assertEquals(deriveStyle('poster in all caps').uppercase, true);
  assertEquals(deriveStyle('poster with a border').border?.thick, false);
  assertEquals(deriveStyle('poster with a thick border').border?.thick, true);
  assertEquals(deriveStyle('carry your cross daily poster').border, undefined);
});

Deno.test('shape detection with false-positive guards', () => {
  assertEquals(deriveShape('add a star element to the poster'), 'star5');
  assertEquals(deriveShape('carry your cross daily'), undefined);
  assertEquals(deriveShape('rising star in the community'), undefined);
  assertEquals(deriveShape('add a rounded rectangle accent'), 'roundRect');
});

Deno.test('slide splitting and headline extraction', () => {
  assertEquals(splitIntoSlides('Hello\nWorld').length, 1);
  assertEquals(splitIntoSlides('Slide One\nbody\n\nSlide Two\nbody').length, 2);
  assertEquals(splitIntoSlides('A\n---\nB').length, 2);
  assertEquals(splitIntoSlides('A\n***\nB').length, 2);
  assertEquals(splitIntoSlides(Array.from({ length: 40 }, (_, i) => `Slide ${i}`).join('\n\n')).length, 30);
  assertEquals(extractHeadlineBody('Title\nLine1\nLine2'), { heading: 'Title', body: 'Line1\nLine2' });
  assertEquals(extractHeadlineBody('\n\nTitle only'), { heading: 'Title only', body: '' });
});

Deno.test('bullet-list detection', () => {
  assert(isBulletList(['- one', '- two', '- three']));
  assert(isBulletList(['1. one', '2. two']));
  assert(!isBulletList(['just a sentence.', 'another sentence.']));
  assert(!isBulletList(['- one item only']));
});

Deno.test('table detection with false-positive guard', () => {
  assert(parseTableRows(['9:00 AM | Sunday School', '10:00 AM | Worship Service', '11:30 AM | Fellowship']) !== null);
  assertEquals(parseTableRows(['9:00 AM | Sunday School', '10:00 AM | Worship Service'])?.length, 2);
  assert(parseTableRows(['just one line of text']) === null);
  assert(parseTableRows(['normal sentence with a | somewhere', 'another normal sentence, no pipe here']) === null);
  assert(parseTableRows(['Name | Role | Team', '---|---|---', 'John | Usher | A', 'Mary | Greeter | B']) !== null);
});

Deno.test('font-fit sizing sanity', () => {
  assert(estimateLines('short', 20, 5) >= 1);
  assert(fitFontSize(['a very long paragraph '.repeat(30)], 3, 1, 44, 10) < 44);
  assertEquals(fitFontSize(['hi'], 5, 5, 44, 10), 44);
});

// ---- Runtime smoke test: actually invoke pptxgenjs, not just types ----
Deno.test('buildPptx generates valid pptx bytes across style combinations', async () => {
  const cases: Array<[string, () => Promise<Uint8Array>]> = [
    ['basic single slide', () => buildPptx(1080, 1080, [{ heading: 'Hello', body: 'World' }])],
    ['multi-slide', () => buildPptx(1920, 1080, [
      { heading: 'Slide 1', body: 'Body 1' },
      { heading: 'Slide 2', body: 'Body 2' },
    ])],
    ['bullets', () => buildPptx(1080, 1080, [{ heading: 'List', body: '- one\n- two\n- three' }])],
    ['table', () => buildPptx(1200, 630, [{ heading: 'Schedule', body: '9AM | Service\n10AM | Fellowship' }])],
    ['full style: bg/text/font/border/shape/uppercase', () => buildPptx(1080, 1920, [{ heading: 'Join Us', body: 'Sunday 10AM' }], {
      bg: '000000', text: '00F7FF', font: 'Fredoka', sizePt: 44, uppercase: true,
      border: { color: 'FA00FF', thick: true }, shape: 'star5', accent: '00FF49', align: 'center', vAlign: 'middle',
    })],
    ['tiny custom size', () => buildPptx(500, 500, [{ heading: 'Logo', body: '' }])],
    ['empty content', () => buildPptx(1080, 1080, [{ heading: '', body: '' }])],
    ['long content auto-shrink', () => buildPptx(1080, 1080, [{ heading: 'A Very Long Heading That Should Shrink To Fit The Box Properly', body: 'A very long body paragraph. '.repeat(20) }])],
  ];
  for (const [label, fn] of cases) {
    const bytes = await fn();
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK" zip magic
    assert(bytes.length > 1000 && isZip, `${label}: expected a valid-looking non-trivial pptx, got ${bytes.length} bytes, isZip=${isZip}`);
  }
});
