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
  // v23: tastes — things the user loves and can't stand ("i love jazz",
  // "i don't like mushrooms"). Negation-aware; a thing moves between lists.
  likes?: string[];
  dislikes?: string[];
  // v23: completed goals ("i launched my app!") — celebrated and kept.
  wins?: string[];
  // v23: dated life events ("my exam is on friday"), managed by life.ts.
  // NAVI asks how it went once the date has passed.
  events?: LifeEvent[];
  // v25: agentic workflows — saved multi-step routines run on command or when
  // their trigger phrase is spoken. Managed by agent.ts.
  workflows?: Workflow[];
  // v25: the active mission — one goal decomposed into steps that NAVI walks
  // the user through across sessions. Managed by agent.ts.
  mission?: Mission;
  // v29: queued mission goals (cap 3) — auto-promoted to the active mission
  // the moment the current one completes. Managed by agent.ts.
  missionQueue?: string[];
  // v26: tracked habits with streaks ("track my habit: pray"). Managed by habit.ts.
  habits?: Habit[];
  // v26: mood journal — one entry per SA day (last signal of the day wins),
  // newest last, capped, so "how have i been feeling lately?" has real data.
  moods?: MoodEntry[];
  // v28: the weekly review snapshot — counters captured when "review my week"
  // last ran, so the next review reports honest deltas. Managed by review.ts.
  review?: ReviewSnapshot;
  // v31: a pending chat-cleanup confirmation — stamped when NAVI counts the
  // old chats and asks; consumed, cancelled, or replaced by the next chat
  // command, and expires if left hanging. Managed by chats.ts.
  chatCleanup?: ChatCleanup;
  // v32: a pending email-send confirmation — stamped when NAVI reads a draft
  // back and asks; consumed on yes (the draft is re-read at execute time),
  // cancelled on no, refused stale. Managed by mail.ts.
  mailSend?: MailSend;
  // v33: sends waiting for their moment ("send draft 2 tomorrow morning") —
  // confirmed at schedule time, fired by the first session after the time
  // passes (NAVI only speaks when spoken to). Cap 3. Managed by mail.ts.
  mailScheduled?: ScheduledSend[];
};

// v31: one pending chat cleanup. `cutoff` is the ISO timestamp a session's
// updated_at must be OLDER than to be deleted; `count` is what NAVI counted
// when it asked (re-counted at execute time, so the reply stays honest);
// `asked` is when the offer was made — a bare "yes" only counts while fresh.
export type ChatCleanup = { cutoff: string; count: number; asked: string };

// v32: one pending email send. `id` is the navi_emails row NAVI offered to
// send (re-read at execute time so an edited/deleted draft is never mis-sent);
// `to`/`subject` echo what was offered; `asked` is when — a bare "yes" only
// counts while fresh.
// v33: `sendAt` (ISO datetime) marks a SCHEDULED offer — the yes books the
// send onto Profile.mailScheduled instead of firing it immediately.
export type MailSend = { id: string; to: string; subject: string; asked: string; sendAt?: string };

// v33: one booked send. `id` is the navi_emails draft row (re-read when the
// send actually fires, so an edited/deleted draft is never mis-sent);
// `sendAt` is the ISO datetime it becomes due; the send fires on the first
// session-start after that moment — never from a cron, never behind the
// user's back.
export type ScheduledSend = { id: string; to: string; subject: string; sendAt: string; created: string };

// v25: one saved workflow. `steps` are ordinary asks run through the full
// engine pipeline in order; `trigger` is an exact phrase that auto-runs it.
// v26: `daily` workflows auto-run on the first session of each new SA day;
// `lastRun` (yyyy-mm-dd) stops a second run the same day.
export type Workflow = { name: string; steps: string[]; trigger?: string; created: string; daily?: boolean; lastRun?: string };

// v26: one tracked habit. `lastDone` is an ISO date (yyyy-mm-dd) in SA time;
// a log the day after lastDone extends the streak, any later day restarts it.
// v29: `recent` keeps the last 14 logged dates (newest last) so sparklines can
// paint days the current streak can no longer see (pre-break logs).
export type Habit = { name: string; created: string; lastDone?: string; streak: number; best: number; total: number; recent?: string[] };

// v26: one mood journal entry — a canonical detectMood label on an SA date.
export type MoodEntry = { mood: string; date: string };

// v28: what the world looked like at the last weekly review. Every field is
// a small counter or capped copy, so the row stays tiny. `offered` (yyyy-mm-dd)
// stops the session-start "review my week?" offer repeating within a day;
// `date` is absent until the first review actually runs.
export type ReviewSnapshot = {
  date?: string;                        // yyyy-mm-dd (SA) of the last review
  habitTotals?: Record<string, number>; // habit name → lifetime total then
  wins?: string[];                      // the wins list then (already capped)
  reminders?: number;                   // open reminders then
  missionGoal?: string;                 // active mission then, if any
  missionDone?: number;                 // …and how many steps were done
  offered?: string;                     // yyyy-mm-dd of the last offer note
};

// v25: the active mission. `done` counts completed steps, so the current step
// is steps[done]. Completing the last step moves `goal` to the wins list.
// v27: `touched` is the last time a step moved (advance/skip/add); a mission
// idle 3+ days earns a session-start nudge, and `nudged` (yyyy-mm-dd) stops
// the same nudge repeating within a day.
export type Mission = { goal: string; steps: string[]; done: number; created: string; touched?: string; nudged?: string };

// v23: one life event. `date` is an ISO date (yyyy-mm-dd) in SA time.
export type LifeEvent = { text: string; date: string };

// v22: one held reminder. `due` is an ISO date (yyyy-mm-dd) in SA time;
// omitted means "surface on the very next session".
// v30: `offered` stamps the day NAVI offered to escalate a long-waiting
// reminder into a habit or mission step — one offer per reminder, ever.
export type Reminder = { text: string; created: string; due?: string; offered?: string };

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
const MAX_PREFS = 8;
const MAX_WINS = 10;

// v23: language that must never be handled by the memory layer — a message
// like "i want to die" is a crisis signal, not a goal to lock in. The crisis
// nodes own these; memory extraction and acknowledgements step aside.
const CRISIS_RX = /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

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

// ── v23: likes & dislikes ─────────────────────────────────────────────────────

const LIKE_RX =
  /\bi\s+(?:really\s+|absolutely\s+|just\s+|truly\s+)?(?:love|like|enjoy|adore)\s+([a-z][a-z0-9' -]{1,40}?)(?=\s+(?:and|but|so|because|though|when|more|most|the most|now|again|lately|these days)\b|[.,!?;]|$)/;
const DISLIKE_RX =
  /\bi\s+(?:really\s+|absolutely\s+|just\s+|truly\s+)?(?:hate|dislike|can(?:no|')t stand|do(?:n'| no)t\s+(?:really\s+)?(?:like|enjoy))\s+([a-z][a-z0-9' -]{1,40}?)(?=\s+(?:and|but|so|because|though|when|now|again|lately|these days|anymore|any more)\b|[.,!?;]|$)/;

// Objects that aren't a taste: pure pronouns, NAVI itself, and heavy states
// ("i hate my life") that belong to the crisis/emotional layer.
const PREF_BAN =
  /^(?:you|u|it|that|this|these|those|him|her|them|navi|me|myself|everything|everyone|everybody|life|my life|living|being)\b/;

/** Normalise a liked/disliked thing, or null when it isn't a real taste. */
function prefObject(raw: string): string | null {
  const v = raw.trim().replace(/^(?:the|a|an)\s+/, '').replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 40) return null;
  if (v.split(/\s+/).length > 5) return null;
  if (PREF_BAN.test(v) || CRISIS_RX.test(v)) return null;
  return v;
}

/** Append a taste, dedup'd, newest kept, capped. */
function addPref(list: string[], thing: string): void {
  const i = list.findIndex(x => x === thing);
  if (i !== -1) list.splice(i, 1);
  list.push(thing);
  if (list.length > MAX_PREFS) list.shift();
}

function extractFrom(text: string, profile: Profile): void {
  const t = text.toLowerCase();

  // v23: negation-aware — "my name is not dian" states what ISN'T true, so
  // nothing is captured; filler adverbs ("actually", "still") are skipped.
  const nameM =
    t.match(/\bmy name(?:'s| is)\s+(not\s+)?(?:actually\s+|really\s+|still\s+|now\s+|officially\s+)?([a-z][a-z'-]{1,20})\b/) ??
    t.match(/\bcall me\s+(not\s+)?([a-z][a-z'-]{1,20})\b/) ??
    t.match(/\bi go by\s+(not\s+)?([a-z][a-z'-]{1,20})\b/);
  const name = nameM && !nameM[1] ? nameM[2] : undefined;
  if (name && !NOT_NAMES.has(name)) profile.name = titleCase(name);

  // Age: "i'm 19 years old" anywhere, or a bare "i am 19" only at the end of
  // the message or a clause ("i'm 24, and…") — "i am 30 minutes away" must
  // not count, so nothing but punctuation may follow the number.
  const age =
    t.match(/\bi(?:'m| am)\s+(\d{1,2})\s+(?:years?|yrs?)\s+old\b/)?.[1] ??
    t.match(/\bi(?:'m| am)\s+(\d{1,2})\s*(?=[,.!?;]|$)/)?.[1];
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
    // v23: "my favourite colour is not blue" tells us what it isn't — skip.
    if (/^not\b/.test(value) || /\bnot\b\s*$/.test(thing)) continue;
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
    // v23: crisis and despair language is never a "goal" — "i want to die" /
    // "i want to give up" belong to the crisis and encouragement nodes, and
    // locking them in as ambitions would be monstrous.
    if (CRISIS_RX.test(goal) || /\b(give up|quit|be dead|be gone|stop existing)\b/.test(goal) || /^not\b/.test(goal)) continue;
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
    if (w.length >= 3 && !/^not\b/.test(w)) profile.work = w;
  }

  // v23: likes & dislikes — "i love jazz", "i can't stand traffic". Negation
  // aware by construction: "i don't like X" only ever lands in dislikes.
  // Naming a thing you now love pulls it off the dislikes list (and vice
  // versa), so the newest word always wins. Questions never state a taste —
  // "do i like mushrooms?" contains "i like mushrooms" but asserts nothing.
  const isQuestion = /\?\s*$/.test(text.trim()) ||
    /^(?:do|does|did|what|why|how|when|where|who|which|am|is|are|can|could|will|would|should)\b/.test(t);
  if (!isQuestion) {
    let lm: RegExpExecArray | null;
    const likeRx = new RegExp(LIKE_RX.source, 'g');
    while ((lm = likeRx.exec(t)) !== null) {
      const thing = prefObject(lm[1]);
      if (!thing) continue;
      profile.likes ??= [];
      addPref(profile.likes, thing);
      if (profile.dislikes) profile.dislikes = profile.dislikes.filter(d => d !== thing);
    }
    const dislikeRx = new RegExp(DISLIKE_RX.source, 'g');
    while ((lm = dislikeRx.exec(t)) !== null) {
      const thing = prefObject(lm[1]);
      if (!thing) continue;
      profile.dislikes ??= [];
      addPref(profile.dislikes, thing);
      if (profile.likes) profile.likes = profile.likes.filter(d => d !== thing);
    }
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

  // v23: tastes union in, and each side of the overlay evicts its opposite —
  // saying "i love coffee" today removes coffee from yesterday's dislikes.
  if (overlay.likes?.length) {
    const merged = [...(out.likes ?? [])];
    for (const l of overlay.likes) addPref(merged, l);
    out.likes = merged;
    if (out.dislikes) out.dislikes = out.dislikes.filter(d => !overlay.likes!.includes(d));
  }
  if (overlay.dislikes?.length) {
    const merged = [...(out.dislikes ?? [])];
    for (const d of overlay.dislikes) addPref(merged, d);
    out.dislikes = merged;
    if (out.likes) out.likes = out.likes.filter(l => !overlay.dislikes!.includes(l));
  }
  if (overlay.wins?.length) {
    const seen = new Set((base.wins ?? []).map(w => w.toLowerCase()));
    const merged = [...(base.wins ?? [])];
    for (const w of overlay.wins) if (!seen.has(w.toLowerCase())) merged.push(w);
    out.wins = merged.slice(-MAX_WINS);
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

const MAX_MOODS = 30;

/**
 * v26: roll a detected mood into the journal. One entry per day — a later
 * signal the same day replaces the earlier one (how you end the day is the
 * truer reading). Returns the new list; the caller stores it on the profile.
 */
export function pushMood(
  moods: MoodEntry[] | undefined,
  mood: string,
  today = todayInTZ('Africa/Johannesburg'),
): MoodEntry[] {
  const date = `${today.y}-${String(today.m).padStart(2, '0')}-${String(today.d).padStart(2, '0')}`;
  const list = (moods ?? []).filter(e => e.date !== date);
  list.push({ mood, date });
  return list.slice(-MAX_MOODS);
}

// The human reading of each canonical mood label, for trend answers.
const MOOD_WORDS: Record<string, string> = {
  low: 'low', stressed: 'stressed', tired: 'tired', angry: 'frustrated', good: 'good',
};

/**
 * v26: an honest readout of the last two weeks of mood entries, or null when
 * there isn't enough signal to say anything real.
 */
export function moodTrend(
  profile: Profile,
  today = todayInTZ('Africa/Johannesburg'),
): string | null {
  const moods = profile.moods ?? [];
  if (!moods.length) return null;
  const todayMs = Date.UTC(today.y, today.m - 1, today.d);
  const recent = moods.filter(e => {
    const ms = Date.parse(e.date);
    return Number.isFinite(ms) && todayMs - ms <= 14 * 86400000;
  });
  if (!recent.length) return null;

  const counts: Record<string, number> = {};
  for (const e of recent) counts[e.mood] = (counts[e.mood] ?? 0) + 1;
  const heavy = (counts.low ?? 0) + (counts.stressed ?? 0);
  const light = counts.good ?? 0;
  const latest = recent[recent.length - 1];
  const latestWord = MOOD_WORDS[latest.mood] ?? latest.mood;

  const days = recent.length;
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${MOOD_WORDS[m] ?? m} on ${n} day${n === 1 ? '' : 's'}`);
  const summary = `Over the last two weeks I've picked up how you were doing on ${days} day${days === 1 ? '' : 's'}: ${parts.join(', ')}.`;

  let read: string;
  if (heavy > light && heavy >= 2) {
    read = `That's a heavier stretch than you deserve — and the most recent read was ${latestWord}. You don't have to carry it alone; tell me what's weighing the most.`;
  } else if (light > heavy && light >= 2) {
    read = `That's a good run — and lately you sounded ${latestWord}. Whatever you're doing, it's working. Keep me posted.`;
  } else {
    read = `Mixed, like real life. The latest read was ${latestWord}. How are you right now?`;
  }
  return `${summary} ${read}`;
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
  // v23: "forget that i like coffee" / "forget that i hate mondays" — tastes
  // are forgettable the same way facts are.
  const tasteM = target.match(/^(?:that\s+)?i\s+(?:like|love|enjoy|hate|dislike|can'?t stand|don'?t like)\s+(.{2,40})$/);
  if (tasteM) {
    const thing = tasteM[1].trim().replace(/^(?:the|a|an)\s+/, '');
    const inLikes = next.likes?.some(l => l === thing || l.includes(thing) || thing.includes(l));
    const inDislikes = next.dislikes?.some(d => d === thing || d.includes(thing) || thing.includes(d));
    if (inLikes) {
      next.likes = next.likes!.filter(l => !(l === thing || l.includes(thing) || thing.includes(l)));
      return { profile: next, reply: `Done — I've forgotten that you love ${thing}.` };
    }
    if (inDislikes) {
      next.dislikes = next.dislikes!.filter(d => !(d === thing || d.includes(thing) || thing.includes(d)));
      return { profile: next, reply: `Done — I've forgotten how you felt about ${thing}.` };
    }
  }
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
export function isCrisisReply(response: string): boolean {
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

  // v23: crisis language is never acknowledged as a memory item — those
  // messages belong to the crisis nodes, whole and untouched.
  if (CRISIS_RX.test(trimmed)) return null;

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

  // v18: confirm a stated goal. v23: only when the latest stored goal really
  // came from THIS message — "i want to give up" must never be answered with
  // an old goal's confirmation.
  if (/^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:my goal is|my dream is|i(?:'m| am) working on|i want to|i(?:'m| am) trying to|i(?:'m| am) building)\b/.test(t) && profile.goals?.length) {
    const goal = profile.goals[profile.goals.length - 1];
    if (t.includes(goal.toLowerCase())) {
      return `Locked in — you're working toward: ${goal}. I've got that, and I'll hold you to it. What's the next step?`;
    }
  }

  // v23: confirm a taste — "i love jazz" / "i can't stand traffic" as the
  // whole message gets a direct note instead of a retrieval guess.
  const likeM = t.match(new RegExp(`^(?:hey\\s+navi[,:\\s]+|navi[,:\\s]+)?${LIKE_RX.source}[.!?]*$`));
  if (likeM) {
    const thing = prefObject(likeM[1]);
    if (thing && profile.likes?.includes(thing)) {
      return `Noted — you love ${thing}. That's part of your picture now.`;
    }
  }
  const dislikeM = t.match(new RegExp(`^(?:hey\\s+navi[,:\\s]+|navi[,:\\s]+)?${DISLIKE_RX.source}[.!?]*$`));
  if (dislikeM) {
    const thing = prefObject(dislikeM[1]);
    if (thing && profile.dislikes?.includes(thing)) {
      return `Noted — ${thing} is not your thing. I'll remember that.`;
    }
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

// ── v23: whole-turn understanding ─────────────────────────────────────────────

/** Human phrases for everything `after` knows that `before` didn't. */
export function newProfileBits(before: Profile, after: Profile): string[] {
  const bits: string[] = [];
  if (after.name && after.name !== before.name) bits.push(`your name is ${after.name}`);
  if (after.age !== undefined && after.age !== before.age) bits.push(`you're ${after.age}`);
  if (after.place && after.place !== before.place) bits.push(`you're from ${after.place}`);
  if (after.work && after.work !== before.work) bits.push(`you work as ${after.work}`);
  if (after.birthday && (before.birthday?.month !== after.birthday.month || before.birthday?.day !== after.birthday.day)) {
    bits.push(`your birthday is ${birthdayLabel(after.birthday)}`);
  }
  for (const [k, v] of Object.entries(after.favorites ?? {})) {
    if (before.favorites?.[k] !== v) bits.push(`your favourite ${k} is ${v}`);
  }
  for (const [k, v] of Object.entries(after.people ?? {})) {
    if (before.people?.[k] !== v) bits.push(`your ${k} is ${v}`);
  }
  const had = (xs?: string[]) => new Set((xs ?? []).map(x => x.toLowerCase()));
  const goalsHad = had(before.goals);
  for (const g of after.goals ?? []) if (!goalsHad.has(g.toLowerCase())) bits.push(`you're working toward ${g}`);
  const likesHad = had(before.likes);
  for (const l of after.likes ?? []) if (!likesHad.has(l.toLowerCase())) bits.push(`you love ${l}`);
  const dislikesHad = had(before.dislikes);
  for (const d of after.dislikes ?? []) if (!dislikesHad.has(d.toLowerCase())) bits.push(`you're not a fan of ${d}`);
  const factsHad = had(before.facts);
  for (const f of after.facts ?? []) if (!factsHad.has(f.toLowerCase())) bits.push(toSecondPerson(f));
  return bits;
}

/**
 * v23: when ONE message carries several new facts ("I'm Dian, I'm 24 and I'm
 * from Pretoria"), confirm all of them together — proof NAVI understood the
 * whole sentence, not just the first clause. Single-fact statements keep
 * their dedicated acknowledgements; questions and crisis messages never land
 * here. Returns null when fewer than two new things were captured.
 */
export function captureAck(message: string, before: Profile): string | null {
  const t = message.trim();
  if (!t || t.length > 400) return null;
  if (/\?\s*$/.test(t)) return null;
  if (CRISIS_RX.test(t)) return null;
  const after = mergeProfiles(before, extractProfile([], t));
  const bits = newProfileBits(before, after);
  if (bits.length < 2) return null;
  const list = bits.slice(0, 6).join('; ');
  return `All locked in: ${list}. I've kept every piece of that.`;
}

// ── v23: goal completion → wins ───────────────────────────────────────────────

const DONE_RX =
  /\bi\s+(?:finally\s+|just\s+)?(?:finished|completed|achieved|accomplished|launched|reached|pulled off|did)\s+(it|that|my goal|the goal|.{2,60}?)\s*(?:[.!?,;]|$)/;

const GOAL_STOP = new Set(['the', 'a', 'an', 'my', 'to', 'for', 'and', 'of', 'on', 'in', 'with']);

function goalWords(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !GOAL_STOP.has(w)));
}

/**
 * v23: "i finished my app!" / "i did it!" — when it matches a stored goal,
 * celebrate it, move the goal to the wins list, and persist. Returns null
 * when the message isn't a completion, or no stored goal matches.
 */
export function tryGoalDone(message: string, profile: Profile): { reply: string; profile: Profile } | null {
  const goals = profile.goals ?? [];
  if (!goals.length) return null;
  const t = message.toLowerCase().trim();
  if (/\?\s*$/.test(t)) return null;
  const m = t.match(DONE_RX);
  if (!m) return null;

  const said = m[1].trim();
  let idx = -1;
  if (/^(it|that|my goal|the goal)$/.test(said)) {
    idx = goals.length - 1; // "i did it" → the most recent goal
  } else {
    const saidWords = goalWords(said);
    let best = 0;
    goals.forEach((g, i) => {
      const gw = goalWords(g);
      let overlap = 0;
      for (const w of saidWords) if (gw.has(w)) overlap++;
      const score = overlap / Math.max(1, Math.min(saidWords.size, gw.size));
      if (overlap > 0 && score >= 0.5 && score > best) { best = score; idx = i; }
    });
  }
  if (idx < 0) return null;

  const goal = goals[idx];
  const next: Profile = { ...profile, goals: goals.filter((_, i) => i !== idx) };
  next.wins = [...(profile.wins ?? [])];
  if (!next.wins.some(w => w.toLowerCase() === goal.toLowerCase())) next.wins.push(goal);
  if (next.wins.length > MAX_WINS) next.wins.shift();

  return {
    reply: `THAT'S A WIN. You told me you were working toward ${goal} — and you actually did it. I'm moving it to your wins list, because this deserves to be remembered. What's the next mountain?`,
    profile: next,
  };
}

/** Answer profile questions ("what's my name", "what do you know about me") from the profile. */
export function answerProfileQuestion(message: string, profile: Profile): string | null {
  const t = message.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (/\b(what s|whats|what is|say|remember) my name\b/.test(t) || /\bdo you (know|remember) (my name|who i am)\b/.test(t)) {
    return profile.name
      ? `You're ${profile.name}. I don't forget the people I talk to.`
      : "You haven't told me your name yet. What should I call you?";
  }

  // v23: "who am i?" — answered from the whole picture, not just the name.
  if (/^(?:hey navi |navi )?who am i(?: to you| again)?$/.test(t)) {
    if (!profile.name) return "You haven't told me your name yet — but I'm listening. Who are you?";
    const extras: string[] = [];
    if (profile.work) extras.push(`a ${profile.work}`);
    if (profile.place) extras.push(`from ${profile.place}`);
    const tail = extras.length ? ` — ${extras.join(', ')}` : '';
    return `You're ${profile.name}${tail}. And you're someone I keep a real picture of, not just a chat window.`;
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

  // v23: tastes recall — "what do i like?", "what do i hate?", "do i like X?".
  const tasteAsk = t.match(/^(?:hey navi |navi )?do i (?:like|love|enjoy|hate|dislike) (.{2,30}?)(?: again)?$/);
  if (tasteAsk) {
    const asked = tasteAsk[1].trim().replace(/^(?:the|a|an)\s+/, '');
    const inLikes = (profile.likes ?? []).find(l => l === asked || l.includes(asked) || asked.includes(l));
    const inDislikes = (profile.dislikes ?? []).find(d => d === asked || d.includes(asked) || asked.includes(d));
    if (inLikes) return `Yes — you told me you love ${inLikes}. I keep track of what lights you up.`;
    if (inDislikes) return `The opposite — you told me you can't stand ${inDislikes}.`;
    return `You haven't told me how you feel about ${asked} yet. Love it or leave it?`;
  }
  if (/\bwhat (?:do|things do) i (?:like|love|enjoy)\b/.test(t) || /\bwhat are my likes\b/.test(t)) {
    const likes = profile.likes ?? [];
    if (!likes.length) return "You haven't told me what you love yet. Give me a few — I'll keep them.";
    const list = likes.length === 1 ? likes[0] : `${likes.slice(0, -1).join(', ')} and ${likes[likes.length - 1]}`;
    return `From what you've told me, you love ${list}. I keep track of what lights you up.`;
  }
  if (/\bwhat (?:do|things do) i (?:hate|dislike)\b/.test(t) || /\bwhat can t i stand\b/.test(t) || /\bwhat don t i like\b/.test(t)) {
    const dislikes = profile.dislikes ?? [];
    if (!dislikes.length) return "You haven't told me anything you can't stand yet. What gets under your skin?";
    const list = dislikes.length === 1 ? dislikes[0] : `${dislikes.slice(0, -1).join(', ')} and ${dislikes[dislikes.length - 1]}`;
    return `You've told me you can't stand ${list}. Noted and remembered.`;
  }

  // v23: wins recall — "what have i achieved?", "what are my wins?".
  if (/\bwhat (?:are my wins|have i (?:achieved|accomplished|finished|completed))\b/.test(t) || /\bmy (?:wins|achievements)\b/.test(t)) {
    const wins = profile.wins ?? [];
    if (!wins.length) return "No wins on the board yet — but the board is waiting. Tell me a goal, then go beat it.";
    const list = wins.length === 1 ? wins[0] : `${wins.slice(0, -1).join('; ')}; and ${wins[wins.length - 1]}`;
    return `Look at this list: ${list}. You DID those. Every one is proof you finish what you start.`;
  }

  // v26: mood trend — "how have i been feeling lately?" answered from the
  // mood journal, honestly, or handed back as a real question when there's
  // no data yet.
  if (/\bhow (?:have i been|was i) feeling\b/.test(t) || /\bmy mood (?:lately|this week|history|trend)\b/.test(t) || /\bhow (?:has|was) my (?:week|mood) been\b/.test(t)) {
    return moodTrend(profile) ??
      "I haven't picked up enough about how you've been feeling to give you an honest read yet. So tell me straight — how are you right now?";
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
    if (profile.likes?.length) bits.push(`you love ${profile.likes.join(', ')}`);
    if (profile.dislikes?.length) bits.push(`you can't stand ${profile.dislikes.join(', ')}`);
    if (profile.wins?.length) bits.push(`you've already won at ${profile.wins.join('; ')}`);
    if (profile.mission) bits.push(`you're on a mission to ${profile.mission.goal} (step ${profile.mission.done + 1} of ${profile.mission.steps.length})`);
    for (const h of profile.habits ?? []) bits.push(`you're building the habit of ${h.name}${h.streak > 1 ? ` (${h.streak}-day streak)` : ''}`);
    if (profile.workflows?.length) bits.push(`you've saved ${profile.workflows.length} workflow${profile.workflows.length === 1 ? '' : 's'} with me (${profile.workflows.map(w => w.name).join(', ')})`);
    for (const f of profile.facts ?? []) bits.push(toSecondPerson(f));
    if (!bits.length) {
      return "Not much yet — this conversation is still young. Tell me your name, or say \"remember that…\" and I'll hold onto whatever matters.";
    }
    const list = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join('; ')}; and ${bits[bits.length - 1]}`;
    return `Here's what I know so far: ${list}. Tell me more and I'll keep building the picture.`;
  }

  return null;
}
