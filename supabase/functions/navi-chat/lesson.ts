// supabase/functions/navi-chat/lesson.ts
//
// NAVI v21 — Teach & Quiz engine.
//
// Two learning modes that turn NAVI from an answer machine into a teacher:
//
//   • "teach me about photosynthesis" → a structured mini-lesson: the core
//     idea plus key points drawn from across the source text (not just the
//     lead sentence), closing with an invitation to go deeper — and "tell me
//     more" then continues from where the lesson stopped.
//
//   • "quiz me" / "quiz me on the bible" → an interactive quiz over a curated
//     question bank. NAVI asks, checks the user's answer (fuzzy — typos and
//     word forms still count), praises or corrects, and serves the next
//     question. Stateless by design: the active question is recovered from the
//     conversation history, so quiz mode needs no server-side session.

import { wordsMatch } from './match.ts';

type Msg = { role: 'user' | 'assistant'; content: string };

// ── Lessons ───────────────────────────────────────────────────────────────────

const LESSON_RX = /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?teach me (?:about |on )?(.+)$/i;
const RESERVED_RX = /\b(navi|navisociety|prophet|dian)\b/i;
const PERSONAL_RX = /\b(me|myself|my|us|our|you|yourself)\b/i;

/**
 * The topic of a "teach me about X" ask, or null. Articles are kept — the
 * topic is used for display ("lesson on the Eiffel Tower"); strip them for
 * lookups at the call site.
 */
export function lessonTopic(message: string): string | null {
  const m = message.trim().replace(/[?!.]+\s*$/, '').match(LESSON_RX);
  if (!m) return null;
  const topic = m[1].replace(/\s+/g, ' ').trim();
  if (!topic || topic.replace(/^(a|an|the)\s+/i, '').split(/\s+/).length > 6) return null;
  if (RESERVED_RX.test(topic) || PERSONAL_RX.test(topic)) return null;
  return topic;
}

/** Strip pronunciation guides, IPA brackets, and footnote markers. */
function scrub(text: string): string {
  return text
    .replace(/\(\s*\/[^)]*\)/g, '')                 // (/ ˈaɪfəl / EYE-fəl; …)
    .replace(/\([^)]*[^\x00-\x7F][^)]*\)/g, '')     // parens holding IPA/foreign script
    .replace(/\[[^\]]*[^\x00-\x7F][^\]]*\]/g, '')   // bracketed IPA like [tuʁ ɛfɛl]
    .replace(/\[\s*\w{1,3}\s*\]/g, '')              // footnote markers like [4] or [a]
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ');
}

function splitSentences(text: string): string[] {
  return scrub(text)
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);
}

/**
 * Build a structured mini-lesson from a source text: the lead idea plus points
 * pulled from deeper in the text, so the lesson covers ground instead of
 * repeating the intro. Returns '' when the text is too thin to teach from.
 */
export function buildLesson(topic: string, text: string): string {
  if (!text || text.length < 200) return '';
  const sents = splitSentences(text);
  if (sents.length < 3) return '';

  // Lead + two points spread across the body of the text.
  const picks = [0, Math.floor(sents.length / 3), Math.floor((2 * sents.length) / 3)]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map(i => sents[i]);
  const points = picks
    .map(s => (s.length > 300 ? s.slice(0, 300).trimEnd() + '…' : s))
    .map((s, i) => `${i + 1}) ${s}`)
    .join('\n\n');

  return `Here's your lesson on ${topic}.\n\n${points}\n\nWant more? Say "tell me more" and I'll take you deeper.`;
}

// ── Quiz ──────────────────────────────────────────────────────────────────────

interface QuizItem {
  cat: string;
  q: string;
  a: string;          // display answer
  accept: string[];   // any of these (all words fuzzy-matched) counts as correct
}

export const QUIZ_BANK: QuizItem[] = [
  // Bible
  { cat: 'bible', q: 'Who built the ark that survived the great flood?', a: 'Noah', accept: ['noah'] },
  { cat: 'bible', q: 'Who defeated the giant Goliath with a sling and a stone?', a: 'David', accept: ['david'] },
  { cat: 'bible', q: 'What is the first book of the Bible?', a: 'Genesis', accept: ['genesis'] },
  { cat: 'bible', q: 'Who led the Israelites out of Egypt?', a: 'Moses', accept: ['moses'] },
  // Space
  { cat: 'space', q: 'Which planet is known as the Red Planet?', a: 'Mars', accept: ['mars'] },
  { cat: 'space', q: 'What star does the Earth orbit?', a: 'the Sun', accept: ['sun'] },
  { cat: 'space', q: 'How many planets are in our solar system?', a: '8', accept: ['8', 'eight'] },
  { cat: 'space', q: 'What is the name of the galaxy we live in?', a: 'the Milky Way', accept: ['milky way'] },
  // Geography
  { cat: 'geography', q: 'What is the capital city of France?', a: 'Paris', accept: ['paris'] },
  { cat: 'geography', q: 'Which is the largest ocean on Earth?', a: 'the Pacific Ocean', accept: ['pacific'] },
  { cat: 'geography', q: 'Which river is generally considered the longest in the world?', a: 'the Nile', accept: ['nile'] },
  { cat: 'geography', q: 'Which country has the largest population in the world?', a: 'India', accept: ['india'] },
  // Science
  { cat: 'science', q: 'What gas do plants take in from the air to make food?', a: 'carbon dioxide', accept: ['carbon dioxide', 'co2'] },
  { cat: 'science', q: 'What is the chemical formula H2O better known as?', a: 'water', accept: ['water'] },
  { cat: 'science', q: 'What force pulls objects toward the centre of the Earth?', a: 'gravity', accept: ['gravity'] },
  { cat: 'science', q: 'How many bones are in the adult human body?', a: '206', accept: ['206'] },
  // South Africa
  { cat: 'south africa', q: "What is South Africa's largest city?", a: 'Johannesburg', accept: ['johannesburg', 'joburg', 'jozi'] },
  { cat: 'south africa', q: "Who was South Africa's first democratically elected president?", a: 'Nelson Mandela', accept: ['mandela'] },
  { cat: 'south africa', q: "Which city is South Africa's legislative capital?", a: 'Cape Town', accept: ['cape town'] },
  { cat: 'south africa', q: 'What currency does South Africa use?', a: 'the rand', accept: ['rand'] },
  // History
  { cat: 'history', q: 'In which year did World War II end?', a: '1945', accept: ['1945'] },
  { cat: 'history', q: 'Who was the first person to walk on the moon?', a: 'Neil Armstrong', accept: ['armstrong'] },
  { cat: 'history', q: 'Which ancient civilisation built the pyramids at Giza?', a: 'the ancient Egyptians', accept: ['egypt', 'egyptians', 'egyptian'] },
  // General
  { cat: 'general', q: 'What is the largest mammal on Earth?', a: 'the blue whale', accept: ['blue whale', 'whale'] },
  { cat: 'general', q: 'How many strings does a standard guitar have?', a: '6', accept: ['6', 'six'] },
  { cat: 'general', q: 'What do bees make that people eat?', a: 'honey', accept: ['honey'] },
];

const START_RX =
  /^(?:hey\s+|hi\s+)?(?:navi[,:\s]+)?(?:quiz me|test me|give me a quiz|let'?s do a quiz)(?:\s+on\s+(?:the\s+)?(.+))?$/i;

const CAT_KEYWORDS: Array<[RegExp, string]> = [
  [/bible|scripture|word/, 'bible'],
  [/space|planet|astronomy|universe|stars/, 'space'],
  [/geography|world|countries|capitals|maps/, 'geography'],
  [/science|biology|physics|chemistry/, 'science'],
  [/south africa|mzansi|\bsa\b/, 'south africa'],
  [/history/, 'history'],
];

function poolFor(catAsk: string | undefined): QuizItem[] {
  if (catAsk) {
    const t = catAsk.toLowerCase();
    for (const [rx, cat] of CAT_KEYWORDS) {
      if (rx.test(t)) return QUIZ_BANK.filter(x => x.cat === cat);
    }
  }
  return QUIZ_BANK;
}

const Q_PREFIX = 'Q: ';

/** The quiz question NAVI asked in its most recent turn, or null. */
export function pendingQuiz(history: Msg[]): QuizItem | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'assistant') continue;
    const content = history[i].content;
    if (!content.includes(Q_PREFIX)) return null;
    return QUIZ_BANK.find(x => content.includes(x.q)) ?? null;
  }
  return null;
}

/** Fuzzy answer check: every word of an accepted answer appears in the reply. */
export function answerIsCorrect(item: QuizItem, reply: string): boolean {
  const replyWords = reply.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  return item.accept.some(acc => {
    const need = acc.toLowerCase().split(/\s+/);
    return need.every(n => replyWords.some(w => w === n || wordsMatch(w, n, true)));
  });
}

const STOP_RX = /^(?:stop|enough|i'?m done|done|no more|end quiz|quit|exit|that's enough)[.!?]*$/i;
const SKIP_RX = /^(?:i (?:don'?t|do not) know|idk|no idea|not sure|pass|skip|next)[.!?]*$/i;

const PRAISE = ['Sharp.', 'You know your stuff.', 'Clean.', 'Too easy for you.'];

/** Next unasked question from the same pool as `current`, or null. */
function nextQuestion(current: QuizItem, history: Msg[]): QuizItem | null {
  const asked = history.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
  const pool = QUIZ_BANK.filter(x => x.cat === current.cat);
  const wide = pool.length > 1 ? pool : QUIZ_BANK;
  return wide.find(x => x.q !== current.q && !asked.includes(x.q)) ?? null;
}

function withNext(lead: string, current: QuizItem, history: Msg[]): string {
  const next = nextQuestion(current, history);
  return next
    ? `${lead}\n\n${Q_PREFIX}${next.q}`
    : `${lead}\n\nThat's the last one I had in that lane — say "quiz me" anytime for another round.`;
}

/**
 * Drive quiz mode: start a quiz on "quiz me (on X)", or — when NAVI's last
 * turn asked a quiz question — grade this message as the answer and serve the
 * next question. Returns '' when quiz mode doesn't apply (including when the
 * user clearly changed the subject mid-quiz).
 */
export function tryQuiz(message: string, history: Msg[]): string {
  const m = message.trim();

  // Start of a quiz.
  const start = m.replace(/[?!.]+\s*$/, '').match(START_RX);
  if (start) {
    const pool = poolFor(start[1]);
    const first = pool[(m.length + history.length) % pool.length];
    return `Quiz time. Answer straight — I'll keep score in spirit.\n\n${Q_PREFIX}${first.q}`;
  }

  // An answer to the question NAVI just asked.
  const current = pendingQuiz(history);
  if (!current) return '';

  if (STOP_RX.test(m)) {
    return 'Good session — quiz mode closed. Say "quiz me" anytime for another round.';
  }
  if (SKIP_RX.test(m)) {
    return withNext(`No stress — it's ${current.a}.`, current, history);
  }

  // If the user clearly changed the subject (long message or their own
  // question), let the normal pipeline answer instead of force-grading it.
  if (m.length > 60 || m.split(/\s+/).length > 8) return '';
  if (/^(who|what|when|where|why|how|which|tell me|explain|define)\b/i.test(m)) return '';

  if (answerIsCorrect(current, m)) {
    const praise = PRAISE[m.length % PRAISE.length];
    return withNext(`Correct — ${current.a}. ${praise}`, current, history);
  }
  return withNext(`Not quite — the answer is ${current.a}.`, current, history);
}
