// supabase/functions/navi-chat/learn.ts
//
// NAVI's learning system (v19). This is what lets NAVI genuinely LEARN and keep
// what it learns — permanently, and shared across every user — with zero
// external model. Five abilities, all backed by navi_knowledge / navi_gaps:
//
//   1. Web-fact learning   — every good web answer NAVI produces is saved
//                            (learnKnowledge, source 'web') and served from the
//                            DB on future asks: instant and compounding.
//   2. Being taught        — a signed-in user can teach NAVI a fact directly
//                            (detectTeach / teachKnowledge, source 'taught',
//                            higher trust) and it answers that forever after.
//   3. Generalising         — learned answers are recalled even when re-phrased
//                            (recallKnowledge → fuzzy navi_knowledge_search).
//   4. Learning from
//      correction           — "that's wrong" / "that's right" adjusts an answer's
//                            confidence (detectFeedback / applyFeedback); an
//                            answer NAVI is repeatedly corrected on is retired.
//   5. Learning its gaps    — a question NAVI's own brain AND the web both miss
//                            is logged (logGap) so its most-asked blind spots
//                            become a self-improvement backlog.
//
// Server-side only, exactly like store.ts / bible.ts: uses the injected
// service-role key, browser never touches these tables (RLS on, no policies).
// Every call is best-effort — a DB hiccup must never take the chat down.

import { stem } from './match.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

type Msg = { role: 'user' | 'assistant'; content: string };

const TAUGHT_CONFIDENCE = 3.0; // taught facts outrank web-learned ones
const WEB_CONFIDENCE = 1.0;
const FEEDBACK_UP = 1.0;
const FEEDBACK_DOWN = -1.5; // ~2 corrections retires a web fact; ~3 a taught one

// Words that carry no meaning for matching a question to a learned answer.
const STOP = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'what', 'whats', 'who', 'whos',
  'how', 'why', 'does', 'did', 'can', 'you', 'your', 'that', 'this', 'with',
  'from', 'has', 'have', 'about', 'tell', 'give', 'say', 'know', 'there',
  'they', 'them', 'his', 'her', 'she', 'him', 'its', 'our', 'out',
]);

/** Normalise a question to its dedupe key — matches the SQL side's cleaning. */
export function normalizeKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/^\s*(?:hey\s+|yo\s+|hi\s+|hello\s+)?navi[,:\s]+/i, '')
    .replace(/^\s*(?:please|pls)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Significant, matchable tokens of a phrase (drops stopwords + tiny words). */
function sigTokens(s: string): string[] {
  return normalizeKey(s).split(' ').filter(w => w.length > 2 && !STOP.has(w));
}

function capitalizeFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const withCap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(withCap) ? withCap : withCap + '.';
}

async function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// ── 3. Recall — answer from what NAVI already learned ────────────────────────
export type Recall = { answer: string; source: string };

// Exact key first (instant), then fuzzy full-text search gated by real word
// overlap so an unrelated learned fact never hijacks a different question. The
// source comes back too: a 'taught' answer is user-authoritative and the caller
// lets it win even over a strong knowledge node; a 'web' answer only fills gaps.
export async function recallKnowledge(query: string): Promise<Recall | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const key = normalizeKey(query);
  if (!key) return null;

  // Exact prior question — return immediately.
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_knowledge` +
      `?query_key=eq.${encodeURIComponent(key)}&confidence=gt.0&select=answer,source&limit=1`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0]?.answer) {
        return { answer: String(rows[0].answer), source: String(rows[0].source ?? 'web') };
      }
    }
  } catch { /* fall through to fuzzy */ }

  // Fuzzy: re-phrasings of something NAVI already knows.
  const rows = await rpc('navi_knowledge_search', { q: query, max_results: 5 });
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const qTok = sigTokens(query);
  if (qTok.length === 0) return null;
  const need = Math.min(2, qTok.length); // 1-word asks need 1 hit; longer need 2+
  const qStems = qTok.map(stem);

  for (const row of rows) {
    const cand = row as { query_text?: string; answer?: string; source?: string };
    if (!cand.answer || !cand.query_text) continue;
    const cStems = new Set(sigTokens(cand.query_text).map(stem));
    const shared = qStems.filter(s => cStems.has(s)).length;
    if (shared >= need) return { answer: String(cand.answer), source: String(cand.source ?? 'web') };
  }
  return null;
}

// ── 1. Web-fact learning ─────────────────────────────────────────────────────
/** Remember an answer NAVI just produced. Fire-and-forget. */
export async function learnKnowledge(
  query: string,
  answer: string,
  source: 'web' | 'taught' = 'web',
  email?: string,
): Promise<void> {
  const key = normalizeKey(query);
  if (!key || !answer || answer.trim().length < 3) return;
  await rpc('navi_learn', {
    p_key: key,
    p_text: source === 'taught' ? query.trim() : normalizeKey(query),
    p_answer: answer.trim(),
    p_source: source,
    p_conf: source === 'taught' ? TAUGHT_CONFIDENCE : WEB_CONFIDENCE,
    p_email: email ?? null,
  });
}

// ── 2. Being taught ──────────────────────────────────────────────────────────
export type Teaching = { key: string; text: string; answer: string };

// Anchored, explicit triggers only — teaching writes to a shared knowledge base,
// so it must never fire on ordinary conversation. Deliberately keyed on "learn"
// (and colon-anchored "fact:"/"note:"), NOT "remember that…" — that belongs to
// personal memory (memory.ts) and must stay per-user. Captures from the ORIGINAL
// message to preserve proper-noun casing ("Prophet Dian", not "prophet dian").
const TEACH_RX =
  /^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:please\s+)?learn\s+(?:this|that)\b[:\s]+(.{4,300})$|^(?:learn|fact|note)[:]\s*(.{4,300})$/i;

// A taught fact can carry its own question via a separator: "X :: Y", "X => Y".
const QA_SPLIT = /\s*(?:::|=>|\s->\s|\s--\s)\s*/;

/** Detect an explicit teaching and split it into a recallable key/answer. */
export function detectTeach(message: string): Teaching | null {
  const m = message.trim().match(TEACH_RX);
  if (!m) return null;
  const payload = (m[1] ?? m[2] ?? '').trim();
  if (!payload || payload.split(/\s+/).length < 2) return null;

  const parts = payload.split(QA_SPLIT);
  if (parts.length === 2 && parts[0].trim().length >= 2 && parts[1].trim().length >= 2) {
    // Explicit question :: answer.
    const q = parts[0].trim();
    return { key: normalizeKey(q), text: q, answer: capitalizeFirst(parts[1]) };
  }
  // Plain declarative fact — the statement is both the lookup text and the answer.
  return { key: normalizeKey(payload), text: payload, answer: capitalizeFirst(payload) };
}

const TEACH_REPLIES = [
  "Got it — I've learned that, and I'll remember it from now on.",
  "Locked in. I've added that to what I know.",
  "Thanks for teaching me — that's saved. I'll carry it forward.",
];

/** Persist a teaching and return NAVI's confirmation. */
export async function teachKnowledge(t: Teaching, email: string, convTurn = 0): Promise<string> {
  if (!t.key) return TEACH_REPLIES[0];
  await rpc('navi_learn', {
    p_key: t.key,
    p_text: t.text,
    p_answer: t.answer,
    p_source: 'taught',
    p_conf: TAUGHT_CONFIDENCE,
    p_email: email || null,
  });
  return TEACH_REPLIES[convTurn % TEACH_REPLIES.length];
}

// ── 4. Learning from correction ──────────────────────────────────────────────
// Tight, short-message patterns so real content ("why is war wrong") is never
// read as feedback. Applies only to a learned answer that matches the prior
// question, so a stray "thanks" is harmless.
const FEEDBACK_DOWN_RX =
  /^(?:no[, ]+|nope[, ]+)?(?:that ?s|thats|it ?s|its) (?:wrong|incorrect|not right|not correct|false|not true|off|mistaken)\b|^(?:that ?s|thats) not (?:right|correct|true)\b|^(?:no[, ]+|nope[, ]+)?(?:wrong|incorrect|not right|not correct)( answer)?$|^you ?re wrong\b/i;
const FEEDBACK_UP_RX =
  /^(?:yes[, ]+)?(?:that ?s|thats|it ?s|its) (?:right|correct|perfect|exactly right|spot on|true|it)\b|^(?:perfect|exactly right|spot on|nailed it)\b|^that ?s? (?:helped|helps|helpful)\b|^(?:thanks|thank you|thx)[,! ]*(?:that (?:helped|was helpful|was right))?$|^good answer\b/i;

/** Classify a message as reinforcement about NAVI's last answer, or null. */
export function detectFeedback(message: string): 'up' | 'down' | null {
  const t = message
    .toLowerCase()
    .replace(/^\s*(?:hey\s+)?navi[,:\s]+/, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.split(' ').length > 8) return null;
  if (FEEDBACK_DOWN_RX.test(t)) return 'down';
  if (FEEDBACK_UP_RX.test(t)) return 'up';
  return null;
}

/** The user question that produced NAVI's most recent answer. */
export function previousUserQuestion(history: Msg[]): string {
  let ai = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') { ai = i; break; }
  }
  const upto = ai >= 0 ? ai : history.length;
  for (let i = upto - 1; i >= 0; i--) {
    if (history[i].role === 'user') return history[i].content;
  }
  return '';
}

/** Move a learned answer's confidence up or down based on user feedback. */
export async function applyFeedback(prevQuestion: string, verdict: 'up' | 'down'): Promise<void> {
  const key = normalizeKey(prevQuestion);
  if (!key) return;
  // Only touch an answer that's actually in the knowledge base.
  let realKey = '';
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_knowledge` +
      `?query_key=eq.${encodeURIComponent(key)}&select=query_key&limit=1`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0]?.query_key) realKey = String(rows[0].query_key);
    }
  } catch { /* ignore */ }
  if (!realKey) {
    // Maybe the prior answer came from a fuzzy match — find that row's key.
    const rows = await rpc('navi_knowledge_search', { q: prevQuestion, max_results: 1 });
    if (Array.isArray(rows) && rows[0]) {
      const r = rows[0] as { query_key?: string };
      if (r.query_key) realKey = r.query_key;
    }
  }
  if (!realKey) return;
  await rpc('navi_feedback', { p_key: realKey, p_delta: verdict === 'up' ? FEEDBACK_UP : FEEDBACK_DOWN });
}

// ── 5. Learning its gaps ─────────────────────────────────────────────────────
/** Record a question NAVI couldn't answer, so its blind spots surface. */
export async function logGap(query: string): Promise<void> {
  const key = normalizeKey(query);
  if (!key || key.split(' ').length < 2) return; // ignore trivial one-word noise
  await rpc('navi_gap', { p_key: key, p_text: query.trim().slice(0, 300) });
}
