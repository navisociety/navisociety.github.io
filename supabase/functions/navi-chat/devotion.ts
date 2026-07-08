// supabase/functions/navi-chat/devotion.ts
//
// NAVI v22 — Devotional Engine.
//
// Two faith modes built on the full KJV in navi_bible_verses:
//
//   • "verse of the day" — a deterministic 31-verse rotation keyed to the date
//     in South Africa time, so the whole day gets the same verse and tomorrow
//     brings a new one. Delivered with a short reflection.
//
//   • "devotional about hope" — a structured mini-devotional: scripture found
//     by topic search, a reflection that points the topic back at the reader,
//     and a one-line prayer close.
//
// Delivered verbatim (never tone-reshaped), exactly like Bible verses.

import {
  parseBibleReference, fetchBibleVerses, searchBibleVerses,
  type BibleVerse,
} from './bible.ts';
import { todayInTZ } from './skills.ts';

const NAVI_TZ = 'Africa/Johannesburg';

// ── Verse of the day ──────────────────────────────────────────────────────────

// One month of anchors — reference plus the angle the reflection takes.
export const VOTD_ROTATION: Array<{ ref: string; angle: string }> = [
  { ref: 'John 3:16',            angle: 'You are loved first — everything else flows from that.' },
  { ref: 'Psalm 23:1',           angle: 'Provision starts with whose you are, not what you have.' },
  { ref: 'Philippians 4:13',     angle: 'Strength for today is already supplied.' },
  { ref: 'Jeremiah 29:11',       angle: 'Your future has an author, and His plans lean toward hope.' },
  { ref: 'Proverbs 3:5',         angle: 'Trust is a direction, not a feeling — lean His way today.' },
  { ref: 'Isaiah 40:31',         angle: 'Waiting on God is not wasted time; it is where strength is exchanged.' },
  { ref: 'Romans 8:28',          angle: 'Nothing in your day is outside the "all things" He works with.' },
  { ref: 'Joshua 1:9',           angle: 'Courage is a command with a promise attached: He goes with you.' },
  { ref: 'Psalm 46:1',           angle: 'Help that is "very present" is closer than the trouble is.' },
  { ref: 'Matthew 6:33',         angle: 'Order today around the Kingdom and watch the rest line up.' },
  { ref: 'Philippians 4:6',      angle: 'Trade every anxious thought for a prayed one.' },
  { ref: 'Psalm 118:24',         angle: 'This exact day was made on purpose — walk into it glad.' },
  { ref: 'Isaiah 41:10',         angle: 'Fear loses its grip when you remember who is holding you.' },
  { ref: 'Proverbs 18:10',       angle: 'His name is not advice — it is a tower you can run into.' },
  { ref: 'Romans 12:2',          angle: 'Transformation starts in the mind you feed.' },
  { ref: 'Psalm 121:1',          angle: 'Lift your eyes higher than the hills in front of you.' },
  { ref: 'Matthew 11:28',        angle: 'Rest is not earned at the end — it is received at the start.' },
  { ref: 'Galatians 6:9',        angle: 'The harvest clock is running even when nothing looks different.' },
  { ref: 'Psalm 37:4',           angle: 'Delight comes first; the desires follow.' },
  { ref: 'John 14:27',           angle: 'His peace is left with you like an inheritance — claim it.' },
  { ref: 'Proverbs 16:3',        angle: 'Commit the work and the thoughts settle.' },
  { ref: 'Hebrews 11:1',         angle: 'Faith gives today substance that circumstances cannot.' },
  { ref: 'Psalm 34:8',           angle: 'Goodness is meant to be tasted, not just discussed.' },
  { ref: 'Isaiah 26:3',          angle: 'Perfect peace has an address: a mind stayed on Him.' },
  { ref: 'Romans 15:13',         angle: 'Hope is not a mood — it is a filling.' },
  { ref: 'Psalm 27:1',           angle: 'Light and salvation in the same person — fear has no seat left.' },
  { ref: 'Matthew 5:16',         angle: 'Your light is for shining, not storing.' },
  { ref: 'James 1:5',            angle: 'Wisdom is one honest ask away.' },
  { ref: 'Psalm 139:14',         angle: 'You were made on purpose, with skill — carry yourself like it.' },
  { ref: '2 Timothy 1:7',        angle: 'Fear is not from home. Power, love, and a sound mind are.' },
  { ref: 'Lamentations 3:22',    angle: 'Fresh mercy arrived with this morning — spend it.' },
];

const VOTD_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:what(?:'s| is) the |give me (?:the |a )?|read me (?:the |a )?)?(?:(?:bible )?(?:verse|scripture|word) (?:of|for) (?:the|to)?\s*day|daily (?:bible )?(?:verse|scripture|word))[?!.]*$/i;

/** Which rotation slot a given date lands on (whole day, SA time). */
export function votdIndex(today = todayInTZ(NAVI_TZ)): number {
  const dayOfYear = Math.floor(
    (Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(today.y, 0, 1)) / 86400000,
  );
  return dayOfYear % VOTD_ROTATION.length;
}

export function isVotdAsk(message: string): boolean {
  return VOTD_RX.test(message.trim());
}

export function formatVotd(verse: BibleVerse, angle: string): string {
  return `Your verse for today:\n\n${verse.book} ${verse.chapter}:${verse.verse} (KJV) — "${verse.text}"\n\n${angle}`;
}

// ── Topical devotional ────────────────────────────────────────────────────────

const DEVO_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?(?:write|give|make|share)?\s*(?:me\s+|us\s+)?(?:a\s+|today'?s\s+)?(?:short\s+|quick\s+)?devotionals?(?:\s+(?:about|on|for)\s+(.+))?[?!.]*$/i;

/** The devotional topic ('' for a general one), or null when not a devotional ask. */
export function devotionTopic(message: string): string | null {
  const m = message.trim().replace(/[?!.]+\s*$/, '').match(DEVO_RX);
  if (!m) return null;
  const topic = (m[1] ?? '').replace(/\s+/g, ' ').trim();
  if (topic.split(/\s+/).length > 5) return null;
  return topic;
}

export function formatDevotional(topic: string, verses: BibleVerse[]): string {
  if (!verses.length) return '';
  const shown = verses.slice(0, 2);
  const scripture = shown
    .map(v => `${v.book} ${v.chapter}:${v.verse} (KJV) — "${v.text}"`)
    .join('\n\n');
  const subject = topic || 'today';
  const reflection = topic
    ? `Sit with that for a moment. The Word doesn't treat ${topic} as a small thing — it meets it head-on. The question it puts to you is simple: will you act on what it says about ${topic} today, in one concrete way?`
    : `Sit with that for a moment. Let it set the tone before the day sets it for you — one verse taken seriously outweighs a hundred skimmed.`;
  return `A devotional for ${subject}.\n\n${scripture}\n\n${reflection}\n\nPray this: Lord, write this word on my heart and let me walk it out today. Amen.`;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Devotional pipeline: verse of the day or a topical devotional. Returns ''
 * when the message is neither, or when scripture couldn't be fetched.
 */
export async function tryDevotion(message: string): Promise<string> {
  if (isVotdAsk(message)) {
    const slot = VOTD_ROTATION[votdIndex()];
    const ref = parseBibleReference(slot.ref);
    if (!ref) return '';
    const verses = await fetchBibleVerses(ref);
    if (!verses.length) return '';
    return formatVotd(verses[0], slot.angle);
  }

  const topic = devotionTopic(message);
  if (topic !== null) {
    const verses = topic
      ? await searchBibleVerses(topic, 2)
      : await (async () => {
          const slot = VOTD_ROTATION[votdIndex()];
          const ref = parseBibleReference(slot.ref);
          return ref ? await fetchBibleVerses(ref) : [];
        })();
    return formatDevotional(topic, verses);
  }

  return '';
}
