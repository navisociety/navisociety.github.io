// supabase/functions/navi-chat/reason.ts
//
// NAVI v20 — Reasoning Engine.
//
// The single biggest leap in how NAVI answers: instead of matching ONE node and
// returning one line, this module recognises questions that actually contain
// more than one thing to answer — comparisons and compound (multi-part)
// questions — decomposes them into sub-questions, answers each one through
// NAVI's own brain (falling back to learned knowledge / the silent web layer
// when a sub-part is weak), and SYNTHESISES the parts into one coherent,
// structured reply.
//
//   "what's the difference between a virus and a bacteria"
//        → answers each, then a synthesised contrast line
//   "who is Nikola Tesla and what did he invent"
//        → answers both halves as one reply
//
// It is intentionally conservative: it only fires on clearly multi-part or
// comparative questions, and returns '' otherwise so the normal single-answer
// pipeline runs. First-person / emotional questions are never decomposed —
// those are NAVI's own lane, not an encyclopedia lookup.

type Msg = { role: 'user' | 'assistant'; content: string };

export interface ReasonDeps {
  /** NAVI's node-brain answer for a single question (sync, deterministic). */
  answer: (q: string) => string;
  /** Silent web/knowledge lookup for a single question (async). */
  lookup: (q: string) => Promise<string>;
  /** True when a reply is one of NAVI's generic "I don't know" fallbacks. */
  isFallback: (r: string) => boolean;
}

const FIRST_PERSON = /\b(i|i'm|im|me|my|mine|myself|we|us|our|ours)\b/i;
const EMOTIONAL = /\b(feel|feeling|felt|sad|happy|scared|hurt|alone|lonely|angry|stressed|overwhelmed|anxious|depressed|cope|heal|grief|lost|empty|tired)\b/i;

// Brand / scripture stays on its own curated path — never decomposed.
const RESERVED = /\b(navi|navisociety|prophet|dian|bible|scripture|verse)\b/i;

function cap(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[?.!,;:\s]+$/, '').trim();
}

/** Detect a two-sided comparison and return [left, right] entities, or null. */
export function detectComparison(message: string): [string, string] | null {
  const m = message.trim();
  const lower = m.toLowerCase();

  // "(what's the) difference between A and B", "compare A and/to B",
  // "A vs B", "A versus B", "A compared to B".
  const patterns: RegExp[] = [
    /\bdifference between\s+(.+?)\s+and\s+(.+)$/i,
    /\bcompare\s+(.+?)\s+(?:and|to|with|vs\.?|versus)\s+(.+)$/i,
    /\b(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i,
    /\b(.+?)\s+compared to\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const hit = lower.match(re);
    if (hit) {
      const a = clean(hit[1]).replace(/^(a|an|the)\s+/, '');
      const b = clean(hit[2]).replace(/^(a|an|the)\s+/, '');
      // Reject noise: each side must be a short, real noun phrase.
      if (a && b && a.split(/\s+/).length <= 5 && b.split(/\s+/).length <= 5) {
        return [a, b];
      }
    }
  }
  return null;
}

/** Split a compound question into its parts, or [] if it isn't compound. */
export function splitCompound(message: string): string[] {
  const m = message.trim();

  // Two or more explicit questions: "who is X? what did they do?"
  const byQ = m.split('?').map(s => s.trim()).filter(Boolean);
  if (byQ.length >= 2 && /\b(who|what|when|where|why|how|which)\b/i.test(byQ[0])) {
    return byQ.slice(0, 3).map(s => s.replace(/[.!,;:\s]+$/, '') + '?');
  }

  // "<wh-clause> and <wh/aux-clause>": "who is Tesla and what did he invent".
  const m2 = m.match(
    /^(.*?\b(?:who|what|when|where|why|how|which)\b.*?)\s+and\s+((?:who|what|when|where|why|how|which|does|do|did|is|are|was|were|can)\b.*)$/i,
  );
  if (m2) {
    const a = clean(m2[1]);
    const b = clean(m2[2]);
    if (a && b) return [a + '?', b + '?'];
  }
  return [];
}

/** Best available answer to a single sub-question: brain first, web to fill gaps. */
async function resolve(q: string, deps: ReasonDeps): Promise<string> {
  const brain = deps.answer(q);
  if (brain && !deps.isFallback(brain)) return brain;
  const web = await deps.lookup(q);
  if (web) return web;
  return '';
}

// Rotating synthesis closers for comparisons — the "reasoning" that ties the
// two sides together instead of leaving them as two disconnected blobs.
const CONTRAST_CLOSERS = [
  'The real difference is what each one is for — pick the one that fits what you\'re actually trying to do.',
  'They overlap, but they\'re not interchangeable — the distinction matters once you know what you need.',
  'Same arena, different tools. Which one wins depends entirely on the situation you\'re in.',
];

/**
 * Reasoned answer for a compound or comparative question, or '' if the message
 * isn't one (or is a first-person/emotional/brand question NAVI should keep on
 * its own path).
 */
export async function tryReason(
  message: string,
  _history: Msg[],
  deps: ReasonDeps,
): Promise<string> {
  const m = message.trim();
  if (!m || m.length > 300) return '';
  if (RESERVED.test(m)) return '';
  if (FIRST_PERSON.test(m) || EMOTIONAL.test(m)) return '';

  // ── Comparison ────────────────────────────────────────────────────────────
  const cmp = detectComparison(m);
  if (cmp) {
    const [a, b] = cmp;
    const [ansA, ansB] = await Promise.all([
      resolve(`what is ${a}`, deps),
      resolve(`what is ${b}`, deps),
    ]);
    // Only worth it if we can actually speak to at least one side well; two
    // blanks means we know neither, so let the normal pipeline try.
    if (!ansA && !ansB) return '';
    const closer = CONTRAST_CLOSERS[m.length % CONTRAST_CLOSERS.length];
    const parts = [
      `${cap(a)} — ${ansA || 'I don\'t have a sharp read on that one yet.'}`,
      `${cap(b)} — ${ansB || 'I don\'t have a sharp read on that one yet.'}`,
    ];
    return `${parts.join('\n\n')}\n\n${closer}`;
  }

  // ── Compound / multi-part ─────────────────────────────────────────────────
  const parts = splitCompound(m);
  if (parts.length >= 2) {
    const answers = await Promise.all(parts.map(p => resolve(p, deps)));
    const good = answers.filter(Boolean);
    // Need at least two real answers to justify a synthesised multi-part reply.
    if (good.length >= 2) return good.join('\n\n');
  }

  return '';
}
