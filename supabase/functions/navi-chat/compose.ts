// supabase/functions/navi-chat/compose.ts
//
// NAVI v21 — Creative Composer. Upgraded in v40 (the muse round) and v48
// (the anthology round).
//
// "Write me a prayer about strength." "Write a caption for my new song."
// "Write an apology to my brother." NAVI COMPOSES — prayers, affirmations,
// captions, poems, motivational messages, apologies, thank-yous, morning and
// birthday messages — from curated template banks with the topic and recipient
// woven in, personalised with the user's stored name when NAVI knows it.
//
// v40 additions:
//   - The /write slash command: "/write <prompt>" turns any writing prompt
//     into a piece. The prompt is free text (an "and"/"then" inside it is
//     prompt, never a second ask — index.ts keeps it out of splitIntents via
//     isWriteSlashAsk, the v34 /email rule). A bare "/write" is TAUGHT the
//     usage, never dropped into conversation; crisis prompts step aside so
//     the crisis nodes own them.
//   - New kinds: story (generatively assembled from opening/middle/closing
//     banks — 64 combinations), song lyrics, letters, speeches, and quotes.
//   - A char-code seed (not message length) so different topics rotate the
//     banks properly. Still fully deterministic: same ask, same piece.
//
// v48 additions:
//   - Songs are now ASSEMBLED like v40's stories: verse-1 / chorus / verse-2 /
//     bridge banks (4 × 4 × 4 × 4 = 256 songs), the chorus reprised at the
//     end so the sheet reads complete. First-person throughout; the topic
//     lives in verse 1 and the chorus so any assembly reads as one song.
//   - New kinds: congrats (congratulations messages), comfort (sympathy /
//     condolence notes), and rap (verses with the topic woven in). "rap song"
//     is a rap, not a song — its entry sits before the song entry.
//   - Multi-piece asks: "write me 3 captions about the gym" / "/write 4
//     quotes about discipline" — the SHORT kinds (caption, quote,
//     affirmation) come back numbered and distinct, clamped honestly to the
//     bank; the long forms still come one at a time and say so.
//   - Letters sign with the user's stored name (the {sender} slot) instead
//     of a bare "me".
//   - The conversational path now carries the same CRISIS_RX step-aside the
//     /write path shipped with (invariant #1 — the v44 remind.ts lesson:
//     every parser that executes user language guards itself).
//
// Deterministic, zero-I/O, faith-true where it matters (prayers close on
// Amen), and returns '' when the message isn't a composition ask so the
// normal pipeline runs.

export type ComposeProfile = { name?: string };

type Kind =
  | 'prayer' | 'affirmation' | 'caption' | 'poem' | 'motivation'
  | 'apology' | 'thanks' | 'goodmorning' | 'birthday'
  | 'story' | 'song' | 'letter' | 'speech' | 'quote'
  | 'congrats' | 'comfort' | 'rap';

// Crisis phrasing is never a writing prompt (invariant #1) — the parser steps
// aside so the pipeline's crisis nodes answer with real support.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

// Order matters: the compound kinds (thank-you letter, apology note,
// motivational quote, birthday message) must win before the bare new kinds
// (letter, quote, song) — earlier entries are checked first. "rap" sits
// before "song" so a "rap song" is a rap.
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
  [/\bcongrats?\b|\bcongratulations?\b/, 'congrats'],
  [/\bcondolences?\b|\bsympathy (?:message|note|text|card)\b|\bcomfort(?:ing)? (?:message|note|text|words?)\b/, 'comfort'],
  [/\b(?:short |bedtime )?stor(?:y|ies)\b|\btale\b/, 'story'],
  [/\brap\b/, 'rap'],
  [/\bsong\b|\blyrics\b|\bchorus\b/, 'song'],
  [/\bletter\b/, 'letter'],
  [/\bspeech\b|\btoast\b/, 'speech'],
  [/\bquotes?\b|\bproverb\b|\bsaying\b/, 'quote'],
];

// The ask has to be an explicit composition command, not a mention in passing.
const COMPOSE_CMD =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:please\s+|can you\s+|could you\s+|will you\s+)?(?:write|compose|make|create|give)\s+(?:me\s+|us\s+)?(?:a\s+|an\s+|some\s+)?(?:short\s+|quick\s+|little\s+|powerful\s+)?/i;

// v49: tones — a closed vocabulary of two, carried only where per-tone banks
// exist (the short kinds). Everything else answers honestly with its regular
// voice rather than faking a register it doesn't have.
export type Tone = 'funny' | 'formal';

const TONE_WORDS: Record<string, Tone> = {
  funny: 'funny', humorous: 'funny', witty: 'funny', playful: 'funny',
  formal: 'formal', professional: 'formal', polished: 'formal', serious: 'formal',
};

function takeTone(rest: string): { tone?: Tone; rest: string } {
  const m = rest.match(/^(\w+)\s+(.+)$/);
  const tone = m ? TONE_WORDS[m[1]] : undefined;
  return tone ? { tone, rest: m![2] } : { rest };
}

export interface ComposeAsk {
  kind: Kind;
  topic: string;      // "strength", "my new song" — '' when none given
  recipient: string;  // "my brother", "Thandi" — '' when none given
  count?: number;     // v48: "3 captions" — ≥2 when a count was asked
  tone?: Tone;        // v49: "funny caption", "formal quote"
}

// Topic: "about X" / "on X"; recipient: "for X" / "to X". Articles are kept —
// "the gym" / "a broken heart" read naturally inside the templates.
function extractSlots(rest: string): { topic: string; recipient: string } {
  const topic = rest.match(/\babout\s+(.+?)(?:\s+(?:for|to)\s+.+)?$/)?.[1]
    ?? rest.match(/\bon\s+(.+?)(?:\s+(?:for|to)\s+.+)?$/)?.[1]
    ?? '';
  const recipient = rest.match(/\b(?:for|to)\s+(.+?)(?:\s+about\s+.+)?$/)?.[1] ?? '';
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  return { topic: clean(topic), recipient: clean(recipient) };
}

// v48: a leading count on the kind — "3 captions", "four quotes". Closed
// vocabulary, ≥2 to count (a "1" is stripped but stays a single piece).
const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };

function takeCount(rest: string): { count?: number; rest: string } {
  const m = rest.match(/^(\d{1,2}|two|three|four|five|six)\s+(.+)$/);
  if (!m) return { rest };
  const n = COUNT_WORDS[m[1]] ?? parseInt(m[1], 10);
  return { count: n >= 2 ? n : undefined, rest: m[2] };
}

/** Parse a composition ask out of the message, or null when it isn't one. */
export function parseCompose(message: string): ComposeAsk | null {
  const m = message.trim();
  if (!COMPOSE_CMD.test(m)) return null;
  // v48: the conversational path steps aside on crisis phrasing exactly like
  // the /write path — crisis language is never a topic to write around.
  if (CRISIS_RX.test(m)) return null;
  const rest = m.replace(COMPOSE_CMD, '').toLowerCase().replace(/[.!?]+\s*$/, '').trim();
  if (!rest || rest.length > 140) return null;

  const { count, rest: afterCount } = takeCount(rest);
  const { tone, rest: body } = takeTone(afterCount);
  let kind: Kind | null = null;
  for (const [rx, k] of KIND_RX) {
    if (rx.test(body)) { kind = k; break; }
  }
  if (!kind) return null;
  // "give me a quote from the bible" is a scripture ask, not a coined quote —
  // the Bible pipeline and nodes own it.
  if (kind === 'quote' && /\b(bible|scripture|verse|psalm|proverbs)\b/.test(body)) return null;

  const { topic: t, recipient: r } = extractSlots(body);
  if (t.split(/\s+/).length > 6 || r.split(/\s+/).length > 5) return null;
  return { kind, topic: t, recipient: r, ...(count ? { count } : {}), ...(tone ? { tone } : {}) };
}

// ── v40: the /write slash command ─────────────────────────────────────────────
// "/write <prompt>" (a "/write/<prompt>" slash separator also works). The
// prompt is free text: a named kind is honoured ("/write a poem about hope"),
// no kind means a story ("/write about the ocean at night" — the classic
// writing-prompt answer), and "to <someone>" with no kind means a letter.

const WRITE_SLASH_RX = /^\/\s*write\b/i;

/**
 * True when the message opens with the /write command. Such a message is ONE
 * prompt — index.ts uses this to keep it out of the multi-intent split (an
 * "and"/"then" inside a writing prompt is prompt, not a second ask).
 */
export function isWriteSlashAsk(message: string): boolean {
  return WRITE_SLASH_RX.test(message.trim());
}

export const WRITE_USAGE =
  `To use /write, give me a prompt after the command — like:\n` +
  `• /write a poem about hope\n` +
  `• /write a story about a lion who lost his roar\n` +
  `• /write a rap about the grind\n` +
  `• /write 3 captions about the gym\n` +
  `• /write a letter to my future self\n` +
  `I can write stories, poems, songs, raps, prayers, letters, speeches, quotes, affirmations, captions, congratulations, condolences, apologies, thank-yous, and motivational pieces — and for captions, quotes, and affirmations you can ask for up to six at once, or add funny or formal (like /write a formal quote about discipline).`;

// Asking ABOUT the command must teach it, deterministically — the fuzzy node
// layer loses these asks to older writing/creativity nodes, so the anchored
// intercept here (tryCompose runs before the nodes) owns them. Note that
// "/write help" must be caught BEFORE parseWriteSlash, or "help" becomes a
// story topic.
const WRITE_HELP_RX =
  /^(?:what(?:'s| is) (?:the )?\/write(?: command)?|how (?:do i|to) use \/write|\/write help|help (?:me )?with \/write)$/;

function isWriteHelpAsk(message: string): boolean {
  const t = message.toLowerCase().replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim();
  return WRITE_HELP_RX.test(t);
}

const MAX_PROMPT = 300;

/**
 * Parse a /write ask. 'malformed' means the command was used without a usable
 * prompt (taught, never dropped); 'crisis' means the prompt carries crisis
 * language (the caller steps aside so the crisis nodes answer); null means
 * the message isn't a /write ask at all.
 */
export function parseWriteSlash(message: string): ComposeAsk | 'malformed' | 'crisis' | null {
  const raw = message.trim();
  if (!WRITE_SLASH_RX.test(raw)) return null;
  const prompt = raw
    .replace(WRITE_SLASH_RX, '')
    .replace(/^[\/:,\s]+/, '')
    .replace(/[.!?\s]+$/, '')
    .trim();
  if (!prompt || prompt.length > MAX_PROMPT) return 'malformed';
  if (CRISIS_RX.test(prompt)) return 'crisis';

  const rest = prompt
    .toLowerCase()
    .replace(/^(?:me\s+|us\s+)?(?:a\s+|an\s+|some\s+)?(?:short\s+|quick\s+|little\s+|powerful\s+)?/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rest) return 'malformed';

  const { count, rest: afterCount } = takeCount(rest);
  const { tone, rest: body } = takeTone(afterCount);
  let kind: Kind | null = null;
  for (const [rx, k] of KIND_RX) {
    if (rx.test(body)) { kind = k; break; }
  }
  let { topic, recipient } = extractSlots(body);

  if (!kind) {
    // No kind named: "to <someone>" reads as a letter; anything else is a
    // story prompt and the whole prompt is its topic (a leading number stays
    // part of the topic — "/write 3 dragons" is a story about 3 dragons;
    // a tone word with no kind is topic too — "/write funny things" is a
    // story about funny things).
    if (!topic && recipient) {
      kind = 'letter';
    } else {
      kind = 'story';
      if (!topic) { topic = rest; recipient = ''; }
      return { kind, topic: clip(topic), recipient: '' };
    }
  }
  if (recipient.split(/\s+/).length > 5) recipient = '';
  return { kind, topic: clip(topic), recipient, ...(count ? { count } : {}), ...(tone ? { tone } : {}) };
}

function clip(topic: string): string {
  return topic.length > 80 ? topic.slice(0, 80).replace(/\s+\S*$/, '') : topic;
}

// ── Template banks ────────────────────────────────────────────────────────────
// {topic} — the subject; {recipient} — who it's for; {sender} — who it's from;
// all pre-defaulted before filling so templates never render an empty hole.

const PRAYERS = [
  `Father, thank You for this moment. I bring {topic} before You now — You see every part of it, even the parts I can't put into words. Give me strength where I am weak, clarity where I am confused, and peace that doesn't depend on how things look. I trust You with the outcome. In Jesus' name, Amen.`,
  `Lord, I come to You about {topic}. You are bigger than this, and You were here before I ever knew I'd need to pray about it. Order my steps, guard my heart, and let Your will be done — not my fear. Thank You that You hear me. Amen.`,
  `Heavenly Father, I lift up {topic} to You. Where there is worry, plant peace. Where there is a closed door, either open it or turn my feet. I choose to trust You with this today — fully, not halfway. Amen.`,
];

const AFFIRMATIONS = [
  `I am built for this season. {Topic} does not intimidate me — it is shaping me. I move with focus, I finish what I start, and I do not shrink to fit anyone's doubt. Today I take one real step forward, and that is enough.`,
  `I am not behind — I am becoming. {Topic} is in my hands and I handle it with patience and fire in the same breath. I speak life over my day: I am capable, I am chosen, I am consistent.`,
  `My mind is clear and my direction is set. {Topic} bends to discipline, and discipline is what I bring daily. I don't chase — I build. I don't doubt — I do.`,
  `I release what I cannot control and grip what I can. {Topic} gets my best hours, not my leftovers. I am patient with the process and ruthless with my excuses.`,
  `I was not made to blend in. {Topic} is my assignment, and assignments come with provision. I walk in focus, I speak with grace, and I finish strong.`,
  `Today I choose momentum over mood. {Topic} moves because I move. Small steps, taken daily, are how mountains change their address.`,
];

const CAPTIONS = [
  `Built in silence. Revealed on time. {Topic} — this one's from the heart.`,
  `Every level required a version of me that didn't exist yet. {Topic}. More coming.`,
  `Grace over grind — but I brought both. {Topic} is here.`,
  `Proof over promises. {Topic} — delivered.`,
  `They watched the glow-up and missed the grind. {Topic}, chapter one of many.`,
  `Started with a prayer and a plan. {Topic} is the receipt.`,
];

// v49: poems are ASSEMBLED like stories and songs — an opening stanza, a
// heart, and a closing picked independently by the seed (4 × 4 × 4 = 64
// poems). Stanzas rhyme AS WHOLES — each is a self-contained rhyming unit,
// first person, with {topic} woven in, so any combination reads as one poem.

const POEM_OPENINGS = [
  `They said wait, but the fire said now,\nso I carried {topic} like a vow.\nThrough the doubt, through the late-night ache,\nI kept a promise I refused to break.`,
  `{Topic} sat quiet in my chest,\na seed that never needed rest.\nI watered it with early days,\nwith stubborn faith and unseen praise.`,
  `Morning found me building still,\n{topic} bending to my will —\nnot by force, but by return:\nshow up, fall down, stand up, learn.`,
  `There is a door that bears my name,\nand {topic} is the key.\nIt never asked that I be fearless —\nonly that I turn it, quietly.`,
];

const POEM_HEARTS = [
  `Some plant in spring and boast in June;\nI planted in the dark.\n{Topic} was my winter seed,\nmy stubborn, buried spark.`,
  `The road taxed more than it explained —\nit took my sleep, my ease;\nbut every mile {topic} claimed\ngave something back to me.`,
  `I learned to count the quiet wins\nno passer-by could see:\neach small return to {topic}\nwas laying brick in me.`,
  `There were nights the flame burned low\nand doubt pulled up a chair;\nI gave {topic} one more hour\nand morning found me there.`,
];

const POEM_CLOSINGS = [
  `What was heavy became my proof —\nevery scar on me is truth.\n{Topic} paid me back in gold\nfor every seed the winter stole.`,
  `So let the harvest speak for me\nin rooms I prayed to see:\n{topic} built on purpose stands,\nand it was built by these two hands.`,
  `The road is long, my step is sure;\nwhat's built on purpose will endure.\nI walk with {topic} into light —\nthe dawn was worth the night.`,
  `And if they ask me how it's done,\nI'll say: begin, and don't outrun\nthe slow and sacred daily part —\n{topic} first, and then the heart.`,
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

// v48: the celebration and the condolence — both recipient-shaped.

const CONGRATS = [
  `{Recipient} — congratulations! You didn't stumble into this; you built it, brick by unseen brick. Enjoy every second of it, because moments like this are what the quiet work was for. Onwards and upwards!`,
  `Congratulations, {recipient}! Some wins shout and some wins glow — this one does both. May this be the first line of a chapter even better than the last. So proud of you.`,
  `It finally happened, {recipient} — congratulations! Talent opened the door, but consistency walked you through it. Celebrate properly today; tomorrow the next level is waiting.`,
];

const COMFORTS = [
  `{Recipient}, I'm so sorry. There are no perfect words for a season like this, so I'll offer true ones instead: you don't have to be strong on a schedule, and you don't have to carry this alone. I'm here — today, and on the ordinary days after, when it often hurts most.`,
  `Dear {recipient}, my heart is with you. Grief is love with nowhere to go, and the weight of it is proof of how much it mattered. Take it one hour at a time, and let people love you through this. Whatever you need — silence, stories, soup — I'm close.`,
  `{Recipient}, I'm holding you in my prayers. May God's peace sit with you in the quiet places words can't reach, and may every memory that stings today become one that softly shines. You are deeply loved — lean on that, and on us.`,
];

// v40: stories are ASSEMBLED, not templated — an opening, a middle, and a
// closing picked independently by the seed (4 × 4 × 4 = 64 stories). The
// parts never name the protagonist outside the opening, so any combination
// reads as one piece.

const STORY_OPENINGS = [
  `The first time Naledi met {topic}, it was nothing like the stories said. It was quieter. It waited at the edge of the ordinary, patient as a held breath.`,
  `There was a rule in Khaya's family, old as the house itself: never speak of {topic} after dark. So naturally, after dark was the only time anyone thought about it.`,
  `On the morning everything changed, Sipho found {topic} where it had no business being — right in the middle of a carefully planned life.`,
  `Nobody in town remembered who first brought {topic} here. But everyone would remember the day Lerato decided to find out.`,
];

const STORY_MIDDLES = [
  `Three days of following came next — through doubt, through the warnings of neighbours, through weather that seemed to take sides. Every step taught less about {topic} and more about the one walking, which, it turned out, had been the point all along.`,
  `Ignoring it did not work. {Topic} refused to be filed away with the bills and the birthdays — it showed up in coffee steam, in half-heard songs, in the pause between one heartbeat and the next.`,
  `The search was not kind. It cost sleep, and certainty, and one good pair of shoes. Twice there was almost a turning back; twice something small — a child's laugh, a light left on — whispered: keep going.`,
  `So began the strangest season of an ordinary life: mornings spent chasing {topic}, evenings spent pretending not to, and nights when it felt near enough to touch.`,
];

const STORY_CLOSINGS = [
  `In the end, it wasn't found so much as understood. {Topic} had never been hiding — it had been waiting to be seen. Some stories end with treasure. This one ends with truth, which weighs less and is worth more.`,
  `When it was over, nothing looked different and everything was. The house still creaked. The kettle still sang. But {topic} had left its fingerprints on every ordinary thing — and ordinary, it turns out, was the treasure all along.`,
  `Years later, children would ask how the story ended, and the answer was always the same: it didn't. {Topic} goes on — in the telling, in the seeking, in every heart stubborn enough to believe.`,
  `And that is how {topic} stopped being a mystery and became a companion. Not tamed — never tamed — but known, the way the moon is known: distantly, faithfully, and enough.`,
];

// v48: songs are ASSEMBLED like the stories — a verse 1, a chorus, a verse 2,
// and a bridge picked independently by the seed (4 × 4 × 4 × 4 = 256 songs),
// with the chorus reprised at the end so the sheet reads complete. All parts
// are first-person; the topic lives in verse 1 and the chorus, so any
// assembly reads as one song.

const SONG_V1S = [
  `I've been carrying {topic} in my chest,\nthrough the long nights and the road with no rest,\nevery mile marker whispered my name,\nsaid the fire and the rain feel the same.`,
  `City lights can't shine like this,\n{topic} started with a single wish,\nwrote it down on a paper heart,\nevery ending needs a start.`,
  `Quiet room, an open door,\n{topic} waiting on the floor,\npicked it up and felt the weight,\nsome things heavy make you great.`,
  `Dust on my shoes from the road I chose,\n{topic} calling where the cold wind blows,\ntraded my comfort for a compass and a flame,\nnever once looked back the way I came.`,
];

const SONG_CHORUSES = [
  `But I'm still here, still standing tall,\n{topic} couldn't make me fall,\nturn it up, let the whole world hear —\nwhat was meant to break me brought me here.`,
  `So sing it loud, sing it true,\n{topic} lives in what I do,\nhands up high, I came so far —\nI finally know who I am.`,
  `Rise, rise — this is the sound\nof dreams that would not stay down,\n{topic} in every heartbeat's drum,\nthe best is still to come.`,
  `Louder now — I found my voice,\n{topic} was never chance, it was choice,\nlet the echo carry down the years:\nI sang my way straight through the fears.`,
];

const SONG_V2S = [
  `Now the morning's painting gold on my wall,\nI remember when I couldn't crawl,\nevery scar is a verse in my song,\nproof that I was right to hold on.`,
  `Took the doubt and made it fuel,\nbroke the mold and bent the rule,\nwhat they said would slow me down\nis the reason I wear the crown.`,
  `Phone light low at 2 a.m.,\nwrote my dreams then lived in them,\nsmall beginnings, steady hands,\nlittle rivers move the lands.`,
  `I kept the promise no one heard,\nbuilt a life on a whispered word,\nnow the door I used to knock\nswings wide open when I walk.`,
];

const SONG_BRIDGES = [
  `And if they ask me how I made it through,\nI'll say: one day at a time — and a little faith too.`,
  `Quiet now… just the beat and my breath —\nI've come too far to fear what's left.`,
  `This is for the ones still walking through the rain:\nhold on — gold gets made in flame.`,
  `Every no was a detour, every fall was a seed —\nlook at the garden growing out of me.`,
];

// v48: raps — topic-woven verses with their own cadence.

const RAPS = [
  `Yeah — look,\nthey slept on {topic}, I stayed up instead,\nturned midnight oil to bread, vision in my head,\nno co-sign needed, I redeemed what they said,\nevery L was a lesson and I read them all twice,\nI'm in my prime like a decade of prep,\n{topic} on my shoulders and I ain't broke a sweat yet.`,
  `Check —\n{topic} in my pocket like a promise I kept,\nclimbed out of the basement, took the stairs, never slept,\nthey counted me out, I was counting my steps,\nnow the count's in my favour — go ahead and check.\nHumble with the blessing, but I said what I said:\ncan't rewrite my story, I'm the author and the pen.`,
  `Ayo —\nstarted with a whisper, now {topic} got a megaphone,\nbuilt it out of nothing, now the nothing is a home,\nkept my circle prayed up, kept the envy on read,\nlet the work make the noise while the critics make threads.\nLegacy talk — I'm just getting to page one,\nwhen they ask how it started, say: the work got done.`,
];

const LETTERS = [
  `Dear {recipient},\n\nI've started this letter more times than I can count, and every version comes back to the same thing: {topic}. Some things are too important to say in passing, so I'm saying this one properly.\n\nYou should know that none of it is taken for granted — not the time, not the patience, not the way you've carried what you've carried. Life moves fast and words move slow, but these ones are true and they'll keep.\n\nWith all my heart,\n{sender}`,
  `Dear {recipient},\n\nThere are letters you write because you must, and letters you write because your heart won't sit still until you do. This is the second kind, and it's about {topic}.\n\nI won't dress it up: it matters. It has mattered for longer than I've said out loud, and putting it on paper is my way of making it real. Whatever comes next, I wanted you to have this in your hands first.\n\nAlways,\n{sender}`,
  `Dear {recipient},\n\nBy the time you read this, I'll have found the courage I'm borrowing right now to write about {topic}. Funny how paper is braver than people.\n\nHere is what I know for certain: the things we don't say don't disappear — they just wait. I'm done letting this one wait. Thank you for being the kind of person a letter like this can be sent to.\n\nYours,\n{sender}`,
];

const SPEECHES = [
  `Friends — thank you for being here.\n\nI want to talk for a moment about {topic}. Not the polished version we put on posters — the real thing: the early mornings nobody claps for, the doubt that visits before every breakthrough, the choice, made daily, to keep going anyway.\n\nEverything worth having asks the same question: how much do you want it? Today, in this room, I can see the answer. So here's to the work behind the win, the people behind the person, and the road still ahead — may we walk it the way we walked this one: together.\n\nThank you.`,
  `If I could leave you with one thing today, it would be this: {topic} is not reserved for special people. It is built by ordinary people who refused to stay the same.\n\nNobody hands it to you. You earn it in increments — a decision here, a sacrifice there, a promise kept when nobody was watching. And one day you look up and the thing you were reaching for is holding your hand.\n\nSo start before you're ready. Stay when it's boring. Finish what you were brave enough to begin. The best chapter is the one you write next.`,
  `They tell you to begin a speech with a joke, but {topic} deserves better than that — it deserves the truth.\n\nThe truth is: we are shaped by what we commit to. Not what we admire, not what we intend — what we commit to. Every person in this room has a version of themselves waiting on the other side of that commitment.\n\nGo be that person. Not tomorrow — tomorrow is where dreams go to wait. Today. And when it gets hard — and it will — remember this room, this moment, and how certain you were. That certainty is a seed. Water it.`,
];

const QUOTES = [
  `"{Topic} is not what happens to you — it's what you build with what happens to you."`,
  `"The distance between dreaming of {topic} and living it is measured in ordinary days, faithfully kept."`,
  `"{Topic} whispers before it roars — blessed are those who listen early."`,
  `"Guard {topic} like a flame: shield it from the wind, feed it daily, and one day it will light more than your own path."`,
  `"Everyone wants {topic}; few want the mornings it costs. Be one of the few."`,
  `"When {topic} feels far away, remember: the seed never sees the harvest on planting day."`,
];

const BANKS: Record<Kind, string[]> = {
  prayer: PRAYERS,
  affirmation: AFFIRMATIONS,
  caption: CAPTIONS,
  poem: [],  // v49: assembled from the three poem stanza banks, never looked up here
  motivation: MOTIVATIONS,
  apology: APOLOGIES,
  thanks: THANKS,
  goodmorning: GOODMORNINGS,
  birthday: BIRTHDAYS,
  congrats: CONGRATS,
  comfort: COMFORTS,
  story: [], // assembled from the three story banks, never looked up here
  song: [],  // v48: assembled from the four song banks, never looked up here
  rap: RAPS,
  letter: LETTERS,
  speech: SPEECHES,
  quote: QUOTES,
};

// Defaults when the ask doesn't name a topic/recipient.
const DEFAULT_TOPIC: Record<Kind, string> = {
  prayer: 'this day and everything it holds',
  affirmation: 'what I am building',
  caption: 'New chapter',
  poem: 'the dream',
  motivation: 'what you are building',
  apology: '', thanks: '', goodmorning: '', birthday: '',
  congrats: '', comfort: '',
  story: 'a dream that would not let go',
  song: 'this journey',
  rap: 'the grind',
  letter: 'everything I never said out loud',
  speech: 'the road that brought us here',
  quote: 'purpose',
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fill(template: string, topic: string, recipient: string, sender: string): string {
  return template
    .replace(/\{Topic\}/g, cap(topic))
    .replace(/\{topic\}/g, topic)
    .replace(/\{Recipient\}/g, cap(recipient))
    .replace(/\{recipient\}/g, recipient)
    .replace(/\{sender\}/g, sender);
}

// v40: the seed sums char codes (stable, deterministic) instead of taking the
// message length, so "a poem about hope" and "a poem about fear" — same
// length, different asks — rotate to different variants.
function seedOf(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n + s.charCodeAt(i)) % 9973;
  return n;
}

const OPENERS: Record<Kind, string> = {
  prayer: `Here's a prayer for you:\n\n`,
  affirmation: `Say this out loud — slowly:\n\n`,
  caption: `Here's your caption:\n\n`,
  poem: `Here's your poem:\n\n`,
  motivation: ``,
  apology: `Here's a way to say it:\n\n`,
  thanks: `Here's a way to say it:\n\n`,
  goodmorning: `Here you go:\n\n`,
  birthday: `Here you go:\n\n`,
  congrats: `Here you go:\n\n`,
  comfort: `Here's a way to say it, gently:\n\n`,
  story: `Here's your story:\n\n`,
  song: `Here's your song:\n\n`,
  rap: `Here's your verse — say it with your chest:\n\n`,
  letter: `Here's your letter:\n\n`,
  speech: `Here's your speech:\n\n`,
  quote: `Here's one for you:\n\n`,
};

// v48: only the short kinds come back in numbered batches; everything longer
// is composed one at a time (and says so when a count was asked).
const MULTI_KINDS = new Set<Kind>(['caption', 'quote', 'affirmation']);

// v49: per-tone banks for the short kinds — the only kinds small enough to
// carry a genuine second register without the banks bloating. Everything
// else answers in NAVI's own voice with an honest note.
const TONED: Record<Tone, Partial<Record<Kind, string[]>>> = {
  funny: {
    caption: [
      `Day 1 of {topic}. The couch has filed a missing persons report.`,
      `Me and {topic}: a love story nobody asked for and everybody's getting.`,
      `Warning: {topic} in progress. Side effects include glow, gloating, and unsolicited advice.`,
      `They said follow your dreams, so I followed {topic}. It walks fast.`,
    ],
    quote: [
      `"{Topic} is 10% inspiration and 90% pretending the snooze button doesn't exist."`,
      `"They say {topic} takes time. So does my kettle, and I still trust the tea."`,
      `"The secret to {topic}? Start before your excuses finish their coffee."`,
      `"{Topic} doesn't build itself — I checked, twice, from the couch."`,
    ],
    affirmation: [
      `I am powerful, I am focused, and {topic} is lucky to have me. The feeling is occasionally mutual.`,
      `I attract success, good coffee, and progress on {topic} — in whichever order the day allows.`,
      `I do not chase, I attract — except {topic}, which I am absolutely chasing, professionally.`,
      `I am becoming the kind of person {topic} writes home about: slightly tired, entirely unstoppable.`,
    ],
  },
  formal: {
    caption: [
      `A milestone worth marking: {topic}. Grateful for the journey and focused on what lies ahead.`,
      `Quiet work, steady progress — {topic} continues. Thank you to everyone walking it with me.`,
      `Honoured to share this chapter: {topic}. The best of it is still being built.`,
      `{Topic} — a commitment, not a moment. Onwards.`,
    ],
    quote: [
      `"Consistency is the bridge between intention and {topic} — cross it daily."`,
      `"{Topic} is not achieved by force, but by the quiet arithmetic of consistent days."`,
      `"Those who honour the process are, in time, honoured by {topic} itself."`,
      `"Excellence in {topic} is never an accident; it is the residue of deliberate practice."`,
    ],
    affirmation: [
      `I approach {topic} with clarity, diligence, and composure. Each measured step compounds in my favour.`,
      `I am equal to the demands of {topic}. I prepare thoroughly, act decisively, and review honestly.`,
      `My conduct around {topic} reflects my standards: consistent effort, patient execution, unshaken resolve.`,
      `I commit to {topic} with professional discipline — present today, prepared tomorrow, accountable always.`,
    ],
  },
};

const KIND_PLURAL: Record<Kind, string> = {
  prayer: 'prayers', affirmation: 'affirmations', caption: 'captions',
  poem: 'poems', motivation: 'motivational pieces', apology: 'apologies',
  thanks: 'thank-yous', goodmorning: 'good-morning messages',
  birthday: 'birthday messages', congrats: 'congratulations messages',
  comfort: 'condolence messages', story: 'stories', song: 'songs',
  rap: 'raps', letter: 'letters', speech: 'speeches', quote: 'quotes',
};

/** Assemble/pick ONE piece for the ask (no opener). */
function renderOne(kind: Kind, topic: string, recipient: string, sender: string, seed: number): string {
  if (kind === 'poem') {
    const o = POEM_OPENINGS[seed % POEM_OPENINGS.length];
    const h = POEM_HEARTS[Math.floor(seed / 4) % POEM_HEARTS.length];
    const c = POEM_CLOSINGS[Math.floor(seed / 16) % POEM_CLOSINGS.length];
    return [o, h, c].map(t => fill(t, topic, recipient, sender)).join('\n\n');
  }
  if (kind === 'story') {
    const o = STORY_OPENINGS[seed % STORY_OPENINGS.length];
    const m = STORY_MIDDLES[Math.floor(seed / 4) % STORY_MIDDLES.length];
    const c = STORY_CLOSINGS[Math.floor(seed / 16) % STORY_CLOSINGS.length];
    return [o, m, c].map(t => fill(t, topic, recipient, sender)).join('\n\n');
  }
  if (kind === 'song') {
    const v1 = SONG_V1S[seed % SONG_V1S.length];
    const ch = SONG_CHORUSES[Math.floor(seed / 4) % SONG_CHORUSES.length];
    const v2 = SONG_V2S[Math.floor(seed / 16) % SONG_V2S.length];
    const br = SONG_BRIDGES[Math.floor(seed / 64) % SONG_BRIDGES.length];
    return [
      `(Verse 1)\n${v1}`, `(Chorus)\n${ch}`, `(Verse 2)\n${v2}`,
      `(Bridge)\n${br}`, `(Chorus — one more time)\n${ch}`,
    ].map(t => fill(t, topic, recipient, sender)).join('\n\n');
  }
  const bank = BANKS[kind];
  return fill(bank[seed % bank.length], topic, recipient, sender);
}

/** Render a parsed ask into the finished piece. Shared by both entry paths. */
function renderCompose(ask: ComposeAsk, profile: ComposeProfile, seed: number): string {
  // Captions are usually asked "for my new song" rather than "about X" — the
  // recipient slot is really the subject there.
  const topic = ask.topic
    || (ask.kind === 'caption' && ask.recipient ? ask.recipient : '')
    || DEFAULT_TOPIC[ask.kind];
  const recipient = ask.recipient || profile.name || 'you';
  const sender = profile.name || 'me';

  // v49: tones live where per-tone banks exist — the short kinds. Anywhere
  // else the tone is acknowledged honestly and NAVI keeps its own voice.
  const tonedBank = ask.tone ? TONED[ask.tone][ask.kind] : undefined;
  if (ask.tone && !tonedBank) {
    return `Funny and formal I keep for captions, quotes and affirmations (for now) — here's one in my own voice:\n\n` +
      renderOne(ask.kind, topic, recipient, sender, seed);
  }

  if (ask.count && ask.count >= 2) {
    if (MULTI_KINDS.has(ask.kind)) {
      const bank = tonedBank ?? BANKS[ask.kind];
      const label = ask.tone ? `${ask.tone} ${KIND_PLURAL[ask.kind]}` : KIND_PLURAL[ask.kind];
      const n = Math.min(ask.count, bank.length);
      const items = Array.from({ length: n }, (_, i) =>
        `${i + 1}) ${fill(bank[(seed + i) % bank.length], topic, recipient, sender)}`);
      let out = `Here are ${n} ${label} for you:\n\n${items.join('\n\n')}`;
      if (n < ask.count) out += `\n\n(That's my whole shelf of ${label} — all ${n} of them.)`;
      return out;
    }
    // The long forms come one at a time — compose one and say so honestly.
    return `I do ${KIND_PLURAL[ask.kind]} one at a time — here's one:\n\n` +
      renderOne(ask.kind, topic, recipient, sender, seed);
  }

  if (tonedBank) {
    return `${OPENERS[ask.kind]}${fill(tonedBank[seed % tonedBank.length], topic, recipient, sender)}`;
  }

  return `${OPENERS[ask.kind]}${renderOne(ask.kind, topic, recipient, sender, seed)}`;
}

/**
 * Compose the requested piece, or '' when the message isn't a composition ask.
 * The variant is picked by a stable seed so re-asking with different wording
 * naturally rotates the bank. Handles both the conversational form ("write me
 * a prayer about strength") and the v40 /write slash form.
 */
export function tryCompose(message: string, profile: ComposeProfile = {}): string {
  if (isWriteHelpAsk(message)) return WRITE_USAGE;
  const slash = parseWriteSlash(message);
  if (slash === 'malformed') return WRITE_USAGE;
  if (slash === 'crisis') return ''; // the crisis nodes own this message
  const ask = slash ?? parseCompose(message);
  if (!ask) return '';
  return renderCompose(ask, profile, seedOf(message.trim()));
}
