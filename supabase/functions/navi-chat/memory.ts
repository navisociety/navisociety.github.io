// supabase/functions/navi-chat/memory.ts
//
// NAVI in-conversation personal memory (v15, expanded in v16). Deterministically
// extracts the user's name, age, place, birthday, favourites, and explicit
// "remember that ..." facts from the conversation history on every request
// (stateless — nothing is stored server-side), and answers questions like
// "what's my name?" or "what do you know about me?" directly instead of
// letting them fall into the knowledge nodes. Later statements override
// earlier ones.

import { todayInTZ } from './skills.ts';

export type Profile = {
  name?: string;
  age?: number;
  place?: string;
  birthday?: { month: number; day: number };
  favorites?: Record<string, string>;
  facts?: string[];
};

type Msg = { role: 'user' | 'assistant'; content: string };

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Words that follow "call me ..." without being a name.
const NOT_NAMES = new Set([
  'later', 'back', 'now', 'when', 'anytime', 'maybe', 'please', 'again',
  'tomorrow', 'tonight', 'today', 'crazy', 'stupid', 'out', 'up', 'on',
  'whatever', 'anything', 'something', 'that', 'this', 'it', 'a', 'an', 'the',
]);

const MAX_FACTS = 8;

function titleCase(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Flip first-person wording to second person so NAVI can echo a fact back. */
export function toSecondPerson(s: string): string {
  return s
    .replace(/\bi\s*am\b|\bi'm\b|\bim\b/gi, 'you are')
    .replace(/\bi've\b/gi, "you've")
    .replace(/\bi'll\b/gi, "you'll")
    .replace(/\bi\b/gi, 'you')
    .replace(/\bmy\b/gi, 'your')
    .replace(/\bmine\b/gi, 'yours')
    .replace(/\bmyself\b/gi, 'yourself')
    .replace(/\bme\b/gi, 'you');
}

function birthdayFrom(t: string): { month: number; day: number } | null {
  const m =
    t.match(/\b(?:my birthday is|i was born)\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/) ??
    t.match(/\b(?:my birthday is|i was born)\s+(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (!m) return null;
  const [a, b] = [m[1], m[2]];
  const day = /^\d/.test(a) ? parseInt(a, 10) : parseInt(b, 10);
  const month = MONTHS.indexOf(/^\d/.test(a) ? b : a) + 1;
  if (day < 1 || day > 31 || month < 1) return null;
  return { month, day };
}

const REMEMBER_RX = /^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:please\s+)?remember(?:\s+that|:)?\s+(.{3,140}?)[.!?]*$/i;

function extractFrom(text: string, profile: Profile): void {
  const t = text.toLowerCase();

  const name =
    t.match(/\bmy name(?:'s| is)\s+([a-z][a-z'-]{1,20})\b/)?.[1] ??
    t.match(/\bcall me\s+([a-z][a-z'-]{1,20})\b/)?.[1] ??
    t.match(/\bi go by\s+([a-z][a-z'-]{1,20})\b/)?.[1];
  if (name && !NOT_NAMES.has(name)) profile.name = titleCase(name);

  // Age: "i'm 19 years old" anywhere, or a bare "i am 19" only at the end of
  // the message ("i am 30 minutes away" must not count).
  const age =
    t.match(/\bi(?:'m| am)\s+(\d{1,2})\s+(?:years?|yrs?)\s+old\b/)?.[1] ??
    t.match(/\bi(?:'m| am)\s+(\d{1,2})\s*[.!?]*$/)?.[1];
  if (age) {
    const n = parseInt(age, 10);
    if (n >= 5 && n <= 99) profile.age = n;
  }

  const place =
    t.match(/\bi(?:'m| am) from\s+([a-z][a-z\s'-]{1,30}?)(?=\s+(?:and|but|so|because)\b|[.,!?;]|$)/)?.[1] ??
    t.match(/\bi live in\s+([a-z][a-z\s'-]{1,30}?)(?=\s+(?:and|but|so|because)\b|[.,!?;]|$)/)?.[1];
  if (place) {
    const p = place.trim().split(/\s+/).slice(0, 3).join(' ');
    if (p.length >= 3) profile.place = titleCase(p);
  }

  // v16: birthday — "my birthday is 12 march" / "i was born on march 12".
  const bd = birthdayFrom(t);
  if (bd) profile.birthday = bd;

  // v16: favourites — "my favourite colour is blue".
  const favRx = /\bmy favou?rite\s+([a-z][a-z ]{1,24}?)\s+(?:is|are)\s+([a-z0-9][a-z0-9' -]{1,40}?)(?=\s+(?:and|but|so|because)\b|[.,!?;]|$)/g;
  let fm: RegExpExecArray | null;
  while ((fm = favRx.exec(t)) !== null) {
    const thing = fm[1].trim().replace(/\bcolour\b/, 'color');
    const value = fm[2].trim();
    if (thing && value) {
      profile.favorites ??= {};
      profile.favorites[thing] = titleCase(value);
    }
  }

  // v16: explicit "remember that ..." facts.
  const rm = text.trim().match(REMEMBER_RX);
  if (rm) {
    const fact = rm[1].trim();
    profile.facts ??= [];
    if (!profile.facts.some(f => f.toLowerCase() === fact.toLowerCase())) {
      profile.facts.push(fact);
      if (profile.facts.length > MAX_FACTS) profile.facts.shift();
    }
  }
}

/** Build the profile from every user message in the conversation. */
export function extractProfile(history: Msg[], current: string): Profile {
  const profile: Profile = {};
  for (const m of history) if (m.role === 'user') extractFrom(m.content, profile);
  extractFrom(current, profile);
  return profile;
}

const NAVI_TZ = 'Africa/Johannesburg';

function daysUntilBirthday(bd: { month: number; day: number }, tz = NAVI_TZ): number {
  const now = todayInTZ(tz);
  const today = Date.UTC(now.y, now.m - 1, now.d);
  let target = Date.UTC(now.y, bd.month - 1, bd.day);
  if (target < today) target = Date.UTC(now.y + 1, bd.month - 1, bd.day);
  return Math.round((target - today) / 86400000);
}

function birthdayLabel(bd: { month: number; day: number }): string {
  const m = MONTHS[bd.month - 1];
  return `${bd.day} ${m.charAt(0).toUpperCase()}${m.slice(1)}`;
}

/**
 * v16: when the current message IS a memory statement ("remember that ...",
 * a whole-message favourite, or a birthday), confirm it directly instead of
 * letting retrieval guess at a reply.
 */
export function memoryAcknowledgement(message: string, profile: Profile): string | null {
  const trimmed = message.trim();

  const rm = trimmed.match(REMEMBER_RX);
  if (rm) {
    return `Locked in — I'll remember that ${toSecondPerson(rm[1].trim().replace(/[.!?]+$/, ''))}. Ask me anytime.`;
  }

  const t = trimmed.toLowerCase();
  if (/^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?my favou?rite\s+[a-z][a-z ]{1,24}?\s+(?:is|are)\s+.{1,40}[.!?]*$/.test(t) && profile.favorites) {
    const entries = Object.entries(profile.favorites);
    const [thing, value] = entries[entries.length - 1];
    return `Noted — favourite ${thing}: ${value}. I don't forget the things that matter to you.`;
  }

  if (/^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:my birthday is|i was born)\b/.test(t) && profile.birthday) {
    const days = daysUntilBirthday(profile.birthday);
    const when = days === 0 ? "that's TODAY — happy birthday" : days === 1 ? "that's tomorrow" : `${days} days away`;
    return `Got it — your birthday is ${birthdayLabel(profile.birthday)}, ${when}. I won't forget it.`;
  }

  return null;
}

/** Answer profile questions ("what's my name", "what do you know about me") from the profile. */
export function answerProfileQuestion(message: string, profile: Profile): string | null {
  const t = message.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (/\b(what s|whats|what is|say|remember) my name\b/.test(t) || /\bdo you (know|remember) (my name|who i am)\b/.test(t)) {
    return profile.name
      ? `You're ${profile.name}. I don't forget the people I talk to.`
      : "You haven't told me your name yet. What should I call you?";
  }

  if (/\bhow old am i\b/.test(t) || /\b(whats|what is) my age\b/.test(t)) {
    return profile.age
      ? `You told me — you're ${profile.age}. And whatever the number, it's the right age to build something.`
      : "You haven't told me your age yet. How old are you?";
  }

  if (/\bwhere (am i from|do i live|do i stay)\b/.test(t)) {
    return profile.place
      ? `You said you're from ${profile.place}. Home shapes us — how's it treating you?`
      : "You haven't told me where you're from yet. Where's home?";
  }

  // v16: birthday recall, with a live countdown.
  if (/\bwhen(?:s| is| s) my birthday\b/.test(t) || /\bdo you (know|remember) my birthday\b/.test(t) || /\bhow (long|many days) (until|till|before) my birthday\b/.test(t)) {
    if (!profile.birthday) return "You haven't told me your birthday yet. When is it?";
    const days = daysUntilBirthday(profile.birthday);
    const when = days === 0 ? "that's TODAY. Happy birthday!" : days === 1 ? 'tomorrow. One day away.' : `${days} days away.`;
    return `Your birthday is ${birthdayLabel(profile.birthday)} — ${when}`;
  }

  // v16: favourites recall — "what's my favourite colour?".
  const fav = t.match(/\b(?:whats|what is|what s|do you know|do you remember) my favou?rite ([a-z ]{2,24}?)$/) ??
              t.match(/\bmy favou?rite ([a-z ]{2,24}?) (?:is what|again)$/);
  if (fav) {
    const asked = fav[1].trim().replace(/\bcolour\b/, 'color');
    const stored = profile.favorites ?? {};
    const key = Object.keys(stored).find(k => k === asked || k.includes(asked) || asked.includes(k));
    return key
      ? `Your favourite ${key} is ${stored[key]}. You told me — and I listen.`
      : `You haven't told me your favourite ${asked} yet. What is it?`;
  }

  // v16: full recall — "what do you know/remember about me?".
  if (/\bwhat do you (know|remember) about me\b/.test(t) || /\btell me what you know about me\b/.test(t) || /\bwhat have i told you\b/.test(t)) {
    const bits: string[] = [];
    if (profile.name) bits.push(`your name is ${profile.name}`);
    if (profile.age) bits.push(`you're ${profile.age}`);
    if (profile.place) bits.push(`you're from ${profile.place}`);
    if (profile.birthday) bits.push(`your birthday is ${birthdayLabel(profile.birthday)}`);
    for (const [thing, value] of Object.entries(profile.favorites ?? {})) {
      bits.push(`your favourite ${thing} is ${value}`);
    }
    for (const f of profile.facts ?? []) bits.push(toSecondPerson(f));
    if (!bits.length) {
      return "Not much yet — this conversation is still young. Tell me your name, or say \"remember that…\" and I'll hold onto whatever matters.";
    }
    const list = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join('; ')}; and ${bits[bits.length - 1]}`;
    return `Here's what I know so far: ${list}. Tell me more and I'll keep building the picture.`;
  }

  return null;
}
