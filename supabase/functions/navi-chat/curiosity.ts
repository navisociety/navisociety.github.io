// supabase/functions/navi-chat/curiosity.ts
//
// NAVI v20 — Curiosity / Forward-Drive Engine.
//
// A conversation dies when the assistant only ever answers and then waits. Real
// thinkers push back the other way — they follow the thread, get curious, open
// the next door. After a substantive answer this layer appends ONE sharp,
// context-aware follow-up: it pulls the topic entity out of what the user asked
// and offers to go deeper on THAT, or asks a pointed question about it.
//
// It is deliberately restrained so it never becomes a tic:
//   • only on substantive replies (not tiny ones, not fallbacks, not sensitive)
//   • never when the reply already ends on a question
//   • never two turns in a row (throttled by conversation cadence)
//   • never for terse quick-chat users (they want the answer, not an interview)
//   • never on farewells / thanks.

import { extractTopicEntity } from './context.ts';

type Msg = { role: 'user' | 'assistant'; content: string };

export interface CuriosityOpts {
  sensitive: boolean;
  isFallback: boolean;
  /** User is in terse quick-chat mode — don't tack a question on. */
  terse: boolean;
}

const FAREWELL = /\b(bye|goodbye|see ya|see you|later|good ?night|gotta go|thanks|thank you|cheers|appreciate it)\b/i;

// Templates that name the topic — these make NAVI feel like it's tracking a
// specific thread, not reciting a canned "anything else?".
const ENTITY_PROMPTS = [
  (e: string) => `Want me to go deeper on ${e}?`,
  (e: string) => `Where does ${e} fit into what you're working on?`,
  (e: string) => `What made ${e} come up for you today?`,
  (e: string) => `Want the part of ${e} most people miss?`,
];

// Generic forward nudges when there's no clean entity to name.
const GENERIC_PROMPTS = [
  'Want me to take that further?',
  'Where do you want to go with this?',
  'Want the deeper cut on that?',
  'What\'s the part you\'re actually chewing on?',
];

/** How many assistant turns have already happened in this conversation. */
function assistantTurns(history: Msg[]): number {
  return history.filter(m => m.role === 'assistant').length;
}

/** The reply already ends by asking something — don't stack a second question. */
function endsWithQuestion(response: string): boolean {
  return /\?\s*$/.test(response.trim());
}

/** The previous assistant turn already ended on a question — space them out. */
function lastAssistantAsked(history: Msg[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return endsWithQuestion(history[i].content);
  }
  return false;
}

/**
 * Append one forward-driving follow-up, or return the response unchanged when a
 * follow-up would be noise.
 */
export function addCuriosity(
  response: string,
  message: string,
  history: Msg[],
  opts: CuriosityOpts,
): string {
  if (!response || opts.sensitive || opts.isFallback || opts.terse) return response;
  if (response.trim().length < 120) return response;          // too small to extend
  if (endsWithQuestion(response)) return response;            // already asks
  if (FAREWELL.test(message)) return response;                // don't pry on goodbye
  if (lastAssistantAsked(history)) return response;           // just asked last turn

  // Throttle: roughly every other substantive turn, so it drives without nagging.
  const turn = assistantTurns(history);
  if (turn % 2 !== 0) return response;

  const entity = extractTopicEntity(message);
  const prompt = entity
    ? ENTITY_PROMPTS[turn % ENTITY_PROMPTS.length](entity)
    : GENERIC_PROMPTS[turn % GENERIC_PROMPTS.length];

  return `${response.trim()}\n\n${prompt}`;
}
