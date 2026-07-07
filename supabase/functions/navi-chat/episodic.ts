// supabase/functions/navi-chat/episodic.ts
//
// NAVI v21 — Episodic memory across sessions.
//
// recall.ts (v17) can rebuild the thread of the CURRENT conversation. This
// module remembers across conversations: the topics a signed-in user actually
// explored are rolled into their durable profile (navi_memory), so on a new
// day, a new device, a brand-new chat, "what did we talk about last time?"
// gets a real answer — and NAVI's welcome-back can pick the thread up.
//
// Topic capture is deliberately conservative: only clean, entity-shaped topics
// are recorded (from factual asks, lessons, and plans) — never raw emotional
// sentences, which belong to the private facts/mood memory, not a topic list.

import { extractTopicEntity } from './context.ts';
import type { Profile } from './memory.ts';

type Msg = { role: 'user' | 'assistant'; content: string };

const MAX_TOPICS = 5;

// First-person / feelings never become "topics" — they're the user's life,
// not subject matter, and they're already held by the private memory layer.
const PERSONAL_RX = /\b(i|i'm|im|me|my|mine|myself|we|us|our|feel|feeling|sad|happy|scared|hurt|alone|lonely|angry|stressed|overwhelmed|anxious|depressed)\b/i;

/** Extract a clean topic from this message, or null when there isn't one. */
export function topicFrom(message: string): string | null {
  const entity = extractTopicEntity(message);
  if (entity) return entity;

  const t = message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[?!.]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const m =
    t.match(/^teach me (?:about |on )?(.+)$/) ??
    t.match(/^quiz me on (?:the )?(.+)$/) ??
    t.match(/\bsteps (?:to|for) (.+)$/) ??
    t.match(/^help me plan (?:to |for )?(.+)$/) ??
    t.match(/^how do i start (.+)$/);
  if (!m) return null;

  const topic = m[1].replace(/^(a|an|the|my)\s+/, '').trim();
  if (!topic || topic.split(/\s+/).length > 6) return null;
  if (PERSONAL_RX.test(topic)) return null;
  return topic;
}

/** Roll this message's topic (if any) into the topic list, newest first. */
export function updateTopics(existing: string[] | undefined, message: string): string[] | undefined {
  const t = topicFrom(message);
  if (!t) return existing;
  const rest = (existing ?? []).filter(x => x !== t);
  return [t, ...rest].slice(0, MAX_TOPICS);
}

const EPISODIC_RX =
  /\b(?:what (?:did|were) we (?:talk(?:ing)? about|discuss(?:ing)?|chat(?:ting)? about|get into)|what did we speak about|do you remember (?:what we (?:talked|spoke) about|our last (?:chat|conversation|talk|session)))\b/i;

const PAST_RX =
  /\b(last time|yesterday|last (?:chat|session|conversation|week|night)|previously|the other day|before today|when we last)\b/i;

/** Is this an ask about a PREVIOUS conversation (not the current one)? */
export function asksAboutLastTime(message: string): boolean {
  const t = message.toLowerCase();
  if (EPISODIC_RX.test(t) && PAST_RX.test(t)) return true;
  return /^do you remember (?:me|us|our last (?:chat|conversation|talk|session))[?!.]*$/i.test(message.trim());
}

/**
 * Answer "what did we talk about last time?" from the stored topic list.
 * Returns '' when the message isn't an episodic ask. Only called for
 * signed-in users — anonymous users have no cross-session memory to consult.
 */
export function tryEpisodic(message: string, stored: Profile): string {
  if (!asksAboutLastTime(message)) return '';

  const topics = stored.lastTopics ?? [];
  if (topics.length === 0) {
    return "We haven't built up a topic trail yet — but I'm keeping track from now on, so next time you ask, I'll have the receipts. What's on your mind today?";
  }
  const [t0, t1] = topics;
  const memory = t1
    ? `Last time we got into ${t0} — and before that, ${t1}.`
    : `Last time we got into ${t0}.`;
  return `${memory} Want to pick that back up, or start something new?`;
}
