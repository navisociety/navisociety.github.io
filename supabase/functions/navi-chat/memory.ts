// supabase/functions/navi-chat/memory.ts
//
// NAVI in-conversation personal memory (v15). Deterministically extracts the
// user's name, age, and place from the conversation history on every request
// (stateless — nothing is stored server-side), and answers questions like
// "what's my name?" directly instead of letting them fall into the knowledge
// nodes. Later statements override earlier ones.

export type Profile = { name?: string; age?: number; place?: string };

type Msg = { role: 'user' | 'assistant'; content: string };

// Words that follow "call me ..." without being a name.
const NOT_NAMES = new Set([
  'later', 'back', 'now', 'when', 'anytime', 'maybe', 'please', 'again',
  'tomorrow', 'tonight', 'today', 'crazy', 'stupid', 'out', 'up', 'on',
  'whatever', 'anything', 'something', 'that', 'this', 'it', 'a', 'an', 'the',
]);

function titleCase(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

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
}

/** Build the profile from every user message in the conversation. */
export function extractProfile(history: Msg[], current: string): Profile {
  const profile: Profile = {};
  for (const m of history) if (m.role === 'user') extractFrom(m.content, profile);
  extractFrom(current, profile);
  return profile;
}

/** Answer "what's my name / how old am I / where am I from" from the profile. */
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

  return null;
}
