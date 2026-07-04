// supabase/functions/navi-chat/context.ts
//
// NAVI conversational reference resolution (v16). Factual follow-up questions
// that lean on a pronoun — "who is Nelson Mandela?" then "how old is he?" —
// are rewritten with the entity the user was just asking about, so retrieval
// and the web lookup see the real question. Deterministic and conservative:
// it only fires on short, question-shaped, third-person messages with a clear
// entity in recent history, and never on first-person (emotional) messages.

export type Msg = { role: 'user' | 'assistant'; content: string };

/** Pull the subject out of "who is X" / "tell me about X" style questions. */
export function extractTopicEntity(text: string): string | null {
  const t = text
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/^\s*(?:please|pls)\s+/, '')
    .replace(/[?!.]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const m =
    t.match(/^(?:who|what|where)(?:'s| is| was| are| were)\s+(?:a |an |the )?(.+)$/) ??
    t.match(/^tell me about\s+(?:a |an |the )?(.+)$/) ??
    t.match(/^(?:define|explain|describe)\s+(?:a |an |the )?(.+)$/);
  if (!m) return null;

  const entity = m[1].trim();
  if (!entity || entity.split(/\s+/).length > 6) return null;
  // Skip self/NAVI references and anything that is itself just a pronoun.
  if (/\b(you|your|yourself|navi|me|my|i|us|we|him|her|it|they|them|this|that)\b/.test(entity)) return null;
  return entity;
}

const PRONOUN_RX = /\b(he|she|it|they|him|them|his|hers|its|their|theirs|her)\b/i;
const FIRST_PERSON_RX = /\b(i|i'm|im|me|my|mine|myself|we|us|our)\b/i;
const QUESTION_SHAPE_RX = /^(who|what|when|where|which|how|is|was|are|were|does|do|did|has|have|and|tell me)\b/i;

/**
 * Rewrite a pronoun follow-up using the entity from the user's recent factual
 * questions. Returns the resolved message, or null when nothing applies.
 */
export function resolveReference(message: string, history: Msg[]): string | null {
  const t = message.trim();
  if (!t || t.split(/\s+/).length > 12) return null;
  if (!PRONOUN_RX.test(t)) return null;
  if (FIRST_PERSON_RX.test(t)) return null;
  if (!QUESTION_SHAPE_RX.test(t) && !t.endsWith('?')) return null;

  let entity: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    if (history[i].content.trim() === t) continue;
    entity = extractTopicEntity(history[i].content);
    if (entity) break;
  }
  if (!entity) return null;

  // Possessives become "<entity>'s"; "her" is possessive only before a word.
  const resolved = t
    .replace(/\b(his|hers|its|their|theirs)\b/gi, `${entity}'s`)
    .replace(/\bher\b(?=\s+[a-z])/gi, `${entity}'s`)
    .replace(/\b(he|she|it|they|him|them|her)\b/gi, entity);

  return resolved === t ? null : resolved;
}
