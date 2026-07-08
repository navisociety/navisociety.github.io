// supabase/functions/navi-chat/memorize.ts
//
// NAVI v22 — Scripture Memory Coach.
//
// "Help me memorize John 3:16" turns NAVI into a memory trainer: it shows the
// verse, then coaches — the user recites from memory and NAVI grades the
// attempt word-by-word (fuzzy, so typos still count), names exactly which
// words were missed, and celebrates a word-perfect recital. "Practice" serves
// a fill-in-the-blanks version; "test me" gives just the reference. Stateless
// like quiz mode: the active verse is recovered from the conversation history
// (a "Memory verse — Ref (KJV)" marker), so no server-side session is needed.

import { parseBibleReference, fetchBibleVerses, type BibleVerse } from './bible.ts';
import { wordsMatch } from './match.ts';

type Msg = { role: 'user' | 'assistant'; content: string };

const MARKER = 'Memory verse — ';

const START_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?(?:help me\s+|let'?s\s+|i want to\s+|i'?d like to\s+)?(?:memori[sz]e|learn by heart)\s+(.+)$/i;

/** The reference the user wants to memorize, or null when this isn't that ask. */
export function memorizeRef(message: string) {
  const m = message.trim().replace(/[?!.]+\s*$/, '').match(START_RX);
  if (!m) return null;
  const ref = parseBibleReference(m[1]);
  if (!ref || !ref.verseStart) return null;
  // Coach one verse at a time — a range collapses to its first verse.
  return { ...ref, verseEnd: ref.verseStart };
}

/** The active memory verse reference from history, or null. */
export function activeMemoryRef(history: Msg[]) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'assistant') continue;
    const at = history[i].content.indexOf(MARKER);
    if (at === -1) return null; // last assistant turn wasn't coaching — mode over
    const line = history[i].content.slice(at + MARKER.length);
    const refText = line.split(' (KJV)')[0];
    return parseBibleReference(refText);
  }
  return null;
}

function refLabel(v: BibleVerse): string {
  return `${v.book} ${v.chapter}:${v.verse}`;
}

export function startCoaching(verse: BibleVerse): string {
  return `Let's hide this one in your heart.\n\n${MARKER}${refLabel(verse)} (KJV):\n"${verse.text}"\n\nRead it a few times, then type it from memory and I'll check you. Say "practice" for a fill-in-the-blanks round, or "stop" when you're done.`;
}

// ── Grading ───────────────────────────────────────────────────────────────────

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export interface Grade { score: number; missed: string[] }

/** Word-by-word recall score: how many verse words the attempt contains (fuzzy). */
export function gradeAttempt(verseText: string, attempt: string): Grade {
  const target = tokens(verseText);
  const said = tokens(attempt);
  const missed: string[] = [];
  let hit = 0;
  const used = new Array(said.length).fill(false);
  for (const w of target) {
    const at = said.findIndex((s, i) => !used[i] && (s === w || wordsMatch(s, w, true)));
    if (at >= 0) { used[at] = true; hit++; }
    else if (!missed.includes(w)) missed.push(w);
  }
  return { score: target.length ? hit / target.length : 0, missed };
}

/** Every 3rd word blanked, first and last words always kept as anchors. */
export function blankOut(text: string): string {
  const words = text.split(/\s+/);
  return words
    .map((w, i) => {
      if (i === 0 || i === words.length - 1) return w;
      if ((i + 1) % 3 !== 0) return w;
      const core = w.replace(/[^A-Za-z]/g, '');
      if (core.length < 3) return w;
      return w.replace(/[A-Za-z]+/, '_'.repeat(core.length));
    })
    .join(' ');
}

const STOP_RX = /^(?:stop|done|i'?m done|enough|end|quit|exit|that'?s enough)[.!?]*$/i;
const PRACTICE_RX = /^(?:practice|practise|blanks?|fill in the blanks?)[.!?]*$/i;
const TEST_RX = /^(?:test me|check me|quiz me on it|from memory|ready)[.!?]*$/i;
const SHOW_RX = /^(?:show (?:me (?:the verse|it)|it|the verse)( again)?|again|repeat it)[.!?]*$/i;

function coachTail(verse: BibleVerse): string {
  return `\n\n${MARKER}${refLabel(verse)} (KJV) — say "practice", "test me", or type it from memory.`;
}

/**
 * Drive memory-coach mode. Starts on "memorize <ref>"; on later turns the
 * active verse comes from history and this message is treated as a command or
 * a recital. Returns '' when coach mode doesn't apply (including a clear
 * subject change mid-session).
 */
export async function tryMemorize(message: string, history: Msg[]): Promise<string> {
  const m = message.trim();

  const startRef = memorizeRef(m);
  if (startRef) {
    const verses = await fetchBibleVerses(startRef);
    if (!verses.length) return '';
    return startCoaching(verses[0]);
  }

  const active = activeMemoryRef(history);
  if (!active) return '';

  if (STOP_RX.test(m)) {
    return `Good work — that verse is deeper in you than it was ten minutes ago. Come back to it tomorrow; repetition is how it sticks.`;
  }

  // A clear subject change (their own question, or a long unrelated message)
  // hands the turn back to the normal pipeline.
  if (/^(who|what|when|where|why|how|which|tell me|explain|define)\b/i.test(m) && !TEST_RX.test(m)) return '';

  const verses = await fetchBibleVerses(active);
  if (!verses.length) return '';
  const verse = verses[0];

  if (PRACTICE_RX.test(m)) {
    return `Fill the gaps:\n\n"${blankOut(verse.text)}"${coachTail(verse)}`;
  }
  if (TEST_RX.test(m)) {
    return `From memory — ${refLabel(verse)}. Type it out.${coachTail(verse)}`;
  }
  if (SHOW_RX.test(m)) {
    return `Here it is again:\n\n"${verse.text}"${coachTail(verse)}`;
  }

  // Treat the message as a recital only when it plausibly is one.
  const { score, missed } = gradeAttempt(verse.text, m);
  if (m.split(/\s+/).length < 3 || score < 0.3) return '';

  const pct = Math.round(score * 100);
  if (score >= 0.95) {
    return `Word-perfect — ${pct}%. ${refLabel(verse)} is yours now. Recite it once more tonight and it'll hold.`;
  }
  if (score >= 0.75) {
    const gaps = missed.slice(0, 5).join(', ');
    return `Strong — ${pct}%. You slipped on: ${gaps}. One more run:\n\n"${verse.text}"${coachTail(verse)}`;
  }
  return `Good start — ${pct}%. Read it once more, slowly:\n\n"${verse.text}"\n\nThen try again from memory.${coachTail(verse)}`;
}
