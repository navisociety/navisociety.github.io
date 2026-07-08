// supabase/functions/navi-chat/normalize.ts
//
// NAVI v24 — Typo-tolerant execution.
//
// Node retrieval has been fuzzy since v15 (match.ts), but every deterministic
// engine added since v13 — reminders, life events, Bible references, the
// dictionary, math, devotionals — gates on exact regexes, so one common typo
// makes the engine silently fall through: "remind me to call mom tommorow"
// stored an UNDATED reminder, "whens my exam" missed the life-event answer,
// "cant stand traffic" never reached the dislikes list. This module fixes the
// message once, up front, so every engine downstream executes on what the
// user meant.
//
// Deliberately conservative: a curated map of unambiguous misspellings and
// texting contractions ("tommorow", "wat", "dont", "u") — never real English
// words (so "ill", "its", "were" are untouched), never anything that could
// plausibly be a name. Word-boundary replacement only; capitalisation of the
// original token is preserved.

const CORRECTIONS: Record<string, string> = {
  // engine-gating time words
  tommorow: 'tomorrow', tommorrow: 'tomorrow', tomorow: 'tomorrow',
  yesturday: 'yesterday', tonite: 'tonight',
  // memory / reminder verbs
  remeber: 'remember', rember: 'remember', remembr: 'remember', remmeber: 'remember',
  remine: 'remind', remidn: 'remind',
  birthdya: 'birthday', brithday: 'birthday', birhtday: 'birthday', bday: 'birthday',
  // question words
  waht: 'what', wat: 'what', whta: 'what', hwat: 'what',
  wich: 'which', wehn: 'when', wher: 'where',
  // dropped-apostrophe contractions (none of these are real words)
  im: "i'm", ive: "i've", dont: "don't", doesnt: "doesn't", didnt: "didn't",
  isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't",
  havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
  wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't",
  cant: "can't", wont: "won't",
  youre: "you're", theyre: "they're", thats: "that's",
  whats: "what's", whens: "when's", hows: "how's", wheres: "where's", whos: "who's",
  // texting shorthand
  u: 'you', ur: 'your', plz: 'please', pls: 'please', thx: 'thanks', thanx: 'thanks',
  // classic misspellings
  teh: 'the', definately: 'definitely', definitly: 'definitely', definetly: 'definitely',
  becuase: 'because', becasue: 'because', beacuse: 'because',
  freind: 'friend', freinds: 'friends', thier: 'their',
  recieve: 'receive', beleive: 'believe', belive: 'believe',
  seperate: 'separate', untill: 'until', alot: 'a lot',
  favorit: 'favorite', favourit: 'favourite',
};

const CORRECTION_RX = new RegExp(
  `\\b(?:${Object.keys(CORRECTIONS).sort((a, b) => b.length - a.length).join('|')})\\b`,
  'gi',
);

/**
 * Fix known typos in a message so the deterministic engines fire. Returns the
 * corrected text; the original casing of each corrected token's first letter
 * is kept so "Dont" becomes "Don't", not "don't".
 */
export function normalizeMessage(text: string): string {
  if (!text) return text;
  return text.replace(CORRECTION_RX, (tok) => {
    const fix = CORRECTIONS[tok.toLowerCase()];
    if (!fix) return tok;
    return tok.charAt(0) === tok.charAt(0).toUpperCase() && /[a-z]/i.test(tok.charAt(0))
      ? fix.charAt(0).toUpperCase() + fix.slice(1)
      : fix;
  });
}
