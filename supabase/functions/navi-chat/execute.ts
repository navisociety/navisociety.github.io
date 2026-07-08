// supabase/functions/navi-chat/execute.ts
//
// NAVI v24 — Multi-intent execution.
//
// The pipeline has always been first-match-wins: ONE engine answers the whole
// message. So "remind me to call mom tomorrow and give me a verse about hope"
// stored a single garbled reminder and never opened the Bible. This module
// makes NAVI execute EVERYTHING it was asked: it recognises a message carrying
// two or three distinct asks, splits it conservatively, and the caller runs
// each part through the engine pipeline and joins the answers.
//
// Division of labour with reason.ts (v20): reason.ts owns purely factual
// question+question compounds ("who is Tesla and what did he invent") — it
// carries entities across parts and synthesises. This module owns everything
// reason.ts can't touch: command+command and command+question mixes, where
// each part belongs to a DIFFERENT engine (reminders, Bible, math, dictionary,
// composer…). splitIntents() therefore refuses all-question splits.
//
// Conservative by design: a connector only splits when BOTH sides open like a
// real ask, so "remind me to call mom and dad", "a verse about hope and love",
// and emotional messages ("i'm sad and i want to talk") are never divided.

const CONNECTOR_RX = /\s+(?:and then|and also|and|then|plus|also)\s+/gi;

// A part qualifies as an independent ask when it opens like a request or a
// question. Deliberately verb-first: "call mom", "buy bread", "dad tomorrow"
// don't qualify, which is what protects natural compound objects.
const ASK_CUE_RX =
  /^(?:please\s+|pls\s+)?(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:please\s+)?(?:give me|tell me|show me|read me|remind me|help me plan|plan|quiz me|teach me|test me|define|explain|describe|solve|calculate|convert|compose|write|make|create|list|say|read|pray|remember|forget|clear|summarize|summarise|rewrite|what|what's|whats|who|who's|whos|when|when's|whens|where|where's|why|how|which|is|are|do|does|did|can)\b/i;

// Parts that are pure questions belong to reason.ts, not here.
const WH_ONLY_RX = /^(?:what|what's|whats|who|who's|whos|when|when's|whens|where|where's|why|how|which|is|are|do|does|did|can)\b/i;

// Feelings and crisis language are never split — one whole message, one whole
// human, handled by the emotional and crisis layers.
const NEVER_SPLIT_RX =
  /\b(feel|feeling|felt|sad|lonely|alone|scared|hurt|angry|stressed|overwhelmed|anxious|depressed|hopeless|worthless|cope|heal|grief|die|dying|death|kill|suicide|suicidal|self.?harm|give up)\b/i;

function clean(part: string): string {
  return part.trim().replace(/^[,;\s]+/, '').replace(/[,;\s]+$/, '').trim();
}

function qualifies(part: string): boolean {
  return part.split(/\s+/).length >= 2 && ASK_CUE_RX.test(part);
}

/**
 * Split a message into 2–3 independently-executable asks, or return [] when it
 * is a single ask (or something that must never be split). The caller answers
 * each part through the full engine pipeline and joins the replies.
 */
export function splitIntents(message: string): string[] {
  const m = message.trim();
  if (!m || m.length > 300) return [];
  if (NEVER_SPLIT_RX.test(m)) return [];

  // ── Sentence-level: "What is 2+2? Give me a verse about hope." ───────────
  const sentences = m.split(/[.?!;\n]+/).map(clean).filter(Boolean);
  if (sentences.length >= 2 && sentences.length <= 4) {
    const asks = sentences.filter(qualifies);
    if (asks.length >= 2 && asks.length === sentences.length && !asks.every(p => WH_ONLY_RX.test(p))) {
      return asks.slice(0, 3);
    }
  }

  // ── Connector-level: "remind me to X and give me Y" ──────────────────────
  if (sentences.length === 1) {
    const flat = clean(m.replace(/[?!.]+\s*$/, ''));
    const parts: string[] = [];
    let rest = flat;
    // Split at the first connector whose RIGHT side opens like an ask, then
    // keep splitting the tail the same way (max 3 parts).
    for (let i = 0; i < 2; i++) {
      let found = false;
      const rx = new RegExp(CONNECTOR_RX.source, 'gi');
      let hit: RegExpExecArray | null;
      while ((hit = rx.exec(rest)) !== null) {
        const left = clean(rest.slice(0, hit.index));
        const right = clean(rest.slice(hit.index + hit[0].length));
        if (qualifies(left) && qualifies(right)) {
          parts.push(left);
          rest = right;
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (parts.length) {
      parts.push(rest);
      if (!parts.every(p => WH_ONLY_RX.test(p))) return parts.slice(0, 3);
    }
  }

  return [];
}
