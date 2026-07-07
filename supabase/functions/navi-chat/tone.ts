// supabase/functions/navi-chat/tone.ts
//
// NAVI v20 — Adaptive Tone & Register Engine.
//
// Every reply used to be delivered at the same length and temperature no matter
// who was on the other end. This layer reads the USER — their emotional energy
// and how they type — and modulates NAVI's delivery to match:
//
//   • distress signals  → a brief grounding acknowledgment is placed in front
//                          so a factual/neutral reply still lands humanely.
//   • high energy / hype → NAVI mirrors it back instead of answering flat.
//   • terse quick-chat   → a long essay is compressed to its essential core, so
//                          someone firing one-liners isn't buried in text.
//
// It is a pure post-processor over an already-generated reply. It NEVER touches
// crisis / sensitive replies (opts.sensitive) — those are delivered exactly as
// written — and it never fabricates content, only reshapes tone and length.

type Msg = { role: 'user' | 'assistant'; content: string };

export interface ToneOpts {
  /** The reply came from a crisis / high-priority sensitive node — do not modulate. */
  sensitive: boolean;
  /** The reply is one of NAVI's generic "I don't know" fallbacks. */
  isFallback: boolean;
}

const DISTRESS = /\b(sad|hurt|alone|lonely|lost|empty|broken|hopeless|worthless|exhausted|burnt? ?out|overwhelmed|anxious|depressed|scared|afraid|crying|can'?t cope|falling apart|give up|giving up|numb)\b/i;

const HYPE_WORDS = /\b(let'?s go+|lfg|less?go+|hell yeah|hell yes|yes+|yasss+|fire|amazing|incredible|insane|legendary|unreal|so hyped|pumped|let'?s get it|w+)\b/i;

const SOFTENERS = ['I hear you. ', "I'm with you on this. ", 'That\'s a lot to hold. '];
const HYPE_OPENERS = ["Let's go — ", 'Yes — ', 'Love that energy. ', "Right there with you — "];

/** Does this reply already open with warmth/empathy? Avoid stacking softeners. */
function alreadyGentle(response: string): boolean {
  return /^(i hear|i'm here|i'm with|that matters|that's a lot|i feel|i get|hey,|i know that)/i.test(
    response.trim(),
  );
}

/** Does this reply already open with energy? Avoid stacking hype openers. */
function alreadyHyped(response: string): boolean {
  return /^(let's go|yes|yeah|love|amazing|hell|absolutely|exactly|right there)/i.test(
    response.trim(),
  );
}

/**
 * Is the user in quick, terse, one-liner mode? Looks at the current message and
 * the recent few user turns so a single short word inside a long conversation
 * doesn't misfire — it's the sustained rhythm that signals "keep it short".
 */
export function userIsTerse(message: string, history: Msg[]): boolean {
  const cur = message.trim();
  const words = cur ? cur.split(/\s+/).length : 0;
  if (cur.length > 24 || words > 5) return false;
  if (cur.endsWith('?')) return false; // a short question still wants a real answer
  const recent = history.filter(m => m.role === 'user').slice(-3).map(m => m.content.trim());
  const sample = [...recent, cur];
  const avg = sample.reduce((s, m) => s + m.length, 0) / sample.length;
  return avg <= 42;
}

const HYPE_EXCLAIM = /!{2,}/;
const HYPE_EMOJI = /🔥|💯|🚀|⚡|🙌|💪/;

function userIsHyped(message: string): boolean {
  if (HYPE_EXCLAIM.test(message) || HYPE_EMOJI.test(message)) return true;
  if (HYPE_WORDS.test(message)) return true;
  const letters = message.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 6) {
    const caps = letters.replace(/[^A-Z]/g, '').length / letters.length;
    if (caps > 0.7) return true; // SHOUTING
  }
  return false;
}

/** Keep the first 1–2 sentences (up to ~limit chars), always on a clean end. */
function compress(response: string, limit = 240): string {
  if (response.length <= limit) return response;
  const sentences = response.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!sentences || sentences.length <= 1) {
    const cut = response.slice(0, limit);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return end > 60 ? cut.slice(0, end + 1) : cut.trimEnd() + '…';
  }
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > limit) break;
    out += s;
  }
  return out.trim() || sentences[0].trim();
}

/**
 * Reshape delivery to match the user. Returns the response unchanged whenever
 * modulation doesn't apply (or must not — sensitive replies).
 */
export function adaptTone(
  response: string,
  message: string,
  history: Msg[],
  opts: ToneOpts,
): string {
  if (!response || opts.sensitive) return response;

  let out = response;

  // 1) Emotional mirroring — at most one prefix, distress takes priority.
  if (!opts.isFallback) {
    if (DISTRESS.test(message) && !alreadyGentle(out)) {
      out = SOFTENERS[message.length % SOFTENERS.length] + out;
    } else if (userIsHyped(message) && !alreadyHyped(out)) {
      out = HYPE_OPENERS[message.length % HYPE_OPENERS.length] + out;
    }
  }

  // 2) Register / length — compress long answers for terse quick-chat users.
  if (userIsTerse(message, history)) {
    out = compress(out);
  }

  return out;
}
