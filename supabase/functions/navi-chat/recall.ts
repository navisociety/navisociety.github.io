// supabase/functions/navi-chat/recall.ts
//
// NAVI conversation recall (v17). "What were we talking about?", "recap", "where
// were we?" — questions about the conversation itself — used to fall into the
// knowledge nodes and get a generic answer, which made NAVI feel like it had no
// memory of the thread. This handler reconstructs the actual arc of the chat
// from history: the topics raised and the specific things the user brought up,
// first to last. Fully deterministic and stateless — it reads only the history
// the client already sends.

type Msg = { role: 'user' | 'assistant'; content: string };

// Themes we can name when summarising what a conversation has been about.
const TOPICS: { key: string; words: string[]; label: string }[] = [
  { key: 'music', words: ['music', 'song', 'rap', 'beat', 'produce', 'producer', 'lyrics', 'track', 'studio'], label: 'music' },
  { key: 'business', words: ['business', 'startup', 'company', 'entrepreneur', 'product', 'brand', 'hustle', 'money', 'sales'], label: 'building your business' },
  { key: 'content', words: ['content', 'instagram', 'tiktok', 'youtube', 'followers', 'audience', 'viral'], label: 'content and audience' },
  { key: 'faith', words: ['god', 'faith', 'prayer', 'spiritual', 'church', 'bible', 'scripture', 'verse'], label: 'faith' },
  { key: 'struggle', words: ['depressed', 'anxiety', 'anxious', 'lonely', 'hurt', 'pain', 'struggling', 'burnout', 'stressed', 'overwhelmed'], label: 'what you\'ve been carrying' },
  { key: 'creative', words: ['art', 'design', 'creative', 'draw', 'write', 'writing', 'paint'], label: 'your creative work' },
  { key: 'english', words: ['english', 'grammar', 'language', 'vocabulary', 'tense', 'sentence', 'word'], label: 'English' },
  { key: 'career', words: ['job', 'career', 'interview', 'cv', 'resume', 'work', 'salary', 'boss'], label: 'your career' },
  { key: 'study', words: ['study', 'exam', 'exams', 'school', 'university', 'varsity', 'matric', 'learn'], label: 'studying' },
  { key: 'health', words: ['health', 'sleep', 'sleep', 'gym', 'fitness', 'diet', 'exercise', 'sick'], label: 'your health' },
  { key: 'relationships', words: ['relationship', 'girlfriend', 'boyfriend', 'partner', 'dating', 'family', 'friend', 'friends'], label: 'relationships' },
  { key: 'purpose', words: ['purpose', 'meaning', 'life', 'future', 'dream', 'goal', 'goals', 'vision'], label: 'purpose and direction' },
];

const RECALL_RX =
  /\b(what (?:were|was|are|have) we (?:talking|chatting|speaking|discussing)|what (?:did|have) we (?:talk|chat|discuss)|what were we (?:on|saying)|where (?:were|are) we|remind me what we|recap(?: (?:our|this|the))?|sum(?:marise|marize)(?: (?:our|this|the))|what (?:was|is) this (?:chat|conversation) about|what have we (?:covered|been (?:talking|discussing))|catch me up|refresh my memory)\b/;

/** A message asking NAVI to recall/summarise the conversation so far. */
function isRecallRequest(message: string): boolean {
  const t = message.toLowerCase().replace(/['’]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 9) return false;
  return RECALL_RX.test(t);
}

/** Trim a user message to a short, quotable fragment. */
function fragment(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  const sp = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut) + '…';
}

// Bare reactions and meta-requests aren't worth quoting back as "what we discussed".
const SKIP_RX = /^(ok(ay)?|k|yes|yeah|no|nope|lol|haha|hmm+|wow|cool|nice|sure|thanks|thank you|hi|hey|hello|yo|why|how so|more|tell me more|go on|and|recap|what were we talking about)$/;

/**
 * If the user is asking what the conversation has been about, reconstruct it
 * from history. Returns null when it isn't a recall request, or when there's
 * nothing real to recall yet.
 */
export function tryRecall(message: string, history: Msg[]): string | null {
  if (!isRecallRequest(message)) return null;

  // Substantive user turns, oldest → newest, minus the recall request itself.
  const turns: string[] = [];
  for (const m of history) {
    if (m.role !== 'user') continue;
    const raw = m.content.trim();
    const norm = raw.toLowerCase().replace(/['’]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm || SKIP_RX.test(norm)) continue;
    if (isRecallRequest(raw)) continue;
    if (raw.split(/\s+/).length < 2) continue;
    turns.push(raw);
  }

  if (turns.length === 0) {
    return "Honestly, we're just getting started — nothing substantial to recap yet. What's on your mind? I'll keep track from here.";
  }

  // Name the themes that actually came up.
  const joined = turns.join(' ').toLowerCase();
  const themes: string[] = [];
  for (const topic of TOPICS) {
    if (topic.words.some(w => joined.includes(w)) && !themes.includes(topic.label)) {
      themes.push(topic.label);
    }
    if (themes.length >= 3) break;
  }

  const first = fragment(turns[0]);
  const last = turns.length > 1 ? fragment(turns[turns.length - 1]) : '';

  let arc: string;
  if (turns.length === 1) {
    arc = `You came to me with "${first}".`;
  } else {
    arc = `We started with "${first}", and most recently you were on "${last}".`;
  }

  const themeLine = themes.length
    ? ` The thread running through it: ${themes.length === 1 ? themes[0] : `${themes.slice(0, -1).join(', ')} and ${themes[themes.length - 1]}`}.`
    : '';

  return `${arc}${themeLine} Want to pick it back up, or take it somewhere new?`;
}
