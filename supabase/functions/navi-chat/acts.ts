// supabase/functions/navi-chat/acts.ts
//
// NAVI acknowledgment intelligence (v16). Bare conversational reactions —
// "ok", "yes", "no", "lol", "wow", "hmm" — used to fall into the generic
// fallback pool ("Say more about that"). Now they get short, forward-moving
// replies that keep the conversation alive, rotated per conversation turn.
// Greetings, thanks, and goodbyes stay with their knowledge nodes.

type Act = { rx: RegExp; pool: string[] };

const ACTS: Act[] = [
  {
    // agreement
    rx: /^(yes|yeah|yep|yup|ya|yebo|sure|exactly|definitely|for sure|absolutely|of course|true|facts|100|correct|right|indeed)$/,
    pool: [
      "Good — then let's move on it. What's the next piece you want to get into?",
      "That's what I like to hear. Where do we take it from here?",
      "Then we're aligned. What's the step you're thinking about?",
      "Solid. Keep going — what else is on your mind?",
    ],
  },
  {
    // disagreement / decline
    rx: /^(no|nope|nah|not really|no thanks|i disagree)$/,
    pool: [
      "Fair enough. What would land better?",
      "Okay — scrap that angle. What's closer to what you meant?",
      "Noted. Tell me where I missed, and we'll take it from there.",
      "Alright, your call. What direction do you want instead?",
    ],
  },
  {
    // acknowledgment
    rx: /^(ok|okay|k|kk|alright|cool|nice|great|awesome|dope|sweet|got it|makes sense|i see|understood|fair|word|sharp|lekker|perfect|good)$/,
    pool: [
      "Good. What's next on your mind?",
      "Sharp. Want to go deeper on that, or switch gears?",
      "Cool. I'm here — where to next?",
      "Alright. Throw me the next one.",
    ],
  },
  {
    // laughter
    rx: /^(lol|lmao|lmfao|rofl|haha+|hehe+|hahaha+)$/,
    pool: [
      "Glad that landed. What else you got?",
      "Ha. I'm funnier than people expect. What's next?",
      "Good — laughter counts as progress. Where were we?",
      "Alright, alright. Back to business, or keep it light?",
    ],
  },
  {
    // amazement
    rx: /^(wow|whoa|woah|damn|sheesh|crazy|insane|wild|no way|unreal|eish|yoh)$/,
    pool: [
      "Right? Now you see why I brought it up. Want more?",
      "Big, isn't it. Sit with it for a second — then let's use it.",
      "That reaction is earned. Want the deeper layer?",
      "Told you. There's more where that came from — keep asking.",
    ],
  },
  {
    // thinking pause
    rx: /^(hmm+|hm+|mm+|interesting|deep|heavy|makes you think)$/,
    pool: [
      "Take your time. What part are you turning over?",
      "Something's brewing in that pause. Say it rough — we'll shape it.",
      "That silence means you're actually thinking. What surfaced?",
      "Sit with it. Then tell me what it stirred up.",
    ],
  },
];

/**
 * Reply to a bare reaction message ("ok", "yes", "lol"). Returns null for
 * anything with real content so the knowledge pipeline handles it.
 */
export function tryAcknowledgment(message: string, convTurn: number): string | null {
  const t = message
    .toLowerCase()
    .replace(/^\s*(?:hey\s+)?navi[,:\s]+/, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.split(' ').length > 3) return null;
  for (const act of ACTS) {
    if (act.rx.test(t)) return act.pool[convTurn % act.pool.length];
  }
  return null;
}
