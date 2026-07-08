// supabase/functions/navi-chat/memory.ts
//
// NAVI personal memory. Deterministically extracts the user's name, age, place,
// birthday, favourites, goals, work, key people, and explicit "remember that…"
// facts from what they say, and answers questions like "what's my name?" or
// "what do you know about me?" directly instead of letting them fall into the
// knowledge nodes.
//
// v15/v16 built this from the conversation history on every request (stateless).
// v18 makes it PERMANENT: the navi-chat edge function loads a saved profile from
// the navi_memory table (store.ts), merges it with what's said this turn
// (mergeProfiles), and saves it back — so a signed-in user's memory survives
// across chats, sessions, and devices. v18 also adds memory control ("forget
// my birthday", "forget everything about me"), mood continuity (detectMood +
// a gentle check-in when a low user returns), and returning-user greetings.
// Later statements always override earlier ones.

import { todayInTZ } from './skills.ts';

export type Profile = {
  name?: string;
  age?: number;
  place?: string;
  birthday?: { month: number; day: number };
  favorites?: Record<string, string>;
  facts?: string[];
  // v18: richer schema.
  goals?: string[];               // "my goal is…", "i'm working on…", "i want to…"
  work?: string;                  // "i work as…", "my job is…"
  people?: Record<string, string>; // relation → name, e.g. { brother: 'Sipho' }
  // v18: persistence + continuity metadata (stored in their own DB columns).
  lastSeen?: string;              // ISO timestamp of the previous message
  lastMood?: string;              // last detected mood label ('low' | 'stressed' | …)
  // v21: episodic memory — the topics recently explored, newest first, so
  // "what did we talk about last time?" works across chats and devices.
  lastTopics?: string[];
  // v22: cross-session reminders ("remind me to…"), managed by remind.ts.
  reminders?: Reminder[];
};

// v22: one held reminder. `due` is an ISO date (yyyy-mm-dd) in SA time;
// omitted means "surface on the very next session".
export type Reminder = { text: string; created: string; due?: string };

type Msg = { role: 'user' | 'assistant'; content: string };

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Words that follow "call me ..." without being a name.
const NOT_NAMES = new Set([
  'later', 'back', 'now', 'when', 'anytime', 'maybe', 'please', 'again',
  'tomorrow', 'tonight', 'today', 'crazy', 'stupid', 'out', 'up', 'on',
  'whatever', 'anything', 'something', 'that', 'this', 'it', 'a', 'an', 'the',
]);

const MAX_FACTS = 8;
const MAX_GOALS = 5;

// v18: relationships NAVI can hold onto. Canonicalised so "mum"/"mom"/"mother"
// all key on "mother". Order doesn't matter; the map is keyed by spoken form.
const RELATION_ALIASES: Record<string, string> = {
  mom: 'mother', mum: 'mother', mommy: 'mother', mother: 'mother', ma: 'mother',
  dad: 'father', daddy: 'father', father: 'father', pa: 'father',
  bro: 'brother', brother: 'brother', sis: 'sister', sister: 'sister',
  son: 'son', daughter: 'daughter', kid: 'child', child: 'child',
  wife: 'wife', husband: 'husband', partner: 'partner',
  girlfriend: 'girlfriend', gf: 'girlfriend', boyfriend: 'boyfriend', bf: 'boyfriend',
  fiance: 'fiancé', fiancee: 'fiancée',
  friend: 'friend', bestie: 'best friend', boss: 'boss', mentor: 'mentor',
  pastor: 'pastor', dog: 'dog', cat: 'cat', pet: 'pet',
};
const RELATION_KEYS = Object.keys(RELATION_ALIASES).sort((a, b) => b.length - a.length).join('|');

// Words that are never a real person's name after "is called / is named / is".
const NOT_PERSON_NAMES = new Set([
  'a', 'an', 'the', 'my', 'so', 'very', 'really', 'just', 'not', 'here', 'there',
  'good', 'great', 'fine', 'okay', 'ok', 'cool', 'amazing', 'the best', 'coming',
  'gone', 'away', 'sick', 'ill', 'older', 'younger', 'tall', 'short', 'named',
]);

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

  // v18: goals — "my goal is to launch my app", "i'm working on my album",
  // "i want to move to Cape Town", "i'm trying to save money". Kept short.
  const goalRx = /\b(?:my goal is|my dream is|i(?:'m| am) working on|i(?:'m| am) trying to|i want to|i(?:'m| am) building)\s+(.{3,80}?)(?=[.,!?;]|$)/g;
  let gm: RegExpExecArray | null;
  while ((gm = goalRx.exec(t)) !== null) {
    const goal = gm[1].trim().replace(/\s+/g, ' ');
    if (goal.length >= 3) {
      profile.goals ??= [];
      if (!profile.goals.some(g => g.toLowerCase() === goal.toLowerCase())) {
        profile.goals.push(goal);
        if (profile.goals.length > MAX_GOALS) profile.goals.shift();
      }
    }
  }

  // v18: work — "i work as a nurse", "my job is teaching", "i'm a designer".
  // "i'm a" is greedy, so only accept a short noun-ish phrase, not a sentence.
  const work =
    t.match(/\bi work as\s+(?:an?\s+)?([a-z][a-z ]{2,28}?)(?=\s+(?:and|but|so|because|at|for|in)\b|[.,!?;]|$)/)?.[1] ??
    t.match(/\bmy job is\s+(?:being\s+)?(?:an?\s+)?([a-z][a-z ]{2,28}?)(?=\s+(?:and|but|so|because|at|for|in)\b|[.,!?;]|$)/)?.[1] ??
    t.match(/\bi(?:'m| am) a\s+([a-z]{3,20}(?:\s+[a-z]{3,20})?)\s+(?:by profession|for a living|for work)\b/)?.[1];
  if (work) {
    const w = work.trim().split(/\s+/).slice(0, 3).join(' ');
    if (w.length >= 3) profile.work = w;
  }

  // v18: people — "my brother is called Sipho", "my mom's name is Grace",
  // "my boss is John". Capture the relation and the name.
  const relRx = new RegExp(
    `\\bmy\\s+(${RELATION_KEYS})(?:'s)?\\s+(?:name\\s+is|is\\s+(?:called|named)|is)\\s+([a-z][a-z'-]{1,20})\\b`,
    'g',
  );
  let pm: RegExpExecArray | null;
  while ((pm = relRx.exec(t)) !== null) {
    const relation = RELATION_ALIASES[pm[1]] ?? pm[1];
    const person = pm[2];
    if (person && !NOT_PERSON_NAMES.has(person)) {
      profile.people ??= {};
      profile.people[relation] = titleCase(person);
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

/**
 * v18: fold a freshly-learned profile (`overlay`, usually from just this turn)
 * onto the saved one (`base`). Scalars overlay-win when present; facts/goals
 * union (capped, base first); favourites/people merge per key (overlay wins).
 * This is how the durable memory absorbs each new thing the user says without
 * losing what it already knew.
 */
export function mergeProfiles(base: Profile, overlay: Profile): Profile {
  const out: Profile = { ...base };

  if (overlay.name) out.name = overlay.name;
  if (overlay.age !== undefined) out.age = overlay.age;
  if (overlay.place) out.place = overlay.place;
  if (overlay.birthday) out.birthday = overlay.birthday;
  if (overlay.work) out.work = overlay.work;
  if (overlay.lastSeen) out.lastSeen = overlay.lastSeen;
  if (overlay.lastMood) out.lastMood = overlay.lastMood;

  if (overlay.favorites) out.favorites = { ...(base.favorites ?? {}), ...overlay.favorites };
  if (overlay.people) out.people = { ...(base.people ?? {}), ...overlay.people };

  if (overlay.facts?.length) {
    const seen = new Set((base.facts ?? []).map(f => f.toLowerCase()));
    const merged = [...(base.facts ?? [])];
    for (const f of overlay.facts) if (!seen.has(f.toLowerCase())) merged.push(f);
    out.facts = merged.slice(-MAX_FACTS);
  }
  if (overlay.goals?.length) {
    const seen = new Set((base.goals ?? []).map(g => g.toLowerCase()));
    const merged = [...(base.goals ?? [])];
    for (const g of overlay.goals) if (!seen.has(g.toLowerCase())) merged.push(g);
    out.goals = merged.slice(-MAX_GOALS);
  }

  return out;
}

// ── v18: mood continuity ──────────────────────────────────────────────────────

// Canonical mood → the first-person cues that signal it. Order matters: the
// first match wins, so heavier states are listed before lighter ones.
const MOOD_CUES: Array<{ mood: string; rx: RegExp }> = [
  { mood: 'low', rx: /\bi(?:'m| am)?\s*(?:feeling\s+)?(?:so\s+|really\s+|very\s+)?(?:depressed|hopeless|empty|worthless|numb|broken|miserable|heartbroken)\b|\bi feel\s+(?:so\s+|really\s+)?(?:down|low|empty|hopeless|worthless|lost)\b|\bi(?:'m| am)\s+(?:so\s+|really\s+)?(?:sad|down|unhappy)\b/ },
  { mood: 'stressed', rx: /\bi(?:'m| am)?\s*(?:feeling\s+)?(?:so\s+|really\s+|very\s+)?(?:stressed|overwhelmed|anxious|panicking|burnt out|burned out|under pressure|exhausted|drained)\b|\bi feel\s+(?:so\s+|really\s+)?(?:stressed|anxious|overwhelmed|tense)\b/ },
  { mood: 'tired', rx: /\bi(?:'m| am)?\s*(?:feeling\s+)?(?:so\s+|really\s+)?(?:tired|worn out|sleepy|shattered|knackered)\b/ },
  { mood: 'angry', rx: /\bi(?:'m| am)?\s*(?:feeling\s+)?(?:so\s+|really\s+)?(?:angry|furious|frustrated|pissed off|fed up|irritated)\b/ },
  { mood: 'good', rx: /\bi(?:'m| am)?\s*(?:feeling\s+)?(?:so\s+|really\s+|very\s+)?(?:great|amazing|happy|excited|blessed|grateful|good|wonderful|fantastic|on top of the world)\b|\bi feel\s+(?:so\s+|really\s+)?(?:great|happy|good|amazing|alive)\b/ },
];

/** Detect the user's mood from a message, or null when there's no clear signal. */
export function detectMood(message: string): string | null {
  const t = message.toLowerCase();
  for (const { mood, rx } of MOOD_CUES) if (rx.test(t)) return mood;
  return null;
}

// ── v18: memory control ("forget …") ─────────────────────────────────────────

export type Forget =
  | { kind: 'all' }
  | { kind: 'field'; field: 'name' | 'age' | 'place' | 'birthday' | 'work' }
  | { kind: 'favorite'; thing: string }
  | { kind: 'person'; relation: string }
  | { kind: 'fact'; text: string };

const FORGET_LEAD = /^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:please\s+)?(?:forget|delete|erase|wipe|clear)\s+/i;

/**
 * Detect a request to make NAVI forget something. Anchored to the start of the
 * message so "I can never forget her" isn't treated as a command.
 */
export function detectForget(message: string): Forget | null {
  const trimmed = message.trim();
  if (!FORGET_LEAD.test(trimmed)) return null;
  const rest = trimmed.replace(FORGET_LEAD, '').replace(/[.!?]+$/, '').trim();
  const r = rest.toLowerCase();

  if (/^(?:everything|all|it all|my (?:memory|data|info|details)|about me|me|everything about me|everything you know)/.test(r)) {
    return { kind: 'all' };
  }
  if (/^(?:my\s+)?name/.test(r)) return { kind: 'field', field: 'name' };
  if (/^(?:my\s+)?age|^how old i am/.test(r)) return { kind: 'field', field: 'age' };
  if (/^(?:where i(?:'m| am) from|my (?:place|location|city|town|home))/.test(r)) return { kind: 'field', field: 'place' };
  if (/^(?:my\s+)?birthday/.test(r)) return { kind: 'field', field: 'birthday' };
  if (/^(?:my\s+)?(?:job|work|occupation|career)/.test(r)) return { kind: 'field', field: 'work' };

  const fav = r.match(/^(?:my\s+)?favou?rite\s+([a-z ]{2,24})$/);
  if (fav) return { kind: 'favorite', thing: fav[1].trim().replace(/\bcolour\b/, 'color') };

  const rel = r.match(new RegExp(`^(?:my\\s+)?(${RELATION_KEYS})(?:'s name)?$`));
  if (rel) return { kind: 'person', relation: RELATION_ALIASES[rel[1]] ?? rel[1] };

  // "forget that I …" / freeform → try to drop a matching stored fact.
  const fact = rest.replace(/^that\s+/i, '').trim();
  if (fact.length >= 3) return { kind: 'fact', text: fact };
  return null;
}

/** Apply a forget request to the profile, returning the new profile + a reply. */
export function applyForget(profile: Profile, forget: Forget): { profile: Profile; reply: string } {
  if (forget.kind === 'all') {
    return {
      profile: {},
      reply: "Done — I've cleared everything I had saved about you. Clean slate. Tell me whatever you'd like me to hold onto from here.",
    };
  }

  const next: Profile = { ...profile };

  if (forget.kind === 'field') {
    if (forget.field === 'birthday') delete next.birthday;
    else delete next[forget.field];
    return { profile: next, reply: `Forgotten — I've dropped your ${forget.field === 'place' ? 'location' : forget.field}. It's gone from my memory.` };
  }

  if (forget.kind === 'favorite') {
    if (next.favorites) {
      next.favorites = { ...next.favorites };
      const key = Object.keys(next.favorites).find(k => k === forget.thing || k.includes(forget.thing) || forget.thing.includes(k));
      if (key) { delete next.favorites[key]; return { profile: next, reply: `Done — I've forgotten your favourite ${key}.` }; }
    }
    return { profile: next, reply: `I didn't have a favourite ${forget.thing} saved, so there's nothing to forget there.` };
  }

  if (forget.kind === 'person') {
    if (next.people && next.people[forget.relation]) {
      next.people = { ...next.people };
      delete next.people[forget.relation];
      return { profile: next, reply: `Forgotten — I've cleared what I had about your ${forget.relation}.` };
    }
    return { profile: next, reply: `I didn't have anything saved about your ${forget.relation}.` };
  }

  // fact
  const target = forget.text.toLowerCase();
  if (next.facts?.length) {
    const kept = next.facts.filter(f => {
      const fl = f.toLowerCase();
      return !(fl === target || fl.includes(target) || target.includes(fl));
    });
    if (kept.length < next.facts.length) {
      next.facts = kept;
      return { profile: next, reply: "Done — I've let that go. It's out of my memory." };
    }
  }
  return { profile: next, reply: "I don't have that one saved, so there's nothing to forget — but noted, I won't hold onto it." };
}

// ── v18: returning-user + mood check-in ──────────────────────────────────────

const RETURN_GAP_MS = 6 * 60 * 60 * 1000; // only re-greet after a real break

/** Responses NAVI must never wrap in a chirpy welcome (crisis handling). */
function isCrisisReply(response: string): boolean {
  return /\bSADAG\b|0800\s?567\s?567|lifeline|suicide|crisis line/i.test(response);
}

/**
 * When a signed-in user opens a fresh session after a real gap, warm the first
 * reply with a welcome-back (by name if known) and — if they left on a low or
 * stressed note — a gentle, non-clinical check-in. Returns the response
 * unchanged when it isn't appropriate (no gap, crisis reply, empty stored).
 */
export function addReturningGreeting(response: string, stored: Profile, nowMs = Date.now()): string {
  if (!stored.lastSeen || isCrisisReply(response)) return response;
  const last = Date.parse(stored.lastSeen);
  if (!Number.isFinite(last) || nowMs - last < RETURN_GAP_MS) return response;

  const who = stored.name ? `, ${stored.name}` : '';
  // v21: pick the thread back up — name the last topic when mood doesn't
  // take precedence, so the welcome feels like a continued relationship.
  const topic = stored.lastTopics?.[0];
  let lead = topic
    ? `Welcome back${who}. Last time we were into ${topic} — happy to go back there anytime.`
    : `Welcome back${who}.`;
  if (stored.lastMood === 'low') {
    lead = `Good to see you again${who}. Last time you were carrying something heavy — I've been thinking about that. How are you holding up today?`;
  } else if (stored.lastMood === 'stressed') {
    lead = `Welcome back${who}. Last time felt like a lot was on you — did you get any breathing room? Either way, I'm here.`;
  }
  return `${lead} ${response}`;
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

  // v18: confirm a stated goal.
  if (/^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:my goal is|my dream is|i(?:'m| am) working on|i want to|i(?:'m| am) trying to|i(?:'m| am) building)\b/.test(t) && profile.goals?.length) {
    const goal = profile.goals[profile.goals.length - 1];
    return `Locked in — you're working toward: ${goal}. I've got that, and I'll hold you to it. What's the next step?`;
  }

  // v18: confirm work.
  if (/^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:i work as|my job is|i(?:'m| am) a )\b/.test(t) && profile.work) {
    return `Got it — you work as ${profile.work}. I'll keep that in mind.`;
  }

  // v18: confirm a person.
  if (/^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?my\s+/.test(t) && profile.people) {
    const entries = Object.entries(profile.people);
    if (entries.length) {
      const [rel, nm] = entries[entries.length - 1];
      if (t.includes(rel) || Object.keys(RELATION_ALIASES).some(a => t.includes(a) && RELATION_ALIASES[a] === rel)) {
        return `Noted — your ${rel}, ${nm}. I'll remember them.`;
      }
    }
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

  // v18: work recall — "what do I do for work?", "what's my job?".
  if (/\b(?:what s|whats|what is|what do) (?:my job|i do for (?:work|a living)|my work|my occupation)\b/.test(t) || /\bwhere do i work\b/.test(t)) {
    return profile.work
      ? `You told me you work as ${profile.work}. I remember what you do.`
      : "You haven't told me what you do for work yet. What's your line?";
  }

  // v18: goal recall — "what's my goal?", "what am I working on?".
  if (/\b(?:what s|whats|what is|what are) my goals?\b/.test(t) || /\bwhat am i working (?:on|towards|toward)\b/.test(t) || /\b(?:what s|whats|what is) my dream\b/.test(t)) {
    if (!profile.goals?.length) return "You haven't told me a goal yet. What are you working toward?";
    const list = profile.goals.length === 1 ? profile.goals[0] : `${profile.goals.slice(0, -1).join('; ')}; and ${profile.goals[profile.goals.length - 1]}`;
    return `You're working toward: ${list}. I'm in your corner on that.`;
  }

  // v18: person recall — "what's my brother's name?".
  const personAsk = t.match(new RegExp(`\\b(?:whats|what is|what s|who is|do you (?:know|remember)) my (${RELATION_KEYS})(?:s| s)? (?:name|called)?\\b`)) ??
                    t.match(new RegExp(`\\bmy (${RELATION_KEYS})(?:'s)? name\\b`));
  if (personAsk) {
    const rel = RELATION_ALIASES[personAsk[1]] ?? personAsk[1];
    const nm = profile.people?.[rel];
    return nm
      ? `Your ${rel} is ${nm}. I remember the people who matter to you.`
      : `You haven't told me your ${rel}'s name yet. What is it?`;
  }

  // v16: full recall — "what do you know/remember about me?".
  if (/\bwhat do you (know|remember) about me\b/.test(t) || /\btell me what you know about me\b/.test(t) || /\bwhat have i told you\b/.test(t)) {
    const bits: string[] = [];
    if (profile.name) bits.push(`your name is ${profile.name}`);
    if (profile.age) bits.push(`you're ${profile.age}`);
    if (profile.place) bits.push(`you're from ${profile.place}`);
    if (profile.work) bits.push(`you work as ${profile.work}`);
    if (profile.birthday) bits.push(`your birthday is ${birthdayLabel(profile.birthday)}`);
    for (const [thing, value] of Object.entries(profile.favorites ?? {})) {
      bits.push(`your favourite ${thing} is ${value}`);
    }
    for (const [rel, nm] of Object.entries(profile.people ?? {})) {
      bits.push(`your ${rel} is ${nm}`);
    }
    for (const g of profile.goals ?? []) bits.push(`you're working toward ${g}`);
    for (const f of profile.facts ?? []) bits.push(toSecondPerson(f));
    if (!bits.length) {
      return "Not much yet — this conversation is still young. Tell me your name, or say \"remember that…\" and I'll hold onto whatever matters.";
    }
    const list = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join('; ')}; and ${bits[bits.length - 1]}`;
    return `Here's what I know so far: ${list}. Tell me more and I'll keep building the picture.`;
  }

  return null;
}
