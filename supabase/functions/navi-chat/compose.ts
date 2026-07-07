// supabase/functions/navi-chat/compose.ts
//
// NAVI v21 — Creative Composer.
//
// "Write me a prayer about strength." "Write a caption for my new song."
// "Write an apology to my brother." NAVI now COMPOSES — prayers, affirmations,
// captions, poems, motivational messages, apologies, thank-yous, morning and
// birthday messages — from curated template banks with the topic and recipient
// woven in, personalised with the user's stored name when NAVI knows it.
//
// Deterministic (variant picked by a stable seed), zero-I/O, faith-true where
// it matters (prayers close on Amen), and returns '' when the message isn't a
// composition ask so the normal pipeline runs.

export type ComposeProfile = { name?: string };

type Kind =
  | 'prayer' | 'affirmation' | 'caption' | 'poem' | 'motivation'
  | 'apology' | 'thanks' | 'goodmorning' | 'birthday';

const KIND_RX: Array<[RegExp, Kind]> = [
  [/\bprayer\b/, 'prayer'],
  [/\baffirmations?\b/, 'affirmation'],
  [/\bcaptions?\b/, 'caption'],
  [/\bpoem\b|\bpiece of poetry\b/, 'poem'],
  [/\bmotivational (?:message|quote|word)\b|\bmotivation\b|\bencouragement\b|\bencouraging (?:message|word)\b|\bpep talk\b/, 'motivation'],
  [/\bapology\b|\bapology (?:message|note|text)\b/, 'apology'],
  [/\bthank[- ]?you (?:message|note|text|letter)\b/, 'thanks'],
  [/\bgood ?morning (?:message|text)\b/, 'goodmorning'],
  [/\bbirthday (?:message|wish|text)\b/, 'birthday'],
];

// The ask has to be an explicit composition command, not a mention in passing.
const COMPOSE_CMD =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+|will you\s+)?(?:write|compose|make|create|give)\s+(?:me\s+|us\s+)?(?:a\s+|an\s+|some\s+)?(?:short\s+|quick\s+|little\s+|powerful\s+)?/i;

export interface ComposeAsk {
  kind: Kind;
  topic: string;      // "strength", "my new song" — '' when none given
  recipient: string;  // "my brother", "Thandi" — '' when none given
}

/** Parse a composition ask out of the message, or null when it isn't one. */
export function parseCompose(message: string): ComposeAsk | null {
  const m = message.trim();
  if (!COMPOSE_CMD.test(m)) return null;
  const rest = m.replace(COMPOSE_CMD, '').toLowerCase().replace(/[.!?]+\s*$/, '').trim();
  if (!rest || rest.length > 140) return null;

  let kind: Kind | null = null;
  for (const [rx, k] of KIND_RX) {
    if (rx.test(rest)) { kind = k; break; }
  }
  if (!kind) return null;

  // Topic: "about X" / "on X"; recipient: "for X" / "to X".
  const topic = rest.match(/\babout\s+(.+?)(?:\s+(?:for|to)\s+.+)?$/)?.[1]
    ?? rest.match(/\bon\s+(.+?)(?:\s+(?:for|to)\s+.+)?$/)?.[1]
    ?? '';
  const recipient = rest.match(/\b(?:for|to)\s+(.+?)(?:\s+about\s+.+)?$/)?.[1] ?? '';

  // Articles are kept — "the gym" / "a broken heart" read naturally inside
  // the templates; stripping them produces broken English.
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const t = clean(topic);
  const r = clean(recipient);
  if (t.split(/\s+/).length > 6 || r.split(/\s+/).length > 5) return null;
  return { kind, topic: t, recipient: r };
}

// ── Template banks ────────────────────────────────────────────────────────────
// {topic} — the subject; {recipient} — who it's for; both pre-defaulted before
// filling so templates never render an empty hole.

const PRAYERS = [
  `Father, thank You for this moment. I bring {topic} before You now — You see every part of it, even the parts I can't put into words. Give me strength where I am weak, clarity where I am confused, and peace that doesn't depend on how things look. I trust You with the outcome. In Jesus' name, Amen.`,
  `Lord, I come to You about {topic}. You are bigger than this, and You were here before I ever knew I'd need to pray about it. Order my steps, guard my heart, and let Your will be done — not my fear. Thank You that You hear me. Amen.`,
  `Heavenly Father, I lift up {topic} to You. Where there is worry, plant peace. Where there is a closed door, either open it or turn my feet. I choose to trust You with this today — fully, not halfway. Amen.`,
];

const AFFIRMATIONS = [
  `I am built for this season. {Topic} does not intimidate me — it is shaping me. I move with focus, I finish what I start, and I do not shrink to fit anyone's doubt. Today I take one real step forward, and that is enough.`,
  `I am not behind — I am becoming. {Topic} is in my hands and I handle it with patience and fire in the same breath. I speak life over my day: I am capable, I am chosen, I am consistent.`,
  `My mind is clear and my direction is set. {Topic} bends to discipline, and discipline is what I bring daily. I don't chase — I build. I don't doubt — I do.`,
];

const CAPTIONS = [
  `Built in silence. Revealed on time. {Topic} — this one's from the heart.`,
  `Every level required a version of me that didn't exist yet. {Topic}. More coming.`,
  `Grace over grind — but I brought both. {Topic} is here.`,
];

const POEMS = [
  `They said wait, but the fire said now,\nso I carried {topic} like a vow.\nThrough the doubt, through the late-night ache,\nI kept a promise I refused to break.\nWhat was heavy became my proof —\nevery scar on me is truth.`,
  `{Topic} sat quiet in my chest,\na seed that never needed rest.\nI watered it with early days,\nwith stubborn faith and unseen praise.\nNow watch it break the ground and rise —\nwhat grows in secret fills the skies.`,
  `Morning found me building still,\n{topic} bending to my will.\nNot by force, but by return —\nshow up, fall down, stand up, learn.\nThe road is long, my step is sure;\nwhat's built on purpose will endure.`,
];

const MOTIVATIONS = [
  `Listen — {topic} is not too big for you. It feels heavy because it matters. You don't need to see the whole staircase today; you need to take the next step like it's the only one that exists. Start now, start small, but start. Future you is already grateful.`,
  `You've survived every hard day you've ever had — that's a 100% record. {Topic} is just the next opponent, and you don't fight it all at once. One focused hour today. Then another tomorrow. Momentum is built, not found.`,
  `Nobody is coming to do {topic} for you — and honestly, that's the good news, because it means it's fully in your hands. Cut the noise, pick the one thing that moves it forward, and do that before the day ends.`,
];

const APOLOGIES = [
  `Hey {recipient} — I've been thinking about what happened, and I owe you a real apology, not an excuse. I was wrong, and I'm sorry. You matter to me more than my pride does. When you're ready, I'd like to make it right.`,
  `{Recipient}, I'm sorry. Not the quick kind — the kind where I've actually sat with what I did and how it landed on you. You didn't deserve that. I want to do better, and I will.`,
  `I keep replaying it, {recipient}, and every version ends the same way: I should have handled that differently. I'm sorry for hurting you. No pressure to reply — I just needed you to know I see it, and I own it.`,
];

const THANKS = [
  `{Recipient}, thank you — for real. Not just for what you did, but for how you showed up when you didn't have to. People like you make the load lighter and the road shorter. I don't take it for granted.`,
  `I just want you to know, {recipient}: what you did meant more than you probably realise. Thank you for your time, your heart, and the way you came through. I owe you one — and I pay my debts.`,
  `{Recipient} — thank you. You showed up, you came through, and you did it without being asked twice. That's rare. I see it, and I appreciate you deeply.`,
];

const GOODMORNINGS = [
  `Good morning, {recipient}. New day, clean page, fresh mercy. Whatever yesterday was — it's done. Today has your name on it. Go get it.`,
  `Morning, {recipient}! May your coffee be strong, your focus be stronger, and your day bend in your favour. Big things move today.`,
  `Rise up, {recipient} — the day is already waiting on you. Walk into it with peace in your chest and fire in your step.`,
];

const BIRTHDAYS = [
  `Happy birthday, {recipient}! Another year of you — and the world is better for it. May this year bring you rooms you prayed for, people who pour back into you, and joy that doesn't need a reason. Celebrate properly today.`,
  `{Recipient} — happy birthday! I hope today feels as good as you've made other people feel just by being you. New age, new grace, new levels. Enjoy every minute.`,
  `It's your day, {recipient}. Happy birthday! May the year ahead out-do every year behind you — in health, in favour, in wins you can't even predict yet.`,
];

const BANKS: Record<Kind, string[]> = {
  prayer: PRAYERS,
  affirmation: AFFIRMATIONS,
  caption: CAPTIONS,
  poem: POEMS,
  motivation: MOTIVATIONS,
  apology: APOLOGIES,
  thanks: THANKS,
  goodmorning: GOODMORNINGS,
  birthday: BIRTHDAYS,
};

// Defaults when the ask doesn't name a topic/recipient.
const DEFAULT_TOPIC: Record<Kind, string> = {
  prayer: 'this day and everything it holds',
  affirmation: 'what I am building',
  caption: 'New chapter',
  poem: 'the dream',
  motivation: 'what you are building',
  apology: '', thanks: '', goodmorning: '', birthday: '',
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fill(template: string, topic: string, recipient: string): string {
  return template
    .replace(/\{Topic\}/g, cap(topic))
    .replace(/\{topic\}/g, topic)
    .replace(/\{Recipient\}/g, cap(recipient))
    .replace(/\{recipient\}/g, recipient);
}

/**
 * Compose the requested piece, or '' when the message isn't a composition ask.
 * The variant is picked by a stable seed so re-asking with different wording
 * naturally rotates the bank.
 */
export function tryCompose(message: string, profile: ComposeProfile = {}): string {
  const ask = parseCompose(message);
  if (!ask) return '';

  const bank = BANKS[ask.kind];
  const seed = message.trim().length;
  const template = bank[seed % bank.length];

  // Captions are usually asked "for my new song" rather than "about X" — the
  // recipient slot is really the subject there.
  const topic = ask.topic
    || (ask.kind === 'caption' && ask.recipient ? ask.recipient : '')
    || DEFAULT_TOPIC[ask.kind];
  const recipient = ask.recipient || profile.name || 'you';
  const piece = fill(template, topic, recipient);

  const openers: Record<Kind, string> = {
    prayer: `Here's a prayer for you:\n\n`,
    affirmation: `Say this out loud — slowly:\n\n`,
    caption: `Here's your caption:\n\n`,
    poem: `Here's your poem:\n\n`,
    motivation: ``,
    apology: `Here's a way to say it:\n\n`,
    thanks: `Here's a way to say it:\n\n`,
    goodmorning: `Here you go:\n\n`,
    birthday: `Here you go:\n\n`,
  };
  return `${openers[ask.kind]}${piece}`;
}
