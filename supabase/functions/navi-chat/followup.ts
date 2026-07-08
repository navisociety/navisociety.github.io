// supabase/functions/navi-chat/followup.ts
//
// NAVI v24 — Elliptical follow-up execution.
//
// Humans chain work: "what's 17% of 240?" … "and of 500?" — the second message
// isn't a question at all, it's a SLOT for the previous question's frame. NAVI
// answered the first perfectly (deterministic math skill) and fumbled the
// second into a fallback, because no engine ever saw a complete question.
//
// This module rebuilds the full question from the previous user turn:
//   "what is 17% of 240"  + "and of 500?"        → "what is 17% of 500?"
//   "capital of france"   + "what about germany?" → "capital of germany?"
//   "what time is it?"    + "and in london?"      → "what time is it in london?"
//   "who is nelson mandela" + "and desmond tutu?" → "who is desmond tutu?"
//
// Deliberately conservative: it only fires on short messages that OPEN with a
// follow-up lead ("and", "what about", "how about", "also", "now"), only uses
// the immediately-previous user message, and only when that message was
// question-shaped. Emotional and first-person-feeling messages are never
// rewritten — those are NAVI's own lane. Returns null when nothing applies,
// so the normal pipeline runs untouched.

type Msg = { role: 'user' | 'assistant'; content: string };

const LEAD_RX = /^(?:and|also|what about|how about|now)\b[,\s]*/i;

// A previous turn counts as a reusable frame only when it clearly asked for
// something: a question mark, a wh-/aux- opening, or a request verb.
const ASKED_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+)?(?:what|who|when|where|why|how|which|is|are|was|were|do|does|did|can|solve|convert|calculate|define|give me|tell me|show me)\b/i;

// A remainder that is itself a complete ask needs no frame — just strip the lead.
const STANDALONE_RX =
  /^(?:what|who|when|where|why|how|which|is|are|do|does|did|can|solve|convert|calculate|define|give me|tell me|show me)\b/i;

// Never rewrite feelings — "and me?", "and my life?" stay whole for the
// emotional / crisis layers.
const EMOTIONAL_RX =
  /\b(feel|feeling|felt|sad|happy|scared|hurt|alone|lonely|angry|stressed|overwhelmed|anxious|depressed|die|dying|suicide|myself|cope|heal|life)\b/i;

// A remainder that is just a pronoun ("and me?", "and them?") is small talk,
// not a slot to substitute.
const PRONOUN_ONLY_RX = /^(?:me|you|us|him|her|them|it|this|that|everyone|everybody)$/i;

const PREPS = ['about', 'of', 'in', 'for', 'from', 'to', 'at', 'by', 'on'];
const PREP_RX = new RegExp(`^(${PREPS.join('|')})\\s+(.+)$`, 'i');

function cleanQuestion(s: string): string {
  return s.trim().replace(/[?!.]+\s*$/, '').replace(/\s+/g, ' ');
}

/** The previous user message, when it was a short, question-shaped ask. */
function previousFrame(history: Msg[], current: string): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const prev = history[i].content.trim();
    if (prev === current.trim()) continue; // history may include the current turn
    if (prev.length > 120) return null;
    if (!/\?\s*$/.test(prev) && !ASKED_RX.test(prev)) return null;
    return cleanQuestion(prev);
  }
  return null;
}

/**
 * Expand an elliptical follow-up into a complete question using the previous
 * user turn's frame. Returns the rebuilt question (ending in "?"), or null
 * when the message isn't an elliptical follow-up.
 */
export function expandFollowUp(message: string, history: Msg[]): string | null {
  const t = message.trim();
  if (!t || t.split(/\s+/).length > 8) return null;
  const lead = t.match(LEAD_RX);
  if (!lead || lead[0].trim().length === 0) return null;

  const remainder = cleanQuestion(t.slice(lead[0].length));
  if (!remainder || remainder.split(/\s+/).length > 5) return null;
  if (EMOTIONAL_RX.test(remainder) || PRONOUN_ONLY_RX.test(remainder)) return null;

  // "and what is gravity?" — the remainder already stands alone.
  if (STANDALONE_RX.test(remainder)) {
    return remainder.split(/\s+/).length >= 3 ? `${remainder}?` : null;
  }

  const frame = previousFrame(history, t);
  if (!frame) return null;

  // ── Number swap ─────────────────────────────────────────────────────────
  // "and of 500?" swaps the number behind the same preposition; a bare
  // "and 500?" swaps the frame's last number.
  const remNum = remainder.match(/^(?:(\w+)\s+)?(\d[\d.,]*%?)$/);
  if (remNum && /\d/.test(frame)) {
    const [, prep, num] = remNum;
    if (prep && PREPS.includes(prep.toLowerCase())) {
      const prepNumRx = new RegExp(`\\b${prep}\\s+\\d[\\d.,]*%?`, 'i');
      if (prepNumRx.test(frame)) return `${frame.replace(prepNumRx, `${prep} ${num}`)}?`;
      return null;
    }
    if (prep) return null; // "and weighs 500?" — not a clean slot
    const nums = frame.match(/\d[\d.,]*%?/g)!;
    const last = nums[nums.length - 1];
    const at = frame.lastIndexOf(last);
    return `${frame.slice(0, at)}${num}${frame.slice(at + last.length)}?`;
  }
  if (remNum) return null; // number follow-up but no number in the frame

  // ── Entity swap ─────────────────────────────────────────────────────────
  const prepM = remainder.match(PREP_RX);
  if (prepM) {
    // "and in cape town?" — replace the frame's own "<prep> …" tail, or append
    // the phrase when the frame never had one ("what time is it?" → "… in london?").
    const prep = prepM[1].toLowerCase();
    const tailRx = new RegExp(`\\b${prep}\\s+[a-z0-9][a-z0-9\\s'-]*$`, 'i');
    if (tailRx.test(frame)) return `${frame.replace(tailRx, `${prep} ${prepM[2]}`)}?`;
    return `${frame} ${prep} ${prepM[2]}?`;
  }

  // Bare entity: "and germany?" — replace the frame's trailing prepositional
  // object ("capital OF FRANCE"), else the copula object ("who is X").
  const tailPrep = frame.match(new RegExp(`\\b(${PREPS.join('|')})\\s+([a-z0-9][a-z0-9\\s'-]*)$`, 'i'));
  if (tailPrep) {
    const at = frame.lastIndexOf(tailPrep[0]);
    return `${frame.slice(0, at)}${tailPrep[1]} ${remainder}?`;
  }
  const copula = frame.match(/^((?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:what|who|where|when|which)(?:'s| is| was| are| were)\s+)(.+)$/i);
  if (copula) return `${copula[1]}${remainder}?`;

  return null;
}
