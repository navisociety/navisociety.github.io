// supabase/functions/navi-chat/deepen.ts
//
// NAVI progressive depth (v17). When NAVI answers a factual question from the
// web and the user replies "tell me more" / "go on", NAVI used to either repeat
// the same blurb or fall back to a generic prompt. Now it pulls the FULL article
// extract, skips the sentences it already delivered, and serves the next slice —
// so "tell me more" actually goes deeper. Deterministic: the continuation is a
// pure function of the full text and what was already shown; only the fetch is
// I/O. Fires only after a real factual answer, so emotional "tell me more"
// follow-ups are untouched (they stay on the knowledge path).

type Msg = { role: 'user' | 'assistant'; content: string };

const MORE_RX =
  /^(tell me more|tell me more about (?:it|that|this|them)|more|more please|go on|continue|keep going|and then|whats next|what else|go deeper|deeper|expand( on that)?|more detail|more details|the rest|carry on|say more)$/;

/** Is this a bare "tell me more" style follow-up? */
export function wantsMore(message: string): boolean {
  const t = message.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 6) return false;
  return MORE_RX.test(t);
}

/** Normalise a sentence for overlap comparison — punctuation-insensitive. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Return the portion of `full` that hasn't been shown yet. `alreadyShown` is
 * the previous answer NAVI gave. Sentences whose opening overlaps what was
 * already shown are skipped; the next unseen sentences are returned up to
 * `maxChars`, always ending on a sentence boundary.
 *
 * Returns '' when nothing new remains, or when `alreadyShown` doesn't overlap
 * the start of `full` at all (meaning the prior answer wasn't from this text —
 * we should not fabricate a "continuation").
 */
export function nextChunk(full: string, alreadyShown: string, maxChars = 900): string {
  const sents = sentences(full);
  if (sents.length === 0) return '';
  const shownWords = new Set(norm(alreadyShown).split(' ').filter(w => w.length > 3));

  // A sentence counts as "already seen" when most of its content words were in
  // the previous answer. Word overlap (not a prefix match) survives the small
  // edits the earlier answer went through — e.g. Wikipedia's full extract
  // reprints the lead sentence with an added pronunciation clause.
  const seen = (s: string): boolean => {
    const words = norm(s).split(' ').filter(w => w.length > 3);
    if (words.length === 0) return true; // nothing meaningful to add
    const overlap = words.filter(w => shownWords.has(w)).length / words.length;
    return overlap >= 0.6;
  };

  // Confirm the prior answer really came from this article: at least one of the
  // opening sentences must overlap what was shown.
  if (!sents.slice(0, 2).some(seen)) return '';

  const fresh = sents.filter(s => !seen(s));
  if (fresh.length === 0) return '';

  let out = '';
  for (const s of fresh) {
    if (out && (out.length + 1 + s.length) > maxChars) break;
    out = out ? `${out} ${s}` : s;
  }
  return out.trim();
}

/**
 * Fetch a longer plain-text extract for a Wikipedia title (multiple paragraphs,
 * not just the lead sentence the summary endpoint returns).
 */
export async function wikiFullExtract(title: string): Promise<string> {
  if (!title) return '';
  try {
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1' +
      '&exsectionformat=plain&redirects=1&format=json&titles=' +
      encodeURIComponent(title);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4500),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return '';
    const data = await res.json();
    const pages = data?.query?.pages ?? {};
    const first = Object.values(pages)[0] as { extract?: string } | undefined;
    const extract = typeof first?.extract === 'string' ? first.extract.trim() : '';
    // Keep only prose up to the first section heading run of newlines.
    return extract.replace(/\s*\n\s*\n[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}
