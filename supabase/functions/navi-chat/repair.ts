// supabase/functions/navi-chat/repair.ts
//
// NAVI conversational repair (v17). Messages aimed AT NAVI — "that's wrong",
// "you're not helping", "that's not what I asked", "you already said that" —
// used to be matched against the knowledge nodes like any other input, which
// meant a frustrated user got a random essay instead of NAVI actually owning
// the miss. This handler catches those repair signals early and responds with
// composure: no defensiveness, no argument, just a quick reset that pulls the
// real need back to the surface. Deterministic and tightly anchored so it only
// fires on criticism directed at NAVI, never on factual content that merely
// contains a word like "wrong" ("why is slavery wrong").

type Repair = { rx: RegExp; pool: string[] };

// Every pattern is anchored to a full-message shape (^ … $ after light
// normalisation). That keeps "you're wrong" a repair signal while leaving
// "explain why war is wrong" to the knowledge pipeline.
const REPAIRS: Repair[] = [
  {
    // NAVI got the facts wrong
    rx: /^(?:no[, ]+)?(?:that ?s|thats|it ?s|youre|you are|you ?re|thas) (?:wrong|incorrect|not right|not correct|false|not true|mistaken)$|^(?:no ?,? )?(?:wrong|incorrect|not right|not correct)( answer)?$|^that ?s not (?:right|correct|true)$/,
    pool: [
      "You're right to call that out — I'd rather be corrected than confidently wrong. Tell me the part I got wrong and I'll fix my answer.",
      "Fair. I don't want to sell you a wrong answer. Point me at what's off and I'll get it straight.",
      "Noted — I'll take the correction. What's the accurate version, or what did I miss?",
    ],
  },
  {
    // NAVI isn't being useful
    rx: /^(?:youre|you are|you ?re|thats|that ?s|this (?:is|isnt)|that (?:isnt|is not)) ?(?:not )?(?:helping|helpful|useless|pointless|no help|not working|useful)$|^(?:that|this|you) ?(?:s|re)? not (?:helping|helpful|useful|working)$|^useless$|^not helpful$|^that didnt help$|^youre useless$/,
    pool: [
      "That's honest, and I'd rather know. Let me actually be useful — what specifically do you need from me right now?",
      "Okay, that one landed flat. Reset me: what would a genuinely helpful answer look like here?",
      "Fair hit. Tell me the real problem in your own words and I'll come at it properly this time.",
    ],
  },
  {
    // NAVI misread the question
    rx: /^(?:no[, ]+)?(?:that ?s|thats|it ?s) not what (?:i|im|i ?m) (?:asked|asking|meant|mean|said|saying)( for)?$|^you (?:misunderstood|misread|didnt understand|dont understand|dont get it|missed the point)$|^i didnt ask (?:that|for that)$|^not what i (?:asked|meant|said)$|^youre missing the point$/,
    pool: [
      "You're right — I answered the wrong question. Say it again straight and I'll stay on your actual point this time.",
      "My miss. Reframe it for me in one line and I'll answer what you actually asked.",
      "Got ahead of myself and missed your point. What's the real question underneath?",
    ],
  },
  {
    // NAVI is repeating itself
    rx: /^(?:you (?:already|just) said (?:that|this)|stop repeating(?: yourself| that)?|youre repeating(?: yourself)?|you keep saying (?:that|the same thing)|same answer(?: again)?|you said that already|thats the same( answer| thing)?)$/,
    pool: [
      "You're right, I circled back on myself. Let me give you a different angle instead of the same one — what part still isn't answered?",
      "Fair — repeating myself helps no one. Point me at what's still open and I'll take a fresh run at it.",
      "Noted, I'll stop looping. What's the piece you actually still need?",
    ],
  },
  {
    // mild insult at NAVI — stay non-defensive
    rx: /^(?:youre|you are|you ?re) (?:dumb|stupid|an idiot|useless|trash|rubbish|terrible|awful|the worst|a joke|broken|bad)$|^(?:dumb|stupid) (?:bot|ai|robot)$/,
    pool: [
      "Might be — I'm still growing, and I won't pretend to be perfect. But I'm here to actually help. What do you need?",
      "Maybe I earned that one. I'd rather turn it around than argue — give me the real question and let me do better.",
      "I can take it. Now let me be worth the conversation — what are you actually trying to get to?",
    ],
  },
];

/**
 * Detect a repair signal aimed at NAVI and return a composed reset reply.
 * Returns null for anything with real content so the knowledge pipeline runs.
 * Rotated per conversation turn so a frustrated user isn't met with the same
 * canned line twice.
 */
export function tryRepair(message: string, convTurn: number): string | null {
  const t = message
    .toLowerCase()
    .replace(/^\s*(?:hey\s+)?navi[,:\s]+/, '')
    .replace(/['’]/g, '')          // keep contractions whole: don't → dont
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Repair signals are short. Anything long is a real message, not a complaint.
  if (!t || t.split(' ').length > 7) return null;
  for (const r of REPAIRS) {
    if (r.rx.test(t)) return r.pool[convTurn % r.pool.length];
  }
  return null;
}
