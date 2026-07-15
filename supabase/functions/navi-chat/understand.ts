// supabase/functions/navi-chat/understand.ts
//
// NAVI v21 — Text Understanding engine: summarize & rewrite.
// NAVI v43 — the reader round: shaped summaries + email-aware cleanup.
//
// Two abilities that make NAVI feel like it actually READS:
//
//   1. trySummarize — the user pastes a block of text ("summarize: <text>",
//      "tldr: <text>") and NAVI returns its essential core. Pure extractive
//      summarization: sentences are scored by how many of the text's own
//      high-frequency content words they carry, and the top few are returned
//      in their original order — so the summary is always the text's own
//      words, never fabricated.
//      v43: the ask can now NAME the shape it wants — "summarize in one
//      sentence: <text>" and "key points: <text>" (bullets) reuse the same
//      rewrite machinery, so a pasted text and NAVI's own last answer
//      condense exactly the same way.
//
//   2. tryRewrite — the user asks NAVI to reshape its LAST answer: "say that
//      simpler", "in one sentence", "make it shorter", "put that in bullet
//      points", "eli5". The transformation is applied to what NAVI just said,
//      so long answers become exactly as digestible as the user wants.
//
//   3. cleanEmailText (v43) — real email bodies carry furniture extraction
//      chokes on: quoted reply history ("> …", "On Tue, Sam wrote:"),
//      signature blocks ("-- "), device signatures, long URLs. This strips
//      the furniture and keeps the words a human actually wrote, so the
//      single-mail digest (mail.ts) summarizes the MESSAGE, not the thread's
//      echo.
//
// All deterministic, zero-I/O, and return '' whenever they don't cleanly
// apply so the normal pipeline runs.

type Msg = { role: 'user' | 'assistant'; content: string };

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'so', 'of', 'to', 'in', 'on', 'at',
  'for', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'it', 'its', 'this', 'that', 'these', 'those', 'they', 'them',
  'their', 'he', 'she', 'his', 'her', 'we', 'you', 'your', 'i', 'my', 'me',
  'not', 'no', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'than', 'then', 'there', 'here',
  'when', 'where', 'which', 'who', 'what', 'how', 'why', 'all', 'also',
  'into', 'over', 'about', 'more', 'most', 'some', 'such', 'only', 'other',
  'one', 'two', 'very', 'just', 'because', 'while', 'both', 'each', 'between',
]);

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Score each sentence by the frequency of its content words across the whole
 * text (normalised by sentence length so long sentences don't auto-win), and
 * return the indexes of the top `k`, in ORIGINAL order.
 */
function topSentenceIndexes(sents: string[], k: number): number[] {
  const freq = new Map<string, number>();
  for (const s of sents) {
    for (const w of contentWords(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const scored = sents.map((s, i) => {
    const words = contentWords(s);
    if (words.length === 0) return { i, score: 0 };
    const sum = words.reduce((acc, w) => acc + (freq.get(w) ?? 0), 0);
    return { i, score: sum / Math.sqrt(words.length) };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(x => x.i)
    .sort((a, b) => a - b);
}

/** The extractive core of a text: its most representative sentences, in order. */
export function summarize(text: string, maxSentences = 3, maxChars = 520): string {
  const sents = splitSentences(text.replace(/\s+/g, ' ').trim());
  if (sents.length === 0) return '';
  if (sents.length <= 2) return sents.join(' ');
  const k = Math.min(maxSentences, Math.max(1, Math.round(sents.length / 4)));
  const picked = topSentenceIndexes(sents, k).map(i => sents[i]);
  let out = '';
  for (const s of picked) {
    if (out && (out.length + 1 + s.length) > maxChars) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || picked[0].slice(0, maxChars);
}

const SUMMARIZE_CMD =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?(?:summari[sz]e|tl;?dr)(?:\s+this)?(?:\s+for me)?\s*[:\-–—,]?\s*/i;

// v43: shaped summary commands — the ask names the form it wants. These are
// checked BEFORE the plain command: "summarize in one sentence: …" must not
// be read as a plain summarize of a text that happens to open "in one
// sentence:". Same MIN_PASTED_CHARS floor, so topic asks stay on the
// knowledge/web path.
const ONE_SENTENCE_CMD =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?(?:summari[sz]e|sum up|boil down)(?:\s+this)?\s+(?:in|to|into) (?:one|a single) sentence\s*[:\-–—,]?\s*/i;
const KEY_POINTS_CMD =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?(?:(?:give me\s+|list\s+)?(?:the\s+)?key points(?:\s+(?:of|from|in))?(?:\s+this)?|bullet[\s-]?point(?:s)?(?:\s+(?:of|from|in))?(?:\s+this)?)\s*[:\-–—,]?\s*/i;

// The pasted text must actually be a text — not a topic name. Topic asks
// ("summarize the bible") stay on the knowledge/web path.
const MIN_PASTED_CHARS = 160;

/**
 * "summarize: <pasted text>" → the heart of that text. v43: "summarize in
 * one sentence: <text>" and "key points: <text>" name their shape and reuse
 * the rewrite machinery. Returns '' when the message isn't a summarize
 * command over real pasted text.
 */
export function trySummarize(message: string): string {
  const m = message.trim();
  if (ONE_SENTENCE_CMD.test(m)) {
    const text = m.replace(ONE_SENTENCE_CMD, '').trim();
    return text.length >= MIN_PASTED_CHARS ? applyRewrite(text, 'one-sentence') : '';
  }
  if (KEY_POINTS_CMD.test(m)) {
    const text = m.replace(KEY_POINTS_CMD, '').trim();
    if (text.length < MIN_PASTED_CHARS) return '';
    const bullets = applyRewrite(text, 'bullets');
    return bullets ? `The key points:\n${bullets}` : '';
  }
  if (!SUMMARIZE_CMD.test(m)) return '';
  const text = m.replace(SUMMARIZE_CMD, '').trim();
  if (text.length < MIN_PASTED_CHARS) return '';
  const core = summarize(text);
  return core ? `Here's the heart of it: ${core}` : '';
}

// ── v43: email-aware cleanup ────────────────────────────────────────────────

const SIG_DELIM_RX = /^--\s*$/; // the RFC-style signature cut — everything after is name/links
const QUOTE_LINE_RX = /^\s*>/; // quoted reply history
const WROTE_LINE_RX = /^on .{4,120} wrote:?\s*$/i; // the quote's introduction line
const SENT_FROM_RX = /^sent from my /i; // device signatures
const URL_RX = /https?:\/\/\S+/g;

/**
 * v43: strip the furniture off a raw email body — quoted history, signature
 * blocks, device signatures, raw URLs — and collapse it to one clean line of
 * prose. What survives is what the sender actually wrote, which is the only
 * part worth pressing through summarize(). Deterministic, zero-I/O.
 */
export function cleanEmailText(text: string): string {
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const bare = line.trim();
    if (SIG_DELIM_RX.test(bare)) break;
    if (QUOTE_LINE_RX.test(line)) continue;
    if (WROTE_LINE_RX.test(bare)) continue;
    if (SENT_FROM_RX.test(bare)) continue;
    kept.push(line);
  }
  return kept
    .join(' ')
    .replace(URL_RX, '(link)')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Rewrite-my-last-answer commands ──────────────────────────────────────────

type RewriteMode = 'one-sentence' | 'simpler' | 'shorter' | 'bullets';

const ONE_SENTENCE_RX =
  /^(?:(?:say|put|give me|sum)\s+(?:that|it|this)(?:\s+up)?\s+)?in one sentence(?:\s+please)?$|^one sentence(?:\s+please)?$|^boil (?:that|it) down$/;
const SIMPLER_RX =
  /^(?:explain|say|put|make)?\s*(?:that|it|this)?\s*(?:more\s+)?simpl(?:er|y)(?:\s+please)?$|^simplify(?:\s+(?:that|it|this))?$|^eli5$|^explain (?:that |it |this )?like i'?m (?:5|five)$/;
const SHORTER_RX =
  /^(?:make (?:that|it|this) )?shorter(?:\s+please)?$|^shorten (?:that|it|this)$|^condense(?:\s+(?:that|it|this))?$|^too long$|^tl;?dr$/;
const BULLETS_RX =
  /^(?:put (?:that|it|this) )?(?:in|as) bullet(?: point)?s?(?:\s+please)?$|^bullet points?(?:\s+please)?$|^(?:as|make it) a list$|^break (?:that|it|this) down$/;

export function rewriteMode(message: string): RewriteMode | null {
  const t = message.toLowerCase().replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 8) return null;
  if (ONE_SENTENCE_RX.test(t)) return 'one-sentence';
  if (SIMPLER_RX.test(t)) return 'simpler';
  if (SHORTER_RX.test(t)) return 'shorter';
  if (BULLETS_RX.test(t)) return 'bullets';
  return null;
}

/** Strip parentheticals and em-dash asides — the clutter "simpler" removes. */
function declutter(s: string): string {
  return s
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+—\s+[^—.]+(?=[.,;])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function applyRewrite(answer: string, mode: RewriteMode): string {
  const sents = splitSentences(answer.replace(/\s+/g, ' ').trim());
  if (sents.length === 0) return '';

  if (mode === 'one-sentence') {
    const idx = topSentenceIndexes(sents, 1)[0] ?? 0;
    return `One sentence: ${declutter(sents[idx])}`;
  }

  if (mode === 'shorter') {
    const picked = topSentenceIndexes(sents, 2).map(i => sents[i]);
    let out = '';
    for (const s of picked) {
      if (out && (out.length + 1 + s.length) > 240) break;
      out = out ? `${out} ${s}` : s;
    }
    return out || picked[0];
  }

  if (mode === 'simpler') {
    // The clearest sentences are usually the shortest meaningful ones among
    // the most representative — take the top 3 by score, keep the 2 shortest.
    const top = topSentenceIndexes(sents, 3).map(i => sents[i]);
    const simple = top
      .slice()
      .sort((a, b) => a.length - b.length)
      .slice(0, 2)
      .sort((a, b) => top.indexOf(a) - top.indexOf(b))
      .map(declutter);
    return `Simply put: ${simple.join(' ')}`;
  }

  // bullets
  const lines = sents
    .filter(s => !/\?\s*$/.test(s)) // trailing follow-up questions aren't content
    .slice(0, 6)
    .map(s => `• ${declutter(s).replace(/[.]+$/, '')}`);
  return lines.length > 0 ? lines.join('\n') : '';
}

/**
 * "say that simpler" / "in one sentence" / "shorter" / "bullet points" applied
 * to NAVI's previous answer. Returns '' when there's no rewrite command or no
 * previous answer worth reshaping.
 */
export function tryRewrite(message: string, history: Msg[]): string {
  const mode = rewriteMode(message);
  if (!mode) return '';
  let last = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') { last = history[i].content; break; }
  }
  if (last.trim().length < 60) return '';
  return applyRewrite(last, mode);
}
