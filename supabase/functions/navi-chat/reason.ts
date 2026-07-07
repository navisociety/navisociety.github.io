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

import { extractTopicEntity } from './context.ts';

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

// Node-brain replies that are wrong for a factual sub-question — greetings and
// the identity blurb. The brain hands these out for bare "what is X" asks about
// entities it has no node for, and they aren't in the generic-fallback list, so
// they must be rejected explicitly or they'd leak into a reasoned answer.
const NON_ANSWER = /^(hey\b|hi\b|hello\b|yo\b|i'm navi|navi here|navi online|greetings)/i;
function isNonAnswer(r: string, deps: ReasonDeps): boolean {
  return !r || deps.isFallback(r) || NON_ANSWER.test(r.trim()) || /what's on your mind/i.test(r);
}

/**
 * Best available answer to a single sub-question. The sub-questions inside a
 * comparison / compound ask are factual by construction, so the silent web
 * layer is consulted FIRST; the node-brain only fills in when the web has
 * nothing and the brain actually has something real to say (not a greeting).
 */
async function resolve(q: string, deps: ReasonDeps): Promise<string> {
  const web = await deps.lookup(q);
  if (web) return web;
  const brain = deps.answer(q);
  return isNonAnswer(brain, deps) ? '' : brain;
}

/** Trim to the first N sentences (≤ maxChars) for a clean side-by-side contrast. */
function firstSentences(text: string, n = 2, maxChars = 340): string {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!sentences) return text.length > maxChars ? text.slice(0, maxChars).trimEnd() + '…' : text;
  let out = '';
  for (const s of sentences.slice(0, n)) {
    if (out && (out + s).length > maxChars) break;
    out += s;
  }
  return out.trim() || sentences[0].trim();
}

/** Rewrite pronouns in a later compound part using the first part's entity. */
function carryEntity(part: string, entity: string | null): string {
  if (!entity) return part;
  return part
    .replace(/\b(his|her|its|their)\b/gi, `${entity}'s`)
    .replace(/\b(he|she|it|they|him|them)\b/gi, entity);
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
    // Need both sides answered to justify a synthesised contrast — one blank
    // side is a worse answer than the normal pipeline, so bail and let it run.
    if (!ansA || !ansB) return '';
    const closer = CONTRAST_CLOSERS[m.length % CONTRAST_CLOSERS.length];
    const parts = [
      `${cap(a)} — ${firstSentences(ansA)}`,
      `${cap(b)} — ${firstSentences(ansB)}`,
    ];
    return `${parts.join('\n\n')}\n\n${closer}`;
  }

  // ── Compound / multi-part ─────────────────────────────────────────────────
  const parts = splitCompound(m);
  if (parts.length >= 2) {
    // Later parts often lean on a pronoun ("...and what did HE invent") — carry
    // the first part's entity into them so each sub-question stands on its own.
    const entity = extractTopicEntity(parts[0]);
    const resolved = parts.map((p, i) => (i === 0 ? p : carryEntity(p, entity)));
    const answers = await Promise.all(resolved.map(p => resolve(p, deps)));
    const good = answers.filter(Boolean);
    // v21: even ONE solid sub-answer beats bailing — the whole compound
    // phrasing rarely survives the normal pipeline's lookups, so delivering
    // the answerable half is strictly better than a fallback.
    if (good.length >= 1) return good.join('\n\n');
  }

  return '';
}
